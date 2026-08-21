import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, mockInsertPolicy, mockFindPolicyByName, mockReactivateModePolicy, mockListActions, mockEvaluatePolicy } = vi.hoisted(() => ({
  mockSql: Object.assign(
    vi.fn(async () => []),
    { query: vi.fn(async () => []) },
  ),
  mockInsertPolicy: vi.fn(),
  mockFindPolicyByName: vi.fn(),
  mockReactivateModePolicy: vi.fn(),
  mockListActions: vi.fn(),
  mockEvaluatePolicy: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  insertPolicy: mockInsertPolicy,
  findPolicyByName: mockFindPolicyByName,
  reactivateModePolicy: mockReactivateModePolicy,
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ listActionsForSimulation: mockListActions }));
vi.mock('@/lib/guard.js', () => ({ evaluatePolicy: mockEvaluatePolicy }));

import { GET } from '@/api/policies/modes/route.js';
import { POST as PREVIEW } from '@/api/policies/modes/preview/route.js';
import { POST as IMPORT } from '@/api/policies/modes/import/route.js';
import { makeRequest as rawRequest } from '../helpers.js';

/** helpers.js returns a duck-typed request object; the route handlers expect Request. */
function makeRequest(url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Request {
  return rawRequest(url, opts) as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindPolicyByName.mockResolvedValue([]);
  mockListActions.mockResolvedValue([]);
  mockEvaluatePolicy.mockResolvedValue(null);
  mockInsertPolicy.mockResolvedValue({ id: 'gp_x', active: 1 });
  mockReactivateModePolicy.mockResolvedValue({ id: 'existing', active: 1 });
});

const adminHeaders = { 'x-org-id': 'org_1', 'x-org-role': 'admin' };
const memberHeaders = { 'x-org-id': 'org_1' };

describe('GET /api/policies/modes', () => {
  it('returns all 8 modes with policy_count and human-facing arrays', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.modes)).toBe(true);
    expect(data.modes).toHaveLength(8);
    const cc = data.modes.find((m: { id: string }) => m.id === 'claude-code');
    expect(cc).toBeTruthy();
    expect(cc.policy_count).toBe(9);
    expect(cc.interruptionLevel).toBe('low');
    expect(Array.isArray(cc.requiresApproval)).toBe(true);
    expect(Array.isArray(cc.toolVisibilityNotes)).toBe(true);
  });
});

describe('POST /api/policies/modes/preview', () => {
  it('returns the compiled policies + summary for claude-code without writing', async () => {
    const res = await PREVIEW(makeRequest('http://localhost/api/policies/modes/preview', {
      headers: memberHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode.id).toBe('claude-code');
    expect(data.policies).toHaveLength(9);
    expect(data.summary.total).toBe(9);
    // every previewed policy carries the _mode tag
    for (const p of data.policies) expect(p.rules._mode).toBe('claude-code');
    // no DB writes during preview
    expect(mockInsertPolicy).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode id with 400', async () => {
    const res = await PREVIEW(makeRequest('http://localhost/api/policies/modes/preview', {
      headers: memberHeaders,
      body: { mode_id: '__nope__' },
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('UNKNOWN_MODE');
  });

  it('rejects a missing mode id with 400', async () => {
    const res = await PREVIEW(makeRequest('http://localhost/api/policies/modes/preview', {
      headers: memberHeaders,
      body: {},
    }));
    expect(res.status).toBe(400);
  });

  it('friction: honest empty state when there is no action history', async () => {
    mockListActions.mockResolvedValue([]);
    const res = await PREVIEW(makeRequest('http://localhost/api/policies/modes/preview', {
      headers: memberHeaders,
      body: { mode_id: 'claude-code' },
    }));
    const data = await res.json();
    expect(data.friction.available).toBe(false);
    expect(typeof data.friction.reason).toBe('string');
  });

  it('friction: aggregates decisions when history exists, excluding non-deterministic types', async () => {
    mockListActions.mockResolvedValue([
      { action_id: 'a1', action_type: 'deploy', systems_touched: [] },
      { action_id: 'a2', action_type: 'build', systems_touched: [] },
    ]);
    mockEvaluatePolicy.mockResolvedValue({ action: 'require_approval', reason: 'gated' });
    const res = await PREVIEW(makeRequest('http://localhost/api/policies/modes/preview', {
      headers: memberHeaders,
      body: { mode_id: 'claude-code' },
    }));
    const data = await res.json();
    expect(data.friction.available).toBe(true);
    expect(data.friction.summary.total).toBe(2);
    expect(data.friction.summary.require_approval).toBe(2);
    // rate_limit is excluded from the deterministic simulation
    expect(data.friction.excluded_policy_types).toContain('rate_limit');
  });
});

describe('POST /api/policies/modes/import', () => {
  it('admin import creates one guard policy per compiled policy (active, _mode-tagged, prefixed)', async () => {
    const res = await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    // claude-code mode's "Constrain subagents" line compiles to
    // delegation_constraint, which has no Watch tier — it lands dormant
    // (active: 0), not imported.
    expect(data.imported).toBe(8);
    expect(data.reactivated).toBe(0);
    expect(data.dormant).toBe(1);
    expect(data.skipped).toBe(0);
    expect(mockInsertPolicy).toHaveBeenCalledTimes(9);

    const firstArgs = mockInsertPolicy.mock.calls[0]?.[2] as {
      name: string;
      policyType: string;
      rules: string;
      active: number;
    };
    expect(firstArgs.name.startsWith('[Claude Code Mode]')).toBe(true);
    expect(firstArgs.active).toBe(1);
    expect(JSON.parse(firstArgs.rules)._mode).toBe('claude-code');
  });

  it('reactivates (does NOT skip) a policy whose name already exists, refreshing its rules', async () => {
    mockFindPolicyByName.mockImplementation(async (_sql: unknown, _org: unknown, name: string) =>
      name.includes('Block extreme-risk') ? [{ id: 'existing' }] : [],
    );
    const res = await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    // Same no-watch-tier line lands dormant here too, on top of the reactivated match.
    expect(data.imported).toBe(7);
    expect(data.reactivated).toBe(1);
    expect(data.dormant).toBe(1);
    expect(data.skipped).toBe(0);
    expect(mockInsertPolicy).toHaveBeenCalledTimes(8);
    expect(mockReactivateModePolicy).toHaveBeenCalledTimes(1);

    const [, , id, payload] = mockReactivateModePolicy.mock.calls[0] as [
      unknown,
      unknown,
      string,
      { policyType: string; rules: string },
    ];
    expect(id).toBe('existing');
    expect(payload.policyType).toBe('risk_threshold');
    expect(JSON.parse(payload.rules)._mode).toBe('claude-code');
  });

  // Regression: the /policies cockpit empty-state bug. An org whose mode policies
  // all exist but were toggled OFF must, on re-apply, have ALL of them turned
  // back on — not silently skipped (which left governed=false / "No governance
  // active" despite a successful apply).
  it('re-applying a mode whose policies all already exist reactivates every one', async () => {
    mockFindPolicyByName.mockResolvedValue([{ id: 'existing' }]);
    const res = await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    // The no-watch-tier line's existing row must NOT be reactivated — it is
    // left as-is and counted dormant instead.
    expect(data.imported).toBe(0);
    expect(data.reactivated).toBe(8);
    expect(data.dormant).toBe(1);
    expect(data.skipped).toBe(0);
    expect(mockInsertPolicy).not.toHaveBeenCalled();
    expect(mockReactivateModePolicy).toHaveBeenCalledTimes(8);
  });

  // Residual from a529c7b4: toWatchTier is a no-op for NO_WATCH_TIER_TYPES
  // (non_fabrication, delegation_constraint, role_constraint, webhook_check).
  // Such a compiled line must land dormant, mirroring pack import.
  it('a compiled delegation_constraint line lands dormant, not active, and does not consume a Short List slot', async () => {
    const res = await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.dormant).toBe(1);

    const calls = mockInsertPolicy.mock.calls as Array<[unknown, unknown, { name: string; policyType: string; rules: string; active?: number }]>;
    const constrain = calls.find(([, , input]) => input.name.includes('Constrain subagents'));
    expect(constrain).toBeTruthy();
    const [, , input] = constrain!;
    // policy_type and rules are UNTOUCHED — not swapped/transformed, since
    // there is no key its evaluator would read as a demotion.
    expect(input.policyType).toBe('delegation_constraint');
    expect(JSON.parse(input.rules).escalate_action).toBe('require_approval');
    expect(input.active).toBe(0);

    // Not reported as imported/reactivated — it must not count toward the cap.
    const names = (data.policies as Array<{ name: string; active: number }>).map((p) => p.name);
    expect(names.filter((n) => n.includes('Constrain subagents'))).toHaveLength(1);
  });

  // Short List (spec 2.3): this back-compat route writes straight past the
  // /api/policies admission gate, so it must Watch-transform every compiled
  // rule itself — a mode apply may not mint an interrupting line.
  it('Watch-transforms compiled interrupting policies on insert', async () => {
    await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: 'claude-code' },
    }));
    const written = mockInsertPolicy.mock.calls.map(
      (c) => c[2] as { name: string; policyType: string; rules: string },
    );
    const pause = written.find((p) => p.name.includes('Pause before deploy'))!;
    expect(pause.policyType).toBe('warn_action_type');

    const path = written.find((p) => p.name.includes('Protect governance'))!;
    expect(path.policyType).toBe('protected_path');
    expect(JSON.parse(path.rules).action).toBe('warn');

    const extreme = written.find((p) => p.name.includes('Block extreme-risk'))!;
    expect(JSON.parse(extreme.rules).action).toBe('warn');
  });

  it('Watch-transforms compiled interrupting policies on the reactivate path', async () => {
    mockFindPolicyByName.mockImplementation(async (_sql: unknown, _org: unknown, name: string) =>
      name.includes('Pause before deploy') ? [{ id: 'existing' }] : [],
    );
    await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(mockReactivateModePolicy).toHaveBeenCalledTimes(1);
    const [, , , payload] = mockReactivateModePolicy.mock.calls[0] as [
      unknown,
      unknown,
      string,
      { policyType: string; rules: string },
    ];
    expect(payload.policyType).toBe('warn_action_type');
    expect(JSON.parse(payload.rules)._mode).toBe('claude-code');
  });

  it('rejects non-admin with 403', async () => {
    const res = await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: memberHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(res.status).toBe(403);
    expect(mockInsertPolicy).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode id with 400', async () => {
    const res = await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: '__nope__' },
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('UNKNOWN_MODE');
    expect(mockInsertPolicy).not.toHaveBeenCalled();
  });
});

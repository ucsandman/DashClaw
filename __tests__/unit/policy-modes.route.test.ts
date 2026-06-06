import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, mockInsertPolicy, mockFindPolicyByName, mockListActions, mockEvaluatePolicy } = vi.hoisted(() => ({
  mockSql: Object.assign(
    vi.fn(async () => []),
    { query: vi.fn(async () => []) },
  ),
  mockInsertPolicy: vi.fn(),
  mockFindPolicyByName: vi.fn(),
  mockListActions: vi.fn(),
  mockEvaluatePolicy: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  insertPolicy: mockInsertPolicy,
  findPolicyByName: mockFindPolicyByName,
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
    expect(data.imported).toBe(9);
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

  it('skips policies whose name already exists (dedup)', async () => {
    mockFindPolicyByName.mockImplementation(async (_sql: unknown, _org: unknown, name: string) =>
      name.includes('Block extreme-risk') ? [{ id: 'existing' }] : [],
    );
    const res = await IMPORT(makeRequest('http://localhost/api/policies/modes/import', {
      headers: adminHeaders,
      body: { mode_id: 'claude-code' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported).toBe(8);
    expect(data.skipped).toBe(1);
    expect(mockInsertPolicy).toHaveBeenCalledTimes(8);
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

/**
 * GET/POST /api/policies/tightening — owner roadmap v3.2 (findings become
 * proposals). Spec:
 * docs/superpowers/specs/2026-07-03-findings-become-proposals-design.md
 *
 * The real (pure) engine (deriveTighteningProposals) runs unmocked; only the
 * DB-facing repositories, guardrails repository, posture finding-state
 * writer, event publish, and audit logging are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';
import { tighteningProposalId } from '../../app/lib/posture/tightening';

function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockSql,
  mockGetUngovernedAllowDecisions,
  mockGetTighteningDecisions,
  mockUpsertTighteningDecision,
  mockDeleteTighteningDecision,
  mockGetActivePolicies,
  mockInsertPolicy,
  mockSetFindingState,
  mockLogActivity,
  mockPublishOrgEvent,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetUngovernedAllowDecisions: vi.fn(),
  mockGetTighteningDecisions: vi.fn(),
  mockUpsertTighteningDecision: vi.fn(),
  mockDeleteTighteningDecision: vi.fn(),
  mockGetActivePolicies: vi.fn(),
  mockInsertPolicy: vi.fn(),
  mockSetFindingState: vi.fn(),
  mockLogActivity: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/tightening.repository.js', () => ({
  getUngovernedAllowDecisions: mockGetUngovernedAllowDecisions,
  getTighteningDecisions: mockGetTighteningDecisions,
  upsertTighteningDecision: mockUpsertTighteningDecision,
  deleteTighteningDecision: mockDeleteTighteningDecision,
}));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getActivePolicies: mockGetActivePolicies,
  insertPolicy: mockInsertPolicy,
}));
vi.mock('@/lib/repositories/posture.repository.js', () => ({
  setFindingState: mockSetFindingState,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { POLICY_UPDATED: 'policy.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));

import { GET, POST } from '@/api/policies/tightening/route.js';

function adminHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_alice', ...extra };
}
function memberHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'member', 'x-user-id': 'user_bob', ...extra };
}

const DEPLOY_HIGH_ID = tighteningProposalId('deploy', 'high');

function deployRows(n: number, riskScore = 60) {
  return Array.from({ length: n }, (_, i) => ({
    id: `act_gd_${i}`,
    risk_score: riskScore,
    action_type: 'deploy',
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  mockGetUngovernedAllowDecisions.mockResolvedValue([]);
  mockGetTighteningDecisions.mockResolvedValue([]);
  mockGetActivePolicies.mockResolvedValue([]);
  mockUpsertTighteningDecision.mockResolvedValue({ id: 1, proposal_id: DEPLOY_HIGH_ID, decision: 'ratified' });
  mockDeleteTighteningDecision.mockResolvedValue({ id: 1, policy_id: null });
  mockInsertPolicy.mockResolvedValue({
    id: 'gp_42',
    name: '[Tightened] deploy',
    policy_type: 'require_approval',
    rules: JSON.stringify({ action_types: ['deploy'], _tightened: true }),
  });
  mockSetFindingState.mockResolvedValue(null);
  mockPublishOrgEvent.mockResolvedValue(undefined);
});

describe('GET /api/policies/tightening', () => {
  it('200 shape with defaults (window_days=7, min_observed=3) and empty counts', async () => {
    const res = await GET(makeRequest('http://localhost/api/policies/tightening', { headers: memberHeaders() }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.window_days).toBe(7);
    expect(data.min_observed).toBe(3);
    expect(data.synthetic_included).toBe(false);
    expect(data.inputs).toEqual({ decisions: 0 });
    expect(data.proposals).toEqual([]);
    expect(data.counts).toEqual({ pending: 0, ratified: 0, dismissed: 0 });
  });

  it('clamps ?days to 1..90', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/policies/tightening?days=999', { headers: memberHeaders() }),
    );
    expect((await res.json()).window_days).toBe(90);
    const res2 = await GET(
      makeRequest('http://localhost/api/policies/tightening?days=0', { headers: memberHeaders() }),
    );
    expect((await res2.json()).window_days).toBe(1);
  });

  it('?status=bogus → 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/policies/tightening?status=bogus', { headers: memberHeaders() }),
    );
    expect(res.status).toBe(400);
  });

  it('?include_synthetic=1 flows through to the repository call', async () => {
    await GET(
      makeRequest('http://localhost/api/policies/tightening?include_synthetic=1', {
        headers: memberHeaders(),
      }),
    );
    const call = mockGetUngovernedAllowDecisions.mock.calls[0]!;
    expect(call[3]).toEqual({ includeSynthetic: true });
  });

  it('joins a dismissed decision row onto the matching proposal (status + statusFilter)', async () => {
    mockGetUngovernedAllowDecisions.mockResolvedValue(deployRows(3));
    mockGetTighteningDecisions.mockResolvedValue([
      {
        proposal_id: DEPLOY_HIGH_ID,
        decision: 'dismissed',
        reason: 'known-safe pattern',
        decided_by: 'user_alice',
        decided_at: '2026-07-02T00:00:00Z',
        policy_id: null,
      },
    ]);
    const res = await GET(makeRequest('http://localhost/api/policies/tightening', { headers: memberHeaders() }));
    const data = await res.json();
    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0].status).toBe('dismissed');
    expect(data.proposals[0].decision).toMatchObject({ decision: 'dismissed', decided_by: 'user_alice' });
    expect(data.counts).toEqual({ pending: 0, ratified: 0, dismissed: 1 });

    const filtered = await GET(
      makeRequest('http://localhost/api/policies/tightening?status=pending', { headers: memberHeaders() }),
    );
    const filteredData = await filtered.json();
    expect(filteredData.proposals).toHaveLength(0);
    // counts stay pre-filter
    expect(filteredData.counts).toEqual({ pending: 0, ratified: 0, dismissed: 1 });
  });
});

describe('POST /api/policies/tightening', () => {
  it('403 for non-admin, writes nothing', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: memberHeaders(),
        body: { action: 'ratify', proposal_id: DEPLOY_HIGH_ID, proposal: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' } },
      }),
    );
    expect(res.status).toBe(403);
    expect(mockUpsertTighteningDecision).not.toHaveBeenCalled();
  });

  it('bad action → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: { action: 'bogus', proposal_id: DEPLOY_HIGH_ID },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('bad proposal_id format → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: { action: 'ratify', proposal_id: 'ptp_0123456789abcdef', proposal: {} },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('snapshot mismatch (proposal_id does not match action_type/risk_level) → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: {
          action: 'ratify',
          proposal_id: DEPLOY_HIGH_ID,
          proposal: { rule: 'govern_ungoverned_allow', action_type: 'some-other-type', risk_level: 'high' },
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockInsertPolicy).not.toHaveBeenCalled();
    expect(mockUpsertTighteningDecision).not.toHaveBeenCalled();
  });

  it('dismiss without a reason → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: {
          action: 'dismiss',
          proposal_id: DEPLOY_HIGH_ID,
          proposal: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' },
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsertTighteningDecision).not.toHaveBeenCalled();
  });

  it('dismiss with a too-long reason → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: {
          action: 'dismiss',
          proposal_id: DEPLOY_HIGH_ID,
          proposal: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' },
          reason: 'x'.repeat(501),
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('dismiss redacts likely secrets in the reason before storing', async () => {
    // Built at runtime (not a literal secret-shaped string in source) so it
    // still matches security.ts's openai_key pattern (sk-[A-Za-z0-9]{20,}) at
    // test time without tripping secret-scanning on the file itself.
    const fakeKey = ['sk', 'X'.repeat(24)].join('-');
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: {
          action: 'dismiss',
          proposal_id: DEPLOY_HIGH_ID,
          proposal: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' },
          reason: `saw leaked key ${fakeKey} in logs, dismissing`,
        },
      }),
    );
    expect(res.status).toBe(200);
    const input = mockUpsertTighteningDecision.mock.calls[0]![2];
    expect(input.reason).toContain('[REDACTED:openai_key]');
    expect(input.reason).not.toContain(fakeKey);
  });

  it('happy ratify → creates the policy, resolves the mirrored finding, upserts the decision, audits', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: {
          action: 'ratify',
          proposal_id: DEPLOY_HIGH_ID,
          proposal: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' },
        },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.policy).toMatchObject({ id: 'gp_42' });

    expect(mockInsertPolicy).toHaveBeenCalledTimes(1);
    const [, orgArg, policyInput] = mockInsertPolicy.mock.calls[0]!;
    expect(orgArg).toBe('org_1');
    expect(policyInput).toMatchObject({
      name: '[Tightened] deploy',
      policyType: 'require_approval',
      agentIds: null,
    });
    expect(JSON.parse(policyInput.rules)).toEqual({ action_types: ['deploy'], _tightened: true });

    expect(mockSetFindingState).toHaveBeenCalledTimes(1);
    const [, sfsOrg, findingKey, status, actor, note] = mockSetFindingState.mock.calls[0]!;
    expect(sfsOrg).toBe('org_1');
    expect(status).toBe('resolved');
    expect(actor).toBe('user_alice');
    expect(note).toContain('gp_42');
    expect(typeof findingKey).toBe('string');

    expect(mockUpsertTighteningDecision).toHaveBeenCalledTimes(1);
    const [, , decisionInput] = mockUpsertTighteningDecision.mock.calls[0]!;
    expect(decisionInput).toMatchObject({
      proposalId: DEPLOY_HIGH_ID,
      decision: 'ratified',
      policyId: 'gp_42',
      decidedBy: 'user_alice',
    });

    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity.mock.calls[0]![0].action).toBe('tightening_proposal.ratified');
  });

  it('ratify name-conflict (23505) → 409, no decision recorded', async () => {
    mockInsertPolicy.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint "guard_policies_org_name_unique"' });
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: {
          action: 'ratify',
          proposal_id: DEPLOY_HIGH_ID,
          proposal: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' },
        },
      }),
    );
    expect(res.status).toBe(409);
    expect(mockUpsertTighteningDecision).not.toHaveBeenCalled();
    expect(mockSetFindingState).not.toHaveBeenCalled();
  });

  it('happy dismiss → 200, upserts a dismissed decision, audits', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: {
          action: 'dismiss',
          proposal_id: DEPLOY_HIGH_ID,
          proposal: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' },
          reason: 'known-safe automated pattern',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockInsertPolicy).not.toHaveBeenCalled();
    const [, , input] = mockUpsertTighteningDecision.mock.calls[0]!;
    expect(input.decision).toBe('dismissed');
    expect(input.reason).toBe('known-safe automated pattern');
    expect(mockLogActivity.mock.calls[0]![0].action).toBe('tightening_proposal.dismissed');
  });

  it('undo deletes the judgment and reports the kept policy', async () => {
    mockDeleteTighteningDecision.mockResolvedValue({ id: 1, policy_id: 'gp_42' });
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: { action: 'undo', proposal_id: DEPLOY_HIGH_ID },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.removed).toBe(true);
    expect(data.policy_kept).toBe('gp_42');
    expect(mockLogActivity.mock.calls[0]![0].action).toBe('tightening_proposal.undone');
  });

  it('undo of nothing recorded → 404, no audit', async () => {
    mockDeleteTighteningDecision.mockResolvedValue(null);
    const res = await POST(
      makeRequest('http://localhost/api/policies/tightening', {
        headers: adminHeaders(),
        body: { action: 'undo', proposal_id: DEPLOY_HIGH_ID },
      }),
    );
    expect(res.status).toBe(404);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});

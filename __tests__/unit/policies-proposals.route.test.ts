/**
 * GET/POST /api/policies/proposals — owner roadmap item 1 (policy-tuning
 * proposal loop). Spec: docs/superpowers/specs/2026-07-01-policy-tuning-proposal-loop.md
 *
 * The real (pure) engine runs unmocked; only DB-facing repositories and
 * audit logging are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

/** helpers.js returns a duck-typed request object; route handlers expect Request. */
function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockSql,
  mockGetActivePolicies,
  mockGetDecisionCountsByPolicy,
  mockGetDecisionMixByPolicy,
  mockGetApprovalOutcomesByPolicy,
  mockGetTuningDismissals,
  mockRecordTuningDismissal,
  mockRemoveTuningDismissal,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActivePolicies: vi.fn(),
  mockGetDecisionCountsByPolicy: vi.fn(),
  mockGetDecisionMixByPolicy: vi.fn(),
  mockGetApprovalOutcomesByPolicy: vi.fn(),
  mockGetTuningDismissals: vi.fn(),
  mockRecordTuningDismissal: vi.fn(),
  mockRemoveTuningDismissal: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getActivePolicies: mockGetActivePolicies,
  getDecisionCountsByPolicy: mockGetDecisionCountsByPolicy,
}));
vi.mock('@/lib/repositories/policy-tuning.repository.js', () => ({
  getDecisionMixByPolicy: mockGetDecisionMixByPolicy,
  getApprovalOutcomesByPolicy: mockGetApprovalOutcomesByPolicy,
  getTuningDismissals: mockGetTuningDismissals,
  recordTuningDismissal: mockRecordTuningDismissal,
  removeTuningDismissal: mockRemoveTuningDismissal,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET, POST } from '@/api/policies/proposals/route.js';

function adminHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_alice', ...extra };
}
function memberHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'member', 'x-user-id': 'user_bob', ...extra };
}

// A single active risk_threshold policy with enough evidence to trigger a
// raise_risk_threshold proposal: 12 require_approval interruptions, 11
// approved / 1 denied (override_rate ≈ 0.917 ≥ 0.9).
const OLD_UPDATED_AT = '2020-01-01T00:00:00.000Z';
function seedHappyPath() {
  mockGetActivePolicies.mockResolvedValue([
    {
      id: 'gp_1',
      name: 'risk-approval',
      policy_type: 'risk_threshold',
      active: 1,
      created_at: '2020-01-01T00:00:00.000Z',
      updated_at: OLD_UPDATED_AT,
      rules: '{"threshold":60,"action":"require_approval"}',
    },
  ]);
  mockGetDecisionMixByPolicy.mockResolvedValue([
    { policy_id: 'gp_1', decision: 'require_approval', cnt: '12', last_fired: '2026-06-20T00:00:00.000Z' },
  ]);
  mockGetApprovalOutcomesByPolicy.mockResolvedValue([
    {
      policy_id: 'gp_1',
      approved: '11',
      denied: '1',
      pending: '0',
      approved_min: '62',
      approved_p50: '71',
      approved_max: '79',
    },
  ]);
  mockGetDecisionCountsByPolicy.mockResolvedValue({});
  mockGetTuningDismissals.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  mockGetActivePolicies.mockResolvedValue([]);
  mockGetDecisionMixByPolicy.mockResolvedValue([]);
  mockGetApprovalOutcomesByPolicy.mockResolvedValue([]);
  mockGetDecisionCountsByPolicy.mockResolvedValue({});
  mockGetTuningDismissals.mockResolvedValue({});
  mockRecordTuningDismissal.mockResolvedValue(undefined);
  mockRemoveTuningDismissal.mockResolvedValue(false);
});

describe('GET /api/policies/proposals', () => {
  it('returns stats + a raise_risk_threshold proposal for a well-evidenced policy', async () => {
    seedHappyPath();

    const res = await GET(
      makeRequest('http://localhost/api/policies/proposals', { headers: { 'x-org-id': 'org_1' } }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.window_days).toBe(30);
    expect(data.policies).toHaveLength(1);
    expect(data.policies[0].policy_id).toBe('gp_1');
    expect(data.policies[0].fired.require_approval).toBe(12);

    expect(data.proposals).toHaveLength(1);
    const proposal = data.proposals[0];
    expect(proposal.rule).toBe('raise_risk_threshold');
    expect(proposal.policy_id).toBe('gp_1');
    expect(proposal.patch.rules.threshold).toBe(70);
    expect(data.dismissed_count).toBe(0);
  });

  it('filters out dismissed proposals and reports dismissed_count', async () => {
    seedHappyPath();

    // First pass (no dismissals) to derive the deterministic fingerprint.
    const first = await GET(
      makeRequest('http://localhost/api/policies/proposals', { headers: { 'x-org-id': 'org_1' } }),
    );
    const firstData = await first.json();
    const proposalId = firstData.proposals[0].id;
    expect(proposalId).toMatch(/^ptp_[a-f0-9]{16}$/);

    mockGetTuningDismissals.mockResolvedValue({
      [proposalId]: { reason: 'seasonal', by: 'user_1', at: '2026-06-01T00:00:00.000Z' },
    });

    const res = await GET(
      makeRequest('http://localhost/api/policies/proposals', { headers: { 'x-org-id': 'org_1' } }),
    );
    const data = await res.json();
    expect(data.proposals).toHaveLength(0);
    expect(data.dismissed_count).toBe(1);
  });

  it('clamps days: ?days=999 → 90', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/policies/proposals?days=999', { headers: { 'x-org-id': 'org_1' } }),
    );
    const data = await res.json();
    expect(data.window_days).toBe(90);
  });

  it('clamps days: ?days=1 → 7', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/policies/proposals?days=1', { headers: { 'x-org-id': 'org_1' } }),
    );
    const data = await res.json();
    expect(data.window_days).toBe(7);
  });

  it('works for a non-admin (member) caller — read is org-wide', async () => {
    seedHappyPath();
    const res = await GET(
      makeRequest('http://localhost/api/policies/proposals', { headers: memberHeaders() }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposals).toHaveLength(1);
  });
});

describe('POST /api/policies/proposals', () => {
  it('returns 403 for non-admin and writes nothing', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/proposals', {
        headers: memberHeaders(),
        body: { action: 'dismiss', proposal_id: 'ptp_aaaaaaaaaaaaaaaa', reason: 'noisy' },
      }),
    );
    expect(res.status).toBe(403);
    expect(mockRecordTuningDismissal).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('dismiss without a reason → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/proposals', {
        headers: adminHeaders(),
        body: { action: 'dismiss', proposal_id: 'ptp_aaaaaaaaaaaaaaaa' },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockRecordTuningDismissal).not.toHaveBeenCalled();
  });

  it('dismiss with a reason over 500 chars → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/proposals', {
        headers: adminHeaders(),
        body: { action: 'dismiss', proposal_id: 'ptp_aaaaaaaaaaaaaaaa', reason: 'x'.repeat(501) },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockRecordTuningDismissal).not.toHaveBeenCalled();
  });

  it('bad proposal_id format → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/proposals', {
        headers: adminHeaders(),
        body: { action: 'dismiss', proposal_id: 'not-a-valid-id', reason: 'noisy' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('happy dismiss → 200, records the entry, and audits', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/proposals', {
        headers: adminHeaders(),
        body: { action: 'dismiss', proposal_id: 'ptp_aaaaaaaaaaaaaaaa', reason: 'seasonal traffic' },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.dismissed).toBe(true);

    expect(mockRecordTuningDismissal).toHaveBeenCalledTimes(1);
    const [sqlArg, orgArg, proposalIdArg, entry] = mockRecordTuningDismissal.mock.calls[0]!;
    expect(sqlArg).toBe(mockSql);
    expect(orgArg).toBe('org_1');
    expect(proposalIdArg).toBe('ptp_aaaaaaaaaaaaaaaa');
    expect(entry).toEqual(
      expect.objectContaining({ reason: 'seasonal traffic', by: 'user_alice', at: expect.any(String) }),
    );

    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const auditArg = mockLogActivity.mock.calls[0]![0];
    expect(auditArg.action).toBe('policy_proposal.dismissed');
    expect(auditArg.actorId).toBe('user_alice');
    expect(auditArg.resourceId).toBe('ptp_aaaaaaaaaaaaaaaa');
  });

  it('undismiss when not dismissed → 404', async () => {
    mockRemoveTuningDismissal.mockResolvedValue(false);
    const res = await POST(
      makeRequest('http://localhost/api/policies/proposals', {
        headers: adminHeaders(),
        body: { action: 'undismiss', proposal_id: 'ptp_aaaaaaaaaaaaaaaa' },
      }),
    );
    expect(res.status).toBe(404);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('undismiss when dismissed → 200 and audits', async () => {
    mockRemoveTuningDismissal.mockResolvedValue(true);
    const res = await POST(
      makeRequest('http://localhost/api/policies/proposals', {
        headers: adminHeaders(),
        body: { action: 'undismiss', proposal_id: 'ptp_aaaaaaaaaaaaaaaa' },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.dismissed).toBe(false);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity.mock.calls[0]![0].action).toBe('policy_proposal.undismissed');
  });
});

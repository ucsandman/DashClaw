/**
 * POST /api/policies/loosening — the precedent_grant branch (2026-08-11).
 *
 * A precedent is the only mechanism in the product that turns repeated human
 * approvals into standing authority, so these tests are about the ways it must
 * REFUSE. The happy path is one test; the rest are attacks on it.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateGrant, mockUpsertDecision, mockGetPolicy } = vi.hoisted(() => ({
  mockCreateGrant: vi.fn(async () => undefined),
  mockUpsertDecision: vi.fn(async () => undefined),
  mockGetPolicy: vi.fn(async () => null),
}));

vi.mock('@/lib/repositories/loosening.repository', () => ({
  getInterruptOutcomesByPolicyAction: vi.fn(async () => []),
  getPrecedentOutcomes: vi.fn(async () => []),
  createPrecedentGrant: mockCreateGrant,
  getLooseningDecisions: vi.fn(async () => []),
  upsertLooseningDecision: mockUpsertDecision,
  deleteLooseningDecision: vi.fn(async () => null),
  getPolicyForLoosening: mockGetPolicy,
  applyLooseningRelaxation: vi.fn(async () => undefined),
}));
vi.mock('@/lib/repositories/guardrails.repository', () => ({
  getActivePolicies: vi.fn(async () => []),
}));
vi.mock('@/lib/db', () => ({
  getSql: () => Object.assign(async () => [], { query: async () => [] }),
}));
vi.mock('@/lib/audit', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/events', () => ({
  EVENTS: { POLICY_UPDATED: 'policy.updated' },
  publishOrgEvent: vi.fn(),
}));

const { POST } = await import('@/api/policies/loosening/route');
const { precedentProposalId } = await import('@/lib/posture/loosening');

const ELIGIBLE = ['destructive', 'regenerable_artifact'];
const VALID_ID = precedentProposalId('cleanup', ELIGIBLE);

function req(body: unknown, role = 'admin') {
  return new Request('http://localhost/api/policies/loosening', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_test',
      'x-org-role': role,
      'x-user-id': 'usr_wes',
    },
    body: JSON.stringify(body),
  });
}

const ratify = (over: Record<string, unknown> = {}) =>
  req({
    action: 'ratify',
    proposal_id: VALID_ID,
    proposal: { rule: 'precedent_grant', action_type: 'cleanup', precedent_flags: ELIGIBLE },
    ...over,
  });

beforeEach(() => {
  mockCreateGrant.mockClear();
  mockUpsertDecision.mockClear();
});

describe('precedent ratify', () => {
  it('creates a narrow, expiring grant and records the judgment', async () => {
    const res = await POST(ratify());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.grant_id).toMatch(/^gp_[a-f0-9]{24}$/);
    expect(body.expires_in_days).toBe(14);

    expect(mockCreateGrant).toHaveBeenCalledTimes(1);
    const arg = (mockCreateGrant.mock.calls[0] as unknown as unknown[])[2] as Record<string, unknown>;
    expect(arg.actionType).toBe('cleanup');
    expect(arg.flags).toEqual(ELIGIBLE);
    expect(arg.ttlDays).toBe(14);
    // The scope must be the flag set and nothing else — a target_prefix here is
    // how `security -> C:/Users/` happened.
    expect(arg).not.toHaveProperty('targetPrefix');
    expect(mockUpsertDecision).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-admin', async () => {
    const denied = await POST(
      req(
        {
          action: 'ratify',
          proposal_id: VALID_ID,
          proposal: { rule: 'precedent_grant', action_type: 'cleanup', precedent_flags: ELIGIBLE },
        },
        'member',
      ),
    );
    expect(denied.status).toBe(403);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('rejects a proposal_id that does not derive from the snapshot', async () => {
    const res = await POST(
      req({
        action: 'ratify',
        proposal_id: precedentProposalId('cleanup', ['destructive']),
        proposal: { rule: 'precedent_grant', action_type: 'cleanup', precedent_flags: ELIGIBLE },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not match the snapshot/);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('rejects an ineligible shape even with a correctly derived id', async () => {
    // A crafted body for a shape outside the closed allowlist. The id is
    // internally consistent, so ONLY the eligibility re-check stops it.
    const flags = ['destructive', 'protected_target'];
    const res = await POST(
      req({
        action: 'ratify',
        proposal_id: precedentProposalId('security', flags),
        proposal: { rule: 'precedent_grant', action_type: 'security', precedent_flags: flags },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not eligible/);
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('rejects malformed precedent_flags', async () => {
    for (const bad of [undefined, [], 'destructive', [1, 2]]) {
      const res = await POST(
        req({
          action: 'ratify',
          proposal_id: VALID_ID,
          proposal: { rule: 'precedent_grant', action_type: 'cleanup', precedent_flags: bad },
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(mockCreateGrant).not.toHaveBeenCalled();
  });

  it('never consults getPolicyForLoosening — a precedent edits no policy', async () => {
    await POST(ratify());
    expect(mockGetPolicy).not.toHaveBeenCalled();
  });
});

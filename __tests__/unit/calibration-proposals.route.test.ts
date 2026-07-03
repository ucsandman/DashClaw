/**
 * GET/POST /api/calibration/proposals — owner roadmap v2.6b (calibration
 * proposals human surface). Spec:
 * docs/superpowers/specs/2026-07-02-calibration-proposals-human-surface-design.md
 *
 * The real (pure) mining pipeline runs unmocked; only the DB-facing
 * repository and audit logging are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';
import { candidateId, shapeKey } from '../../app/lib/calibration-mining.js';

function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockSql,
  mockLoadDecisionEventsForOrg,
  mockLoadUploadedSampleEventsForOrg,
  mockGetProposalDecisions,
  mockUpsertProposalDecision,
  mockDeleteProposalDecision,
  mockMarkProposalForged,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockLoadDecisionEventsForOrg: vi.fn(),
  mockLoadUploadedSampleEventsForOrg: vi.fn(),
  mockGetProposalDecisions: vi.fn(),
  mockUpsertProposalDecision: vi.fn(),
  mockDeleteProposalDecision: vi.fn(),
  mockMarkProposalForged: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/calibration.repository.js', () => ({
  loadDecisionEventsForOrg: mockLoadDecisionEventsForOrg,
  loadUploadedSampleEventsForOrg: mockLoadUploadedSampleEventsForOrg,
  getProposalDecisions: mockGetProposalDecisions,
  upsertProposalDecision: mockUpsertProposalDecision,
  deleteProposalDecision: mockDeleteProposalDecision,
  markProposalForged: mockMarkProposalForged,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET, POST } from '@/api/calibration/proposals/route.js';

function adminHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_alice', ...extra };
}
function memberHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'member', 'x-user-id': 'user_bob', ...extra };
}

// One human-approved decision at risk 75 → an over_scored_benign candidate.
const BENIGN_APPROVED_EVENT = {
  id: 'gd_1',
  origin: 'decision',
  agent_id: 'real-agent',
  action_id: 'act_1',
  risk_score: 75,
  decision: 'require_approval',
  approved: true,
  denied: false,
  outcome_status: 'completed',
  bash_intent: null,
  action_type: 'code.edit',
  declared_goal: 'push release branch',
  command_shape: null,
  risk_breakdown: null,
};
const EXPECTED_R1_ID = candidateId('over_scored_benign', shapeKey(BENIGN_APPROVED_EVENT));

const SYNTHETIC_EVENT = { ...BENIGN_APPROVED_EVENT, id: 'gd_2', agent_id: 'smoke-abc-123' };

const VALID_SNAPSHOT = {
  rule: 'over_scored_benign',
  suggested_label: 'benign',
  suggested_name: 'push-release-branch',
  evidence_tier: 'human_approved',
  count: 1,
  risk_min: 75,
  risk_max: 75,
  provenance: 'mined 2026-07-02 (window 30d): over_scored_benign cv_x, 1 event(s), tier human_approved',
  ratify_command: 'npm run calibration:add -- --action act_1 --label benign --name push-release-branch --source "x"',
  needs_manual_context: false,
  representative: { action_type: 'code.edit', declared_goal: 'push release branch' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  mockLoadDecisionEventsForOrg.mockResolvedValue({ events: [], truncated: false });
  mockLoadUploadedSampleEventsForOrg.mockResolvedValue([]);
  mockGetProposalDecisions.mockResolvedValue([]);
  mockUpsertProposalDecision.mockResolvedValue({ id: 1, proposal_id: 'cv_x', decision: 'ratified' });
  mockDeleteProposalDecision.mockResolvedValue(true);
  mockMarkProposalForged.mockResolvedValue('ok');
});

describe('GET /api/calibration/proposals', () => {
  it('mines events into pending proposals and reports inputs honestly', async () => {
    mockLoadDecisionEventsForOrg.mockResolvedValue({
      events: [BENIGN_APPROVED_EVENT],
      truncated: false,
    });
    const res = await GET(
      makeRequest('http://localhost/api/calibration/proposals', { headers: memberHeaders() }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.window_days).toBe(30);
    expect(data.inputs).toMatchObject({
      decisions: 1,
      decisions_truncated_at_limit: false,
      uploaded_samples: 0,
      synthetic_excluded: 0,
    });
    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0]).toMatchObject({
      candidate_id: EXPECTED_R1_ID,
      rule: 'over_scored_benign',
      status: 'pending',
      decision: null,
    });
    expect(data.proposals[0].ratify_command).toContain('--action act_1');
    expect(data.counts).toEqual({ pending: 1, ratified: 0, dismissed: 0, forged: 0 });
  });

  it('always excludes synthetic platform traffic (no HTTP escape hatch)', async () => {
    mockLoadDecisionEventsForOrg.mockResolvedValue({
      events: [SYNTHETIC_EVENT],
      truncated: false,
    });
    const res = await GET(
      makeRequest('http://localhost/api/calibration/proposals?include_synthetic=1', {
        headers: memberHeaders(),
      }),
    );
    const data = await res.json();
    expect(data.proposals).toHaveLength(0);
    expect(data.inputs.synthetic_excluded).toBe(1);
  });

  it('joins persisted decisions by candidate id → ratified / forged status', async () => {
    mockLoadDecisionEventsForOrg.mockResolvedValue({
      events: [BENIGN_APPROVED_EVENT],
      truncated: false,
    });
    mockGetProposalDecisions.mockResolvedValue([
      {
        proposal_id: EXPECTED_R1_ID,
        rule: 'over_scored_benign',
        decision: 'ratified',
        reason: null,
        decided_by: 'user_alice',
        decided_at: '2026-07-02T00:00:00Z',
        forged_at: null,
        vector_name: null,
      },
    ]);
    const res = await GET(
      makeRequest('http://localhost/api/calibration/proposals', { headers: memberHeaders() }),
    );
    const data = await res.json();
    expect(data.proposals[0].status).toBe('ratified');
    expect(data.proposals[0].decision.decided_by).toBe('user_alice');
    expect(data.counts).toEqual({ pending: 0, ratified: 1, dismissed: 0, forged: 0 });
  });

  it('surfaces orphan ratified decisions from their snapshot (maintainer queue survives window aging)', async () => {
    mockGetProposalDecisions.mockResolvedValue([
      {
        proposal_id: 'cv_feedfeedfeedfeed',
        rule: 'repeated_approvals',
        decision: 'ratified',
        suggested_label: 'benign',
        suggested_name: 'old-shape',
        provenance: 'mined earlier',
        ratify_command: 'npm run calibration:add -- --command "x" --label benign --name old-shape --source "y"',
        representative: { action_type: 'bash.command' },
        reason: null,
        decided_by: 'user_alice',
        decided_at: '2026-06-01T00:00:00Z',
        forged_at: null,
        vector_name: null,
      },
      {
        proposal_id: 'cv_deaddeaddeaddead',
        rule: 'over_scored_benign',
        decision: 'dismissed',
        reason: 'noise',
        decided_by: 'user_alice',
        decided_at: '2026-06-01T00:00:00Z',
        forged_at: null,
        vector_name: null,
      },
    ]);
    const res = await GET(
      makeRequest('http://localhost/api/calibration/proposals', { headers: memberHeaders() }),
    );
    const data = await res.json();
    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0]).toMatchObject({
      candidate_id: 'cv_feedfeedfeedfeed',
      status: 'ratified',
      from_snapshot: true,
      suggested_name: 'old-shape',
    });
  });

  it('?status=ratified filters, counts stay pre-filter', async () => {
    mockLoadDecisionEventsForOrg.mockResolvedValue({
      events: [BENIGN_APPROVED_EVENT],
      truncated: false,
    });
    const res = await GET(
      makeRequest('http://localhost/api/calibration/proposals?status=ratified', {
        headers: memberHeaders(),
      }),
    );
    const data = await res.json();
    expect(data.proposals).toHaveLength(0);
    expect(data.counts.pending).toBe(1);
  });

  it('clamps days to 7–90', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/calibration/proposals?days=999', {
        headers: memberHeaders(),
      }),
    );
    expect((await res.json()).window_days).toBe(90);
    const res2 = await GET(
      makeRequest('http://localhost/api/calibration/proposals?days=1', {
        headers: memberHeaders(),
      }),
    );
    expect((await res2.json()).window_days).toBe(7);
  });
});

describe('POST /api/calibration/proposals', () => {
  it('403 for non-admin, writes nothing', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: memberHeaders(),
        body: { action: 'ratify', proposal_id: 'cv_0123456789abcdef', proposal: VALID_SNAPSHOT },
      }),
    );
    expect(res.status).toBe(403);
    expect(mockUpsertProposalDecision).not.toHaveBeenCalled();
  });

  it('bad proposal_id → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'ratify', proposal_id: 'ptp_0123456789abcdef', proposal: VALID_SNAPSHOT },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('ratify without a snapshot → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'ratify', proposal_id: 'cv_0123456789abcdef' },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsertProposalDecision).not.toHaveBeenCalled();
  });

  it('ratify with a bad rule / label / name → 400', async () => {
    for (const bad of [
      { ...VALID_SNAPSHOT, rule: 'made_up_rule' },
      { ...VALID_SNAPSHOT, suggested_label: 'harmless' },
      { ...VALID_SNAPSHOT, suggested_name: 'Not Kebab!' },
    ]) {
      const res = await POST(
        makeRequest('http://localhost/api/calibration/proposals', {
          headers: adminHeaders(),
          body: { action: 'ratify', proposal_id: 'cv_0123456789abcdef', proposal: bad },
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(mockUpsertProposalDecision).not.toHaveBeenCalled();
  });

  it('happy ratify → 200, upserts, audits calibration_proposal.ratified', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'ratify', proposal_id: 'cv_0123456789abcdef', proposal: VALID_SNAPSHOT },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    expect(mockUpsertProposalDecision).toHaveBeenCalledTimes(1);
    const [, orgArg, input] = mockUpsertProposalDecision.mock.calls[0]!;
    expect(orgArg).toBe('org_1');
    expect(input).toMatchObject({
      proposalId: 'cv_0123456789abcdef',
      rule: 'over_scored_benign',
      decision: 'ratified',
      suggestedName: 'push-release-branch',
      decidedBy: 'user_alice',
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity.mock.calls[0]![0].action).toBe('calibration_proposal.ratified');
  });

  it('dismiss without a reason → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'dismiss', proposal_id: 'cv_0123456789abcdef' },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsertProposalDecision).not.toHaveBeenCalled();
  });

  it('happy dismiss → 200 with decision dismissed', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: {
          action: 'dismiss',
          proposal_id: 'cv_0123456789abcdef',
          proposal: VALID_SNAPSHOT,
          reason: 'synthetic-looking noise',
        },
      }),
    );
    expect(res.status).toBe(200);
    const [, , input] = mockUpsertProposalDecision.mock.calls[0]!;
    expect(input.decision).toBe('dismissed');
    expect(input.reason).toBe('synthetic-looking noise');
    expect(mockLogActivity.mock.calls[0]![0].action).toBe('calibration_proposal.dismissed');
  });

  it('undo when nothing recorded → 404', async () => {
    mockDeleteProposalDecision.mockResolvedValue(false);
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'undo', proposal_id: 'cv_0123456789abcdef' },
      }),
    );
    expect(res.status).toBe(404);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('happy undo → 200 and audits', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'undo', proposal_id: 'cv_0123456789abcdef' },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogActivity.mock.calls[0]![0].action).toBe('calibration_proposal.undone');
  });

  it('mark_forged: 404 when unknown, 409 when not ratified, 200 when ok', async () => {
    mockMarkProposalForged.mockResolvedValue('not_found');
    let res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'mark_forged', proposal_id: 'cv_0123456789abcdef', vector_name: 'git-status' },
      }),
    );
    expect(res.status).toBe(404);

    mockMarkProposalForged.mockResolvedValue('not_ratified');
    res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'mark_forged', proposal_id: 'cv_0123456789abcdef', vector_name: 'git-status' },
      }),
    );
    expect(res.status).toBe(409);

    mockMarkProposalForged.mockResolvedValue('ok');
    res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'mark_forged', proposal_id: 'cv_0123456789abcdef', vector_name: 'git-status' },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogActivity.mock.calls.at(-1)![0].action).toBe('calibration_proposal.forged');
  });

  it('mark_forged requires a kebab-case vector_name → 400', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/calibration/proposals', {
        headers: adminHeaders(),
        body: { action: 'mark_forged', proposal_id: 'cv_0123456789abcdef', vector_name: 'Bad Name' },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockMarkProposalForged).not.toHaveBeenCalled();
  });
});

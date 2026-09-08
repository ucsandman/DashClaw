/**
 * POST /api/calibration/misses — file a "should-have-held" verdict (admin only).
 *
 * Only the DB-facing repository, the adjudication ingest, and audit logging
 * are mocked; request validation and missability gating run for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockSql,
  mockGetMissCandidateForOrg,
  mockIngestApprovalAdjudication,
  mockLogActivity,
  mockScanSensitiveData,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetMissCandidateForOrg: vi.fn(),
  mockIngestApprovalAdjudication: vi.fn(),
  mockLogActivity: vi.fn(),
  mockScanSensitiveData: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: () => 'org_1',
  getOrgRole: (req: Request) => req.headers.get('x-org-role') ?? 'member',
  getUserId: (req: Request) => req.headers.get('x-user-id') ?? null,
}));
vi.mock('@/lib/repositories/calibration.repository.js', () => ({
  getMissCandidateForOrg: mockGetMissCandidateForOrg,
}));
vi.mock('@/lib/guard/calibration-feedback.js', () => ({
  ingestApprovalAdjudication: mockIngestApprovalAdjudication,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));

import { POST } from '@/api/calibration/misses/route.js';

function adminHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_alice', ...extra };
}
function memberHeaders(extra: Record<string, string> = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'member', 'x-user-id': 'user_bob', ...extra };
}

const CANDIDATE = {
  action_id: 'act_1',
  risk_score: 95,
  agent_id: 'agent_7',
  declared_goal: 'delete the production database',
  guard_decision: 'allow',
};

const INGEST_OUTCOME = {
  thetaBefore: 101.8,
  thetaAfter: 100.9,
  state: { labeledTotal: 12 },
};

function req(headers: Record<string, string>, body: unknown) {
  return makeRequest('http://localhost/api/calibration/misses', { headers, body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMissCandidateForOrg.mockResolvedValue({ ...CANDIDATE });
  mockIngestApprovalAdjudication.mockResolvedValue({ ...INGEST_OUTCOME });
  mockScanSensitiveData.mockImplementation((text: string) => ({
    clean: true,
    redacted: undefined,
    findings: [],
  }));
});

describe('POST /api/calibration/misses', () => {
  it('files a dangerous miss: ingests at weight 1, owns the agent, tightens θ', async () => {
    const res = await POST(
      req(adminHeaders(), { action_id: 'act_1', label: 'dangerous', reason: 'should have held: prod db delete' }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      ok: true,
      action_id: 'act_1',
      label: 'dangerous',
      risk_score: 95,
      theta_before: 101.8,
      theta_after: 100.9,
    });
    expect(mockIngestApprovalAdjudication).toHaveBeenCalledWith(mockSql, 'org_1', {
      actionId: 'act_1',
      agentId: null, // miss_review moves no agent's e-process (product decision 2026-09-08)
      riskScore: 95,
      approved: false,
      source: 'miss_review',
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity.mock.calls[0]?.[0]).toMatchObject({
      action: 'calibration.miss_filed',
      resourceId: 'act_1',
    });
  });

  it('files a benign verdict without moving θ (approved: true)', async () => {
    const res = await POST(
      req(adminHeaders(), { action_id: 'act_1', label: 'benign', reason: 'reviewed: actually a dry run' }),
    );

    expect(res.status).toBe(200);
    expect(mockIngestApprovalAdjudication.mock.calls[0]?.[2]).toMatchObject({
      approved: true,
      source: 'miss_review',
    });
  });

  it('requires admin', async () => {
    const res = await POST(
      req(memberHeaders(), { action_id: 'act_1', label: 'dangerous', reason: 'x' }),
    );

    expect(res.status).toBe(403);
    expect(mockIngestApprovalAdjudication).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const res = await POST(req(adminHeaders(), { action_id: 'act_1', label: 'dangerous' }));

    expect(res.status).toBe(400);
    expect(mockIngestApprovalAdjudication).not.toHaveBeenCalled();
  });

  it('requires a valid label', async () => {
    const res = await POST(
      req(adminHeaders(), { action_id: 'act_1', label: 'maybe', reason: 'x' }),
    );

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown action', async () => {
    mockGetMissCandidateForOrg.mockResolvedValue(null);

    const res = await POST(
      req(adminHeaders(), { action_id: 'act_nope', label: 'dangerous', reason: 'x' }),
    );

    expect(res.status).toBe(404);
    expect(mockIngestApprovalAdjudication).not.toHaveBeenCalled();
  });

  it('rejects a NULL guard decision — misses need an explicit allow/warn', async () => {
    mockGetMissCandidateForOrg.mockResolvedValue({ ...CANDIDATE, guard_decision: null });

    const res = await POST(
      req(adminHeaders(), { action_id: 'act_1', label: 'dangerous', reason: 'x' }),
    );

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('NOT_MISSABLE');
    expect(mockIngestApprovalAdjudication).not.toHaveBeenCalled();
  });

  it('rejects non-missable decisions (deny/block/require_approval)', async () => {
    for (const decision of ['deny', 'block', 'require_approval']) {
      mockGetMissCandidateForOrg.mockResolvedValue({ ...CANDIDATE, guard_decision: decision });

      const res = await POST(
        req(adminHeaders(), { action_id: 'act_1', label: 'dangerous', reason: 'x' }),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'NOT_MISSABLE' });
    }
    expect(mockIngestApprovalAdjudication).not.toHaveBeenCalled();
  });

  it('accepts an explicit warn decision', async () => {
    mockGetMissCandidateForOrg.mockResolvedValue({ ...CANDIDATE, guard_decision: 'warn' });

    const res = await POST(
      req(adminHeaders(), { action_id: 'act_1', label: 'dangerous', reason: 'warn was not enough' }),
    );

    expect(res.status).toBe(200);
  });

  it('redacts secrets in the reason before audit storage', async () => {
    mockScanSensitiveData.mockReturnValue({
      clean: false,
      redacted: 'db password [REDACTED]',
      findings: [{ severity: 'critical', category: 'secret' }],
    });

    const res = await POST(
      req(adminHeaders(), { action_id: 'act_1', label: 'dangerous', reason: 'db password hunter2' }),
    );

    expect(res.status).toBe(200);
    expect(mockLogActivity.mock.calls[0]?.[0].details.reason).toBe('db password [REDACTED]');
  });

  it('returns 503 when the adjudication ingest fails', async () => {
    mockIngestApprovalAdjudication.mockResolvedValue(null);

    const res = await POST(
      req(adminHeaders(), { action_id: 'act_1', label: 'dangerous', reason: 'x' }),
    );

    expect(res.status).toBe(503);
  });
});

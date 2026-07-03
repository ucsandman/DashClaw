import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostureFinding, Dimension } from '../../app/lib/posture/types';

/**
 * Tests for GET /api/posture/findings.
 *
 * Mocks the I/O boundary (signals.ts) + db/org helpers so the route test only
 * verifies queue filtering, the risk-accepted ledger, counts, param validation,
 * and that no direct SQL is issued from the route.
 */

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  computePosturePayload: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test', getUserId: () => 'usr_test' }));
vi.mock('@/lib/posture/signals.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  computePosturePayload: m.computePosturePayload,
}));

const { GET } = await import('@/api/posture/findings/route.js');

function finding(
  key: string,
  status: PostureFinding['status'],
  dimension: Dimension = 'enforcement',
  scoreDelta = 3,
): PostureFinding {
  return {
    key,
    dimension,
    severity: 'high',
    title: `Unit "${key}" is not fully governed`,
    evidence: { observedCount: 5, exampleActionIds: [] },
    scoreDelta,
    fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: {} },
    status,
  };
}

function req(query = ''): Request {
  return new Request(`http://localhost/api/posture/findings${query}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.computePosturePayload.mockResolvedValue({
    score: { score: 70, status: 'needs_attention', cappedBy: null, dimensions: [] },
    findings: [
      finding('open-a', 'open', 'enforcement', 6),
      finding('drafted-b', 'drafted', 'enforcement', 4),
      finding('snoozed-c', 'snoozed', 'spend', 3),
      finding('accepted-d', 'accepted_risk', 'spend', 2),
      finding('resolved-e', 'resolved', 'identity', 1),
    ],
    unitCount: 5,
  });
});

describe('GET /api/posture/findings', () => {
  it('returns { findings, riskAccepted, counts } with 200', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('findings');
    expect(body).toHaveProperty('riskAccepted');
    expect(body).toHaveProperty('counts');
  });

  it('default queue is the actionable set (open + drafted), excluding resolved/snoozed/accepted', async () => {
    const res = await GET(req());
    const body = await res.json() as { findings: PostureFinding[] };
    expect(body.findings.map((f) => f.key)).toEqual(['open-a', 'drafted-b']);
  });

  it('preserves the engine ordering (scoreDelta desc) — does not re-sort', async () => {
    const res = await GET(req());
    const body = await res.json() as { findings: PostureFinding[] };
    expect(body.findings[0]!.scoreDelta).toBeGreaterThanOrEqual(body.findings[1]!.scoreDelta);
  });

  it('?status=snoozed returns exactly the snoozed findings', async () => {
    const res = await GET(req('?status=snoozed'));
    const body = await res.json() as { findings: PostureFinding[] };
    expect(body.findings.map((f) => f.key)).toEqual(['snoozed-c']);
  });

  it('?dimension=spend filters the queue to that dimension', async () => {
    // spend has no open/drafted findings in the fixture → empty actionable queue
    const res = await GET(req('?dimension=spend'));
    const body = await res.json() as { findings: PostureFinding[] };
    expect(body.findings).toEqual([]);
  });

  it('combines ?status and ?dimension', async () => {
    const res = await GET(req('?status=accepted_risk&dimension=spend'));
    const body = await res.json() as { findings: PostureFinding[] };
    expect(body.findings.map((f) => f.key)).toEqual(['accepted-d']);
  });

  it('riskAccepted ledger holds snoozed + accepted_risk findings', async () => {
    const res = await GET(req());
    const body = await res.json() as { riskAccepted: PostureFinding[] };
    expect(body.riskAccepted.map((f) => f.key).sort()).toEqual(['accepted-d', 'snoozed-c']);
  });

  it('counts reflect every status', async () => {
    const res = await GET(req());
    const body = await res.json() as { counts: Record<string, number> };
    expect(body.counts).toMatchObject({
      open: 1, drafted: 1, snoozed: 1, accepted_risk: 1, resolved: 1, total: 5,
    });
  });

  it('rejects an invalid status with 400', async () => {
    const res = await GET(req('?status=bogus'));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid dimension with 400', async () => {
    const res = await GET(req('?dimension=nope'));
    expect(res.status).toBe(400);
  });

  it('does NOT call sql directly (route-sql guardrail)', async () => {
    await GET(req());
    expect(m.sql).not.toHaveBeenCalled();
  });

  it('returns 500 when computePosturePayload throws', async () => {
    m.computePosturePayload.mockRejectedValue(new Error('DB down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

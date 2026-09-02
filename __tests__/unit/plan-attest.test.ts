// Plan Attestation (drizzle/0075; RFC 2026-07-06 "Attest before you act").
// Two halves: the pure hash + the repository seam against a scripted sql tag
// (mock shape copied from plans.repository.test.ts), and the route's status
// mapping against a mocked repository (mock style copied from
// containment-route.test.ts / plans-review-route.test.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

// The route half of this file mocks the plans repository module, which would
// otherwise swallow the real functions the first half is testing — so the real
// ones are pulled in with importActual, deliberately bypassing that mock.
const { computePlanHash, attestPlan, createPlanWithSteps } =
  await vi.importActual<typeof import('../../app/lib/repositories/plans.repository')>(
    '../../app/lib/repositories/plans.repository',
  );

function makeRequest(url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Request {
  return rawRequest(url, opts) as unknown as Request;
}

type SqlCall = { text: string; v: unknown[] };
type ScriptEntry = unknown[] | ((call: SqlCall) => unknown[]);

function sqlMock(script: ScriptEntry[]) {
  const calls: SqlCall[] = [];
  let i = 0;
  const tag = ((strings: TemplateStringsArray, ...v: unknown[]) => {
    const call: SqlCall = { text: strings.join('?'), v };
    calls.push(call);
    const entry = script[i++];
    return Promise.resolve(entry === undefined ? [] : typeof entry === 'function' ? entry(call) : entry);
  }) as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
    query: (text: string, params?: unknown[]) => Promise<unknown[]>;
    calls: SqlCall[];
  };
  tag.calls = calls;
  tag.query = async () => [];
  return tag;
}

const STEPS = [
  { seq: 1, action_type: 'code_change', act_content_hash: 'sha256:aaa' },
  { seq: 2, action_type: 'deploy', act_content_hash: null },
];
const HASH_INPUT = { agentId: 'agent-a', declaredGoal: 'ship the feature', steps: STEPS };

describe('computePlanHash', () => {
  it('is deterministic and 64-hex', () => {
    const a = computePlanHash(HASH_INPUT);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(computePlanHash(HASH_INPUT)).toBe(a);
  });

  it('is independent of the order steps are passed in (sorted by seq)', () => {
    expect(computePlanHash({ ...HASH_INPUT, steps: [...STEPS].reverse() }))
      .toBe(computePlanHash(HASH_INPUT));
  });

  it('does not mutate the passed-in step array while sorting', () => {
    const steps = [...STEPS].reverse();
    computePlanHash({ ...HASH_INPUT, steps });
    expect(steps[0]!.seq).toBe(2);
  });

  it('changes when agent, goal, seq, action_type or act hash changes', () => {
    const base = computePlanHash(HASH_INPUT);
    expect(computePlanHash({ ...HASH_INPUT, agentId: 'agent-b' })).not.toBe(base);
    expect(computePlanHash({ ...HASH_INPUT, declaredGoal: 'something else' })).not.toBe(base);
    expect(computePlanHash({ ...HASH_INPUT, steps: [{ ...STEPS[0]!, seq: 3 }, STEPS[1]!] })).not.toBe(base);
    expect(computePlanHash({ ...HASH_INPUT, steps: [{ ...STEPS[0]!, action_type: 'deploy' }, STEPS[1]!] })).not.toBe(base);
    expect(computePlanHash({ ...HASH_INPUT, steps: [{ ...STEPS[0]!, act_content_hash: 'sha256:bbb' }, STEPS[1]!] })).not.toBe(base);
  });

  it('swapping two steps seq values changes the hash (step order is bound)', () => {
    const swapped = [
      { ...STEPS[0]!, seq: 2 },
      { ...STEPS[1]!, seq: 1 },
    ];
    expect(computePlanHash({ ...HASH_INPUT, steps: swapped })).not.toBe(computePlanHash(HASH_INPUT));
  });
});

describe('createPlanWithSteps pins plan_hash at submission', () => {
  it('stores the hash of the act hashes it just computed', async () => {
    const sql = sqlMock([
      (c) => [{ plan_id: c.v[0], plan_hash: c.v[6] }],
      (c) => [{ step_id: c.v[0], seq: c.v[3], action_type: c.v[4], act_content_hash: c.v[7] }],
      (c) => [{ step_id: c.v[0], seq: c.v[3], action_type: c.v[4], act_content_hash: c.v[7] }],
    ]);
    const created = (await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship it', ttlMinutes: 60, maxPending: 10,
      steps: [
        { action_type: 'code_change', step_goal: 'edit', act: { kind: 'file', file: { path: 'a.ts' } } },
        { action_type: 'deploy', step_goal: 'deploy' },
      ],
    }))!;
    const planHash = (created.plan as { plan_hash: string }).plan_hash;
    expect(planHash).toMatch(/^[0-9a-f]{64}$/);
    // Recomputing from the persisted step rows reproduces it exactly — the
    // stored pin is derivable by any runner holding the plan, which is the
    // whole point of attesting by hash rather than by plan id.
    expect(computePlanHash({
      agentId: 'agent-a',
      declaredGoal: 'ship it',
      steps: (created.steps as Array<{ seq: number; action_type: string; act_content_hash: string | null }>),
    })).toBe(planHash);
    expect(sql.calls[0]!.text).toContain('plan_hash');
  });
});

// Row the SELECT in attestPlan returns; overridden per case.
function planRow(over: Record<string, unknown> = {}) {
  return {
    plan_id: 'pa_1',
    status: 'approved',
    plan_hash: 'HASH',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    // Liveness comes from the DB clock via this derived column, not from a
    // JS comparison on expires_at — the tests script it the way SQL returns it.
    is_expired: false,
    steps_remaining: 3,
    ...over,
  };
}

describe('attestPlan', () => {
  it('not_found when the plan is not in this org, and journals nothing', async () => {
    const sql = sqlMock([[]]);
    expect(await attestPlan(sql as never, 'org_1', 'pa_missing', 'HASH'))
      .toEqual({ ok: false, reason: 'not_found' });
    // Only the SELECT ran — there is no row to stamp a counter on.
    expect(sql.calls).toHaveLength(1);
  });

  it.each([
    ['revoked', 'revoked'],
    ['denied', 'revoked'],
    ['pending', 'not_approved'],
    ['previewing', 'not_approved'],
    ['expired', 'not_approved'],
  ])('status %s maps to %s', async (status, reason) => {
    const sql = sqlMock([[planRow({ status })]]);
    expect(await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH')).toEqual({ ok: false, reason });
  });

  it('expired when the DB says expires_at has lapsed', async () => {
    const sql = sqlMock([[planRow({ expires_at: new Date(Date.now() - 1000).toISOString(), is_expired: true })]]);
    expect(await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH'))
      .toEqual({ ok: false, reason: 'expired' });
    // The predicate is evaluated in SQL against now(), not in JS against the
    // app clock — the two can disagree on serverless.
    expect(sql.calls[0]!.text).toContain('expires_at <= now()');
  });

  it('expired (fail closed) when an approved plan has no expires_at at all', async () => {
    const sql = sqlMock([[planRow({ expires_at: null, is_expired: true })]]);
    expect(await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH'))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('expired (fail closed) when the row somehow carries no is_expired verdict', async () => {
    const sql = sqlMock([[planRow({ is_expired: undefined })]]);
    expect(await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH'))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('hash_mismatch when the stored hash differs, and the reason carries no hash', async () => {
    const sql = sqlMock([[planRow()]]);
    const result = await attestPlan(sql as never, 'org_1', 'pa_1', 'OTHER');
    expect(result).toEqual({ ok: false, reason: 'hash_mismatch' });
    expect(JSON.stringify(result)).not.toContain('HASH');
  });

  it('hash_mismatch (fail closed) when the stored hash is NULL (pre-0075 row)', async () => {
    const sql = sqlMock([[planRow({ plan_hash: null })]]);
    expect(await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH'))
      .toEqual({ ok: false, reason: 'hash_mismatch' });
  });

  it('partially_approved counts as approved', async () => {
    const sql = sqlMock([[planRow({ status: 'partially_approved' })]]);
    const result = await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH');
    expect(result.ok).toBe(true);
  });

  it('success returns steps_remaining and journals result "ok"', async () => {
    const sql = sqlMock([[planRow({ steps_remaining: 2 })]]);
    const result = await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH');
    expect(result).toMatchObject({ ok: true, plan_id: 'pa_1', plan_hash: 'HASH', steps_remaining: 2 });
    const update = sql.calls[1]!;
    expect(update.text).toContain('attest_count = attest_count + 1');
    expect(update.text).toContain('attested_at = now()');
    expect(update.v).toContain('ok');
  });

  it('journals the failure reason on the row too (a hammering runner is the signal)', async () => {
    const sql = sqlMock([[planRow({ status: 'revoked' })]]);
    await attestPlan(sql as never, 'org_1', 'pa_1', 'HASH');
    expect(sql.calls).toHaveLength(2);
    expect(sql.calls[1]!.v).toContain('revoked');
  });
});

// ── Route: status mapping and non-leakage ──────────────────────────────────

const { mockGetSql, mockGetOrgId, mockGetUserId, mockAttestPlan, mockLogActivity } = vi.hoisted(() => ({
  mockGetSql: vi.fn(),
  mockGetOrgId: vi.fn(() => 'org_test'),
  mockGetUserId: vi.fn(() => 'user_1'),
  mockAttestPlan: vi.fn(),
  mockLogActivity: vi.fn(),
}));

// after() callbacks run immediately in tests (the route defers its audit write).
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (cb: () => unknown) => {
      try {
        const r = cb();
        if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
      } catch { /* deferred work must not sink the test request */ }
    },
  };
});
vi.mock('@/lib/db.js', () => ({ getSql: () => mockGetSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId, getUserId: mockGetUserId }));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.mock('@/lib/repositories/plans.repository.js', () => ({ attestPlan: mockAttestPlan }));

const { POST } = await import('@/api/plans/[planId]/attest/route.js');
const params = Promise.resolve({ planId: 'pa_1' });

function postReq(body: unknown): Request {
  return makeRequest('http://localhost:3000/api/plans/pa_1/attest', {
    headers: { 'x-api-key': 'oc_live_test' },
    body,
  });
}

describe('POST /api/plans/[planId]/attest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
    mockGetUserId.mockReturnValue('user_1');
  });

  it('400 without a plan_hash — an attestation with nothing to attest is not one', async () => {
    const res = await POST(postReq({}), { params });
    expect(res.status).toBe(400);
    expect(mockAttestPlan).not.toHaveBeenCalled();
  });

  it('200 on ok, passing the body hash straight through', async () => {
    mockAttestPlan.mockResolvedValue({
      ok: true, plan_id: 'pa_1', plan_hash: 'HASH', expires_at: '2026-09-01T00:00:00.000Z', steps_remaining: 2,
    });
    const res = await POST(postReq({ plan_hash: 'HASH' }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, steps_remaining: 2 });
    expect(mockAttestPlan).toHaveBeenCalledWith(mockGetSql, 'org_test', 'pa_1', 'HASH');
  });

  it('404 for not_found, 403 for every other refusal', async () => {
    for (const [reason, status] of [
      ['not_found', 404], ['not_approved', 403], ['expired', 403], ['revoked', 403], ['hash_mismatch', 403],
    ] as const) {
      mockAttestPlan.mockResolvedValue({ ok: false, reason });
      const res = await POST(postReq({ plan_hash: 'WRONG' }), { params });
      expect(res.status, reason).toBe(status);
      expect(await res.json()).toEqual({ ok: false, reason });
    }
  });

  it('a hash_mismatch response carries the reason and nothing else — never the stored hash', async () => {
    mockAttestPlan.mockResolvedValue({ ok: false, reason: 'hash_mismatch' });
    const res = await POST(postReq({ plan_hash: 'WRONG' }), { params });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['ok', 'reason']);
    expect(JSON.stringify(body)).not.toContain('STORED');
  });

  it('journals every call, pass or fail, with the presented hash and the result', async () => {
    mockAttestPlan.mockResolvedValue({ ok: false, reason: 'revoked' });
    await POST(postReq({ plan_hash: 'HASH' }), { params });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'plan.attested',
        resourceId: 'pa_1',
        details: { plan_id: 'pa_1', plan_hash: 'HASH', result: 'revoked' },
      }),
      mockGetSql,
    );
  });
});

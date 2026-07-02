import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec §18 regression closure — two gaps:
 *
 *   §18.1  Missing organization context — org is ALWAYS derived server-side
 *          from the authenticated API key, never from a client-supplied
 *          x-org-id header. A request with no key is rejected; a request that
 *          spoofs x-org-id has it stripped and replaced with the key's org.
 *
 *   §18.3 / §24.27  No repricing during aggregation — getCostAggregation and
 *          getFleetSpend SUM the STORED cost_estimate / spend_amount columns
 *          verbatim and never recompute price from model + tokens. A row whose
 *          stored cost is deliberately inconsistent with current pricing must
 *          still flow through unchanged.
 *
 * Each test asserts the REAL production invariant against the real modules.
 */

// ---------------------------------------------------------------------------
// §18.1 — middleware is the org-context authority (mirrors middleware-auth.test.js)
// ---------------------------------------------------------------------------
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware } = await import('../../middleware.js');

// Next.js forwards request headers set via NextResponse.next({ request: { headers } })
// as response headers prefixed `x-middleware-request-`. This is how we observe
// the org context the middleware injected downstream to the route.
function forwardedOrgId(res: { headers: Headers }): string | null {
  return res.headers.get('x-middleware-request-x-org-id');
}

let keyCounter = 0;
const uniqueKey = () => `oc_live_s18_${++keyCounter}`;

function req(
  pathname: string,
  { apiKey, method = 'GET', headers = {} }: { apiKey?: string; method?: string; headers?: Record<string, string> } = {},
) {
  const h: Record<string, string> = { ...headers };
  if (apiKey) h['x-api-key'] = apiKey;
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers(h),
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
  } as unknown as Request;
}

describe('§18.1 org context is server-derived from the API key, not the client', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    // Neon URL keeps resolveApiKey on the inline (mocked-neon) path; a non-Neon
    // URL in self_host mode delegates to the internal resolve-key route instead
    // (covered by middleware-auth.test.js).
    vi.stubEnv('DATABASE_URL', 'postgres://ep-s18.neon.tech/db');
    vi.stubEnv('DASHCLAW_API_KEY', 'oc_live_master_s18');
    vi.stubEnv('DASHCLAW_API_KEY_ORG', 'org_default');
  });

  it('§18.1: a request with NO api key is rejected 401 even when it supplies its own x-org-id', async () => {
    // The whole point: a client cannot self-grant org context. No key → 401,
    // regardless of any x-org-id header the caller attached.
    const res = await middleware(
      req('/api/actions', { headers: { origin: 'https://attacker.example', 'x-org-id': 'org_victim' } }),
    );
    expect(res.status).toBe(401);
  });

  it('§18.1: a spoofed x-org-id is STRIPPED — the forwarded org comes from the resolved key, not the header', async () => {
    // Slow-path key resolves to org_resolved while the caller spoofs org_attacker.
    // resolveApiKey row shape: { org_id, role, revoked_at, hosted_mode }.
    sqlMock.mockResolvedValue([{ org_id: 'org_resolved', role: 'admin', revoked_at: null, hosted_mode: false }]);
    const res = await middleware(
      req('/api/actions', { apiKey: uniqueKey(), headers: { 'x-org-id': 'org_attacker' } }),
    );
    expect(res.status).toBe(200);
    // The injected/forwarded org MUST be the key's org, never the spoofed header.
    expect(forwardedOrgId(res)).toBe('org_resolved');
    expect(forwardedOrgId(res)).not.toBe('org_attacker');
  });

  it('§18.1: cross-origin request supplying x-org-id but no key cannot read another org (401, no forwarded org)', async () => {
    const res = await middleware(
      req('/api/actions', { method: 'GET', headers: { origin: 'https://other.example', 'x-org-id': 'org_someone_else' } }),
    );
    expect(res.status).toBe(401);
    // A rejected request must not forward ANY org context downstream.
    expect(forwardedOrgId(res)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §18.3 / §24.27 — aggregation sums STORED cost, never reprices from model+tokens
// ---------------------------------------------------------------------------
import { getCostAggregation } from '../../app/lib/repositories/actions.repository.js';
import { getFleetSpend } from '../../app/lib/repositories/finops.repository.js';
import { getX402SpendAggregation } from '../../app/lib/repositories/x402.repository.js';

/**
 * Build a tagged-template sql mock that routes responses by the SQL text it
 * sees, so the test is robust to call order (the repo also invokes sql`` for an
 * empty agentFilter fragment). The `totals` query is the only one whose result
 * the assertions read.
 */
function makeAggSqlMock(totalsRow: Record<string, unknown>) {
  const seen: string[] = [];
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join(' ');
    seen.push(text);
    // The interpolated-fragment call (agentFilter) has no SELECT — return [].
    if (!/SELECT/i.test(text)) return Promise.resolve([]);
    // The totals query selects total_cost_usd; the by_agent/by_day ones select cost_usd.
    if (/total_cost_usd/i.test(text)) return Promise.resolve([totalsRow]);
    return Promise.resolve([]);
  }) as unknown as ((s: TemplateStringsArray, ...v: unknown[]) => Promise<Record<string, unknown>[]>) & {
    seen: string[];
  };
  sql.seen = seen;
  return sql;
}

describe('§18.3 getCostAggregation sums STORED cost_estimate verbatim (no repricing)', () => {
  it('§18.3: returns the DB SUM of stored cost_estimate even when stored cost is inconsistent with model+token pricing', async () => {
    // Seed: the DB SUM(cost_estimate) over rows that include a deliberately
    // MISPRICED opus row stored at $0.01 (real opus pricing would be ~$15/$75
    // per Mtok, so model+token recompute would yield a far larger number).
    // Stored rows the DB summed:  opus @ $0.01  +  haiku @ $0.50  =  $0.51.
    const STORED_SUM = 0.51;
    const sql = makeAggSqlMock({
      total_cost_usd: STORED_SUM,
      total_tokens_in: 2_000_000, // huge token counts that would inflate any recompute
      total_tokens_out: 1_000_000,
    });

    const result = await getCostAggregation(sql as unknown as Parameters<typeof getCostAggregation>[0],'org_1', { period: '30d' });

    // The aggregate equals the STORED sum verbatim — NOT a recompute from tokens.
    expect(result.total_cost_usd).toBe(STORED_SUM);
    // Sanity: a model+token recompute of opus over 3M tokens would be >>> $0.51,
    // so equality here proves no repricing occurred.
    expect(result.total_cost_usd).toBeLessThan(1);
  });

  it('§18.3: the aggregation query SUMs the stored cost_estimate column and never multiplies tokens by a price', async () => {
    const sql = makeAggSqlMock({ total_cost_usd: 0, total_tokens_in: 0, total_tokens_out: 0 });
    await getCostAggregation(sql as unknown as Parameters<typeof getCostAggregation>[0],'org_1', { period: '30d' });

    const allSql = sql.seen.join(' || ');
    // Sums the stored column...
    expect(allSql).toMatch(/SUM\(cost_estimate\)/i);
    // ...and does NOT reprice: no pricing/rate multiplication of token columns.
    expect(allSql).not.toMatch(/tokens_in\s*\*/i);
    expect(allSql).not.toMatch(/tokens_out\s*\*/i);
    expect(allSql).not.toMatch(/price_per|rate_per|\bpricing\b/i);
  });

  it('§18.3: stays org-scoped (the SUM is bound to the requested org)', async () => {
    const calls: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push([strings.join(' '), ...values]);
      if (/total_cost_usd/i.test(strings.join(' '))) {
        return Promise.resolve([{ total_cost_usd: 0, total_tokens_in: 0, total_tokens_out: 0 }]);
      }
      return Promise.resolve([]);
    }) as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<Record<string, unknown>[]>;

    await getCostAggregation(sql as unknown as Parameters<typeof getCostAggregation>[0],'org_scoped_42', { period: '7d' });
    const boundValues = calls.flatMap((c) => c.slice(1));
    expect(boundValues).toContain('org_scoped_42');
  });
});

describe('§24.27 getFleetSpend aggregates STORED component totals verbatim (aggregation-not-fusion)', () => {
  it('§24.27: fleet_total_usd = stored agent total + stored x402 total, with no recompute', async () => {
    // Mock the owning repositories so we control the STORED component totals.
    const actionsRepo = await import('../../app/lib/repositories/actions.repository.js');
    const x402Repo = await import('../../app/lib/repositories/x402.repository.js');

    // Agent total includes the mispriced opus row's stored cost ($0.01).
    const agentSpy = vi.spyOn(actionsRepo, 'getCostAggregation').mockResolvedValue({
      total_cost_usd: 0.51,
      total_tokens_in: 2_000_000,
      total_tokens_out: 1_000_000,
      period: '30d',
      attribution: { attributed_count: 0, total_count: 0, coverage_pct: null },
      by_agent: [],
      by_day: [],
    } as Awaited<ReturnType<typeof actionsRepo.getCostAggregation>>);
    const x402Spy = vi.spyOn(x402Repo, 'getX402SpendAggregation').mockResolvedValue({
      period: '30d',
      total_spend_usd: 1.25,
      purchase_count: 3,
      by_day: [],
      by_provider: [],
    } as Awaited<ReturnType<typeof x402Repo.getX402SpendAggregation>>);

    const sql = vi.fn() as unknown as Parameters<typeof getFleetSpend>[0];
    const fleet = await getFleetSpend(sql, 'org_1', { period: '30d' });

    // Verbatim sum of the two STORED component totals — 0.51 + 1.25.
    expect(fleet.fleet_total_usd).toBeCloseTo(1.76, 10);
    expect(fleet.agent?.total_cost_usd).toBe(0.51);
    expect(fleet.x402?.total_spend_usd).toBe(1.25);
    expect(fleet.lens).toBe('fleet');

    agentSpy.mockRestore();
    x402Spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// d01 regression (Phase 13 adversarial finding) — `::real` aggregates come
// back as STRINGS from the Neon/postgres drivers (db.js registers no type
// parser). The repos must Number()-coerce, else getFleetSpend computes
// `number + string` → "5.51.25" → NaN → the headline Fleet KPI renders $0.00,
// violating §24.25 (Fleet = Agent LLM + x402). Existing finops tests mock JS
// numbers and never exercised the real driver's string return.
// ---------------------------------------------------------------------------
describe('::real driver-string coercion — Fleet Spend stays numeric (d01)', () => {
  it('getX402SpendAggregation coerces a string total_spend_usd to a number', async () => {
    const sql = ((strings: TemplateStringsArray) => {
      // Only the totals query selects `total_spend_usd`; the driver returns the
      // ::real / ::integer aggregates as STRINGS.
      if (/total_spend_usd/i.test(strings.join(' '))) {
        return Promise.resolve([{ total_spend_usd: '1.25', purchase_count: '3' }]);
      }
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof getX402SpendAggregation>[0];

    const agg = await getX402SpendAggregation(sql, 'org_1', { period: '30d' });
    expect(agg.total_spend_usd).toBe(1.25);
    expect(typeof agg.total_spend_usd).toBe('number');
    expect(agg.purchase_count).toBe(3);
  });

  it('getFleetSpend sums the component totals numerically even when a repo yields a string total', async () => {
    const actionsRepo = await import('../../app/lib/repositories/actions.repository.js');
    const x402Repo = await import('../../app/lib/repositories/x402.repository.js');
    const agentSpy = vi.spyOn(actionsRepo, 'getCostAggregation').mockResolvedValue({
      total_cost_usd: 5.5, total_tokens_in: 0, total_tokens_out: 0, period: '30d', attribution: { attributed_count: 0, total_count: 0, coverage_pct: null }, by_agent: [], by_day: [],
    } as Awaited<ReturnType<typeof actionsRepo.getCostAggregation>>);
    // Simulate the raw-driver hazard: a string total leaking past the boundary.
    const x402Spy = vi.spyOn(x402Repo, 'getX402SpendAggregation').mockResolvedValue({
      period: '30d', total_spend_usd: '1.25' as unknown as number, purchase_count: 3, by_day: [], by_provider: [],
    } as Awaited<ReturnType<typeof x402Repo.getX402SpendAggregation>>);

    const sql = vi.fn() as unknown as Parameters<typeof getFleetSpend>[0];
    const fleet = await getFleetSpend(sql, 'org_1', { period: '30d' });
    // Must be the numeric sum 6.75 — NOT the string concatenation "5.51.25" (→ NaN).
    expect(fleet.fleet_total_usd).toBeCloseTo(6.75, 10);
    expect(Number.isNaN(fleet.fleet_total_usd)).toBe(false);

    agentSpy.mockRestore();
    x402Spy.mockRestore();
  });
});

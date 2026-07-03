import { describe, it, expect, vi, beforeEach } from 'vitest';

// Approvals lifecycle hygiene (roadmap v2.3).
// Spec: docs/plans/2026-07-02-approvals-lifecycle-hygiene.md
// Pins: the expiry-stamp math, the overdue predicate (including the legacy
// NULL-stamp rule), the create-path stamping, the x402 ride-along on
// expire/sweep, and the spend-predicate exclusion of denied/expired rows.

const { mockReconcile } = vi.hoisted(() => ({
  mockReconcile: vi.fn(async () => [] as string[]),
}));
// Partial mock: the actions-repository expiry helpers must see the mocked
// reconcile, while the spend-predicate tests below exercise the REAL queries.
vi.mock('../../app/lib/repositories/x402.repository', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, reconcileStalePurchases: mockReconcile };
});

import {
  computeApprovalExpiry,
  isApprovalOverdue,
  createActionRecord,
  expireOverdueApproval,
  sweepExpiredApprovals,
  APPROVAL_RETRY_GRACE_SECONDS,
  DEFAULT_APPROVAL_WAIT_SECONDS,
} from '../../app/lib/repositories/actions.repository';
import { sumWindowSpend, sumWindowSpendByFamily, getX402SpendAggregation } from '../../app/lib/repositories/x402.repository';

type Row = Record<string, unknown>;

// Tagged-template + .query mock. Each call records the joined SQL text and
// bound values; responses come from a FIFO queue (default: empty result).
function makeSql(responses: Row[][] = []) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    // Conditional fragments (sql``) must not consume the response queue —
    // see reference_dashclaw_sql_fragment_test_gotcha.
    if (text.trim() === '') return Promise.resolve([]);
    calls.push({ text, values });
    return Promise.resolve(responses.shift() ?? []);
  }) as ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
    query: (text: string, params?: unknown[]) => Promise<Row[]>;
    calls: Array<{ text: string; values: unknown[] }>;
  };
  sql.query = (text: string, params: unknown[] = []) => {
    calls.push({ text, values: params });
    return Promise.resolve(responses.shift() ?? []);
  };
  sql.calls = calls;
  return sql;
}

beforeEach(() => {
  mockReconcile.mockClear();
});

describe('computeApprovalExpiry', () => {
  const NOW = 1_750_000_000_000;

  it('stamps declared wait + retry grace', () => {
    const iso = computeApprovalExpiry(30, NOW);
    expect(new Date(iso).getTime()).toBe(NOW + (30 + APPROVAL_RETRY_GRACE_SECONDS) * 1000);
  });

  it('falls back to the conservative default when the client declares nothing', () => {
    const iso = computeApprovalExpiry(undefined, NOW);
    expect(new Date(iso).getTime()).toBe(NOW + (DEFAULT_APPROVAL_WAIT_SECONDS + APPROVAL_RETRY_GRACE_SECONDS) * 1000);
  });

  it('clamps the declared window to 5..86400 seconds', () => {
    expect(new Date(computeApprovalExpiry(1, NOW)).getTime())
      .toBe(NOW + (5 + APPROVAL_RETRY_GRACE_SECONDS) * 1000);
    expect(new Date(computeApprovalExpiry(999_999, NOW)).getTime())
      .toBe(NOW + (86_400 + APPROVAL_RETRY_GRACE_SECONDS) * 1000);
  });

  it('treats non-numeric input as undeclared', () => {
    expect(computeApprovalExpiry('soon', NOW)).toBe(computeApprovalExpiry(undefined, NOW));
  });
});

describe('isApprovalOverdue', () => {
  const NOW = Date.now();

  it('is overdue once approval_expires_at has passed', () => {
    expect(isApprovalOverdue({ approval_expires_at: new Date(NOW - 1000).toISOString() }, NOW)).toBe(true);
    expect(isApprovalOverdue({ approval_expires_at: new Date(NOW + 1000).toISOString() }, NOW)).toBe(false);
  });

  it('legacy rows (no stamp) go overdue 24h after creation', () => {
    expect(isApprovalOverdue({ created_at: new Date(NOW - 25 * 3_600_000).toISOString() }, NOW)).toBe(true);
    expect(isApprovalOverdue({ created_at: new Date(NOW - 23 * 3_600_000).toISOString() }, NOW)).toBe(false);
  });

  it('a row with neither stamp nor created_at is never overdue', () => {
    expect(isApprovalOverdue({}, NOW)).toBe(false);
  });
});

describe('createActionRecord expiry stamping', () => {
  const payload = (actionStatus: string, wait?: number) => ({
    orgId: 'org1',
    action_id: 'act_1',
    data: { agent_id: 'a1', action_type: 'deploy', declared_goal: 'g', approval_wait_seconds: wait },
    actionStatus,
    signature: null,
    verified: false,
    timestamp_start: new Date().toISOString(),
  });

  it('stamps approval_expires_at on pending_approval rows from the declared window', async () => {
    const sql = makeSql([[{ action_id: 'act_1' }]]);
    const before = Date.now();
    await createActionRecord(sql, payload('pending_approval', 30));
    const stamp = sql.calls[0]!.values.at(-1) as string;
    const delta = (new Date(stamp).getTime() - before) / 1000;
    expect(delta).toBeGreaterThanOrEqual(30 + APPROVAL_RETRY_GRACE_SECONDS - 5);
    expect(delta).toBeLessThanOrEqual(30 + APPROVAL_RETRY_GRACE_SECONDS + 5);
  });

  it('leaves the stamp NULL for every non-pending status', async () => {
    const sql = makeSql([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload('running', 30));
    expect(sql.calls[0]!.values.at(-1)).toBeNull();
  });
});

describe('expireOverdueApproval / sweepExpiredApprovals x402 ride-along', () => {
  it('reconciles the paired purchase when the expired action is an x402 purchase', async () => {
    const sql = makeSql([[{ action_id: 'act_x', status: 'expired', action_type: 'x402_purchase' }]]);
    const row = await expireOverdueApproval(sql, 'org1', 'act_x');
    expect(row?.status).toBe('expired');
    expect(mockReconcile).toHaveBeenCalledWith(sql, 'org1', ['act_x'], 'expired', expect.stringContaining('Approval expired'));
  });

  it('does not touch x402 for non-purchase actions', async () => {
    const sql = makeSql([[{ action_id: 'act_d', status: 'expired', action_type: 'deploy' }]]);
    await expireOverdueApproval(sql, 'org1', 'act_d');
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('returns null (and reconciles nothing) when the flip loses the race', async () => {
    const sql = makeSql([[]]);
    const row = await expireOverdueApproval(sql, 'org1', 'act_r');
    expect(row).toBeNull();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('sweep flips overdue rows and reconciles only the x402 subset', async () => {
    const sql = makeSql([[
      { action_id: 'act_1', agent_id: 'a', action_type: 'deploy' },
      { action_id: 'act_2', agent_id: 'a', action_type: 'x402_purchase' },
    ]]);
    const swept = await sweepExpiredApprovals(sql, 'org1');
    expect(swept).toHaveLength(2);
    expect(sql.calls[0]!.text).toContain("status = 'pending_approval'");
    expect(mockReconcile).toHaveBeenCalledWith(sql, 'org1', ['act_2'], 'expired', expect.any(String));
  });
});

describe('x402 spend predicates exclude dead approvals', () => {
  it('sumWindowSpend excludes failed, denied and expired purchases', async () => {
    const sql = makeSql([[{ window_spend_usd: '4' }]]);
    const spend = await sumWindowSpend(sql, 'org1', { sinceIso: new Date().toISOString() });
    expect(spend).toBe(4);
    expect(sql.calls[0]!.text).toContain("execution_status NOT IN ('failed', 'denied', 'expired')");
  });

  it('sumWindowSpendByFamily shares the predicate, rolls up to the family base, and coerces ::real strings', async () => {
    const sql = makeSql([[{ agent_id: 'claude-code', window_spend_usd: '1.5' }]]);
    const rows = await sumWindowSpendByFamily(sql, 'org1', { sinceIso: new Date().toISOString() });
    expect(rows).toEqual([{ agent_id: 'claude-code', window_spend_usd: 1.5 }]);
    expect(sql.calls[0]!.text).toContain("execution_status NOT IN ('failed', 'denied', 'expired')");
    expect(sql.calls[0]!.text).toContain("split_part(agent_id, ':', 1)");
    expect(sql.calls[0]!.text).toContain('agent_id IS NOT NULL');
  });

  it('getX402SpendAggregation uses the same exclusion on every aggregate', async () => {
    const sql = makeSql([[{ total_spend_usd: '0', purchase_count: '0' }], [], []]);
    await getX402SpendAggregation(sql, 'org1');
    for (const call of sql.calls) {
      expect(call.text).toContain("execution_status NOT IN ('failed', 'denied', 'expired')");
    }
  });
});

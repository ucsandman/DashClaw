import { describe, it, expect } from 'vitest';

// Approvals lifecycle hygiene (roadmap v2.3).
// Spec: docs/plans/2026-07-02-approvals-lifecycle-hygiene.md
// Pins: the expiry-stamp math, the overdue predicate (including the legacy
// NULL-stamp rule), and the create-path stamping.

import {
  computeApprovalExpiry,
  isApprovalOverdue,
  createActionRecord,
  expireOverdueApproval,
  sweepExpiredApprovals,
  listActions,
  APPROVAL_RETRY_GRACE_SECONDS,
  DEFAULT_APPROVAL_WAIT_SECONDS,
} from '../../app/lib/repositories/actions.repository';
import { actionInsertValuesByColumn } from './helpers/action-insert-values.js';

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
    const stamp = actionInsertValuesByColumn(sql.calls[0]!).approval_expires_at as string;
    const delta = (new Date(stamp).getTime() - before) / 1000;
    expect(delta).toBeGreaterThanOrEqual(30 + APPROVAL_RETRY_GRACE_SECONDS - 5);
    expect(delta).toBeLessThanOrEqual(30 + APPROVAL_RETRY_GRACE_SECONDS + 5);
  });

  it('leaves the stamp NULL for every non-pending status', async () => {
    const sql = makeSql([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload('running', 30));
    expect(actionInsertValuesByColumn(sql.calls[0]!).approval_expires_at).toBeNull();
  });
});

describe('expireOverdueApproval / sweepExpiredApprovals', () => {
  it('flips ONE overdue row to expired', async () => {
    const sql = makeSql([[{ action_id: 'act_x', status: 'expired', action_type: 'deploy' }]]);
    const row = await expireOverdueApproval(sql, 'org1', 'act_x');
    expect(row?.status).toBe('expired');
  });

  it('returns null when the flip loses the race', async () => {
    const sql = makeSql([[]]);
    const row = await expireOverdueApproval(sql, 'org1', 'act_r');
    expect(row).toBeNull();
  });

  it('sweep flips every overdue row for the org', async () => {
    const sql = makeSql([[
      { action_id: 'act_1', agent_id: 'a', action_type: 'deploy' },
      { action_id: 'act_2', agent_id: 'a', action_type: 'api' },
    ]]);
    const swept = await sweepExpiredApprovals(sql, 'org1');
    expect(swept).toHaveLength(2);
    expect(sql.calls[0]!.text).toContain("status = 'pending_approval'");
  });
});

// v3.7 item 3: the /approvals Expired section renders a labeled expiry
// timestamp, which requires the list SELECT to actually carry the column.
describe('listActions carries approval_expires_at', () => {
  it('includes approval_expires_at in the SELECT and passes it through on each row', async () => {
    const sql = makeSql([
      [], // consumed by the WHERE-fragment builder call, not a real result row
      [{ action_id: 'act_1', approval_expires_at: '2026-07-04T00:00:00.000Z' }],
      [{ total: '1' }],
      [{ total: '1', completed: '0', failed: '0', running: '0', blocked: '0', high_risk: '0', avg_risk: '0', total_cost: '0' }],
    ]);
    const result = await listActions(sql, 'org1', {});
    // calls[0] is the WHERE-fragment builder call; calls[1] is the list SELECT.
    expect(sql.calls[1]!.text).toContain('approval_expires_at');
    expect(result.actions[0]?.approval_expires_at).toBe('2026-07-04T00:00:00.000Z');
  });
});

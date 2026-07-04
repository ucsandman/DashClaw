/**
 * Regression: the idempotency replay lookup must cast created_at::timestamptz.
 *
 * On fresh drizzle-chain installs guard_decisions.created_at is physically
 * TEXT (drizzle/0000), so a bare `created_at > NOW() - INTERVAL ...`
 * comparison raises 42883 (no text > timestamptz operator). The catch in
 * getGuardDecisionByIdempotencyKey then returns null — every replay is
 * treated as a miss, retries re-evaluate and double-write audit rows, and
 * the dedup guarantee the route advertises is silently void. The cast works
 * on both column shapes (text ISO strings and timestamp), so it is the one
 * form that behaves identically across installers.
 */
import { describe, expect, it, vi } from 'vitest';

import { getGuardDecisionByIdempotencyKey } from '../../app/lib/repositories/guard.repository';

describe('getGuardDecisionByIdempotencyKey', () => {
  it('casts created_at::timestamptz in the replay-window comparison (TEXT-typed installs)', async () => {
    const query = vi.fn(async () => []);
    await getGuardDecisionByIdempotencyKey({ query }, 'org_1', 'k'.repeat(64));

    expect(query).toHaveBeenCalledTimes(1);
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/created_at::timestamptz\s*>/);
    // The bare comparison is the regression — it must not come back.
    expect(sqlText).not.toMatch(/[^:]created_at\s*>/);
  });

  it('returns the matched row and scopes by org + key params', async () => {
    const row = { id: 'act_gd_1', decision: 'allow' };
    const query = vi.fn(async () => [row]);
    const result = await getGuardDecisionByIdempotencyKey({ query }, 'org_1', 'k'.repeat(64));

    expect(result).toBe(row);
    expect(query.mock.calls[0][1]).toEqual(['org_1', 'k'.repeat(64)]);
  });
});

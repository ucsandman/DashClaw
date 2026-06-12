import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLoginLockState,
  recordLoginFailure,
  clearLoginFailures,
  LOGIN_GUARD_MAX_FAILS,
  LOGIN_GUARD_LOCKOUT_MS,
} from '@/lib/repositories/login-guard.repository.ts';

// Tagged-template sql mock: routes by query text (SELECT vs INSERT vs DELETE)
// and captures interpolated values for assertions.
function makeSql(selectRows = []) {
  const calls = [];
  const sql = vi.fn(async (strings, ...values) => {
    const text = strings.join(' ');
    calls.push({ text, values });
    if (/^\s*SELECT/i.test(text)) return selectRows;
    return [];
  });
  sql.calls = calls;
  return sql;
}

const ORG = 'org_default';

function guardRow(fails, lastFailAt) {
  return [{ value: JSON.stringify({ fails, last_fail_at: lastFailAt }) }];
}

describe('login-guard repository', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('no prior failures: not locked', async () => {
    const state = await getLoginLockState(makeSql([]), ORG);
    expect(state.locked).toBe(false);
  });

  it('max fails within the window: locked with retry hint', async () => {
    const sql = makeSql(guardRow(LOGIN_GUARD_MAX_FAILS, new Date().toISOString()));
    const state = await getLoginLockState(sql, ORG);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_GUARD_LOCKOUT_MS / 1000);
  });

  it('max fails but the window has expired: not locked', async () => {
    const stale = new Date(Date.now() - LOGIN_GUARD_LOCKOUT_MS - 60_000).toISOString();
    const state = await getLoginLockState(makeSql(guardRow(LOGIN_GUARD_MAX_FAILS, stale)), ORG);
    expect(state.locked).toBe(false);
  });

  it('fewer than max fails: not locked', async () => {
    const state = await getLoginLockState(
      makeSql(guardRow(LOGIN_GUARD_MAX_FAILS - 1, new Date().toISOString())), ORG,
    );
    expect(state.locked).toBe(false);
  });

  it('recordLoginFailure increments the recent counter', async () => {
    const sql = makeSql(guardRow(2, new Date().toISOString()));
    await recordLoginFailure(sql, ORG);
    const write = sql.calls.find((c) => /INSERT INTO settings/i.test(c.text));
    expect(write).toBeTruthy();
    const stored = write.values.find((v) => typeof v === 'string' && v.includes('fails'));
    expect(JSON.parse(stored).fails).toBe(3);
  });

  it('recordLoginFailure resets the counter after a stale window', async () => {
    const stale = new Date(Date.now() - LOGIN_GUARD_LOCKOUT_MS - 60_000).toISOString();
    const sql = makeSql(guardRow(4, stale));
    await recordLoginFailure(sql, ORG);
    const write = sql.calls.find((c) => /INSERT INTO settings/i.test(c.text));
    const stored = write.values.find((v) => typeof v === 'string' && v.includes('fails'));
    expect(JSON.parse(stored).fails).toBe(1);
  });

  it('clearLoginFailures deletes the guard row', async () => {
    const sql = makeSql();
    await clearLoginFailures(sql, ORG);
    expect(sql.calls.some((c) => /DELETE FROM settings/i.test(c.text))).toBe(true);
  });

  it('a corrupt stored value is treated as no failures, not a crash', async () => {
    const state = await getLoginLockState(makeSql([{ value: 'not-json' }]), ORG);
    expect(state.locked).toBe(false);
  });
});

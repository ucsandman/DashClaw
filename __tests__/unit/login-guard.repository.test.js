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

  // The counter is no longer computed in JS. It used to be SELECT -> fails+1 in
  // JS -> write back, so a burst of parallel failed logins all read the same
  // pre-increment row and wrote the same value: the count never climbed and
  // LOGIN_GUARD_MAX_FAILS could be raced past with enough concurrency. The
  // increment now happens inside the UPDATE, computed from the row Postgres is
  // holding, so the property to pin is the QUERY SHAPE — a fake sql tag cannot
  // observe a value the database computes.
  it('recordLoginFailure increments from the stored row, not from a JS snapshot', async () => {
    const sql = makeSql(guardRow(2, new Date().toISOString()));
    await recordLoginFailure(sql, ORG);
    const write = sql.calls.find((c) => /INSERT INTO settings/i.test(c.text));
    expect(write).toBeTruthy();

    const text = write.text.replace(/\s+/g, ' ');
    // Increment reads the row being updated.
    expect(text).toMatch(/settings\.value::jsonb->>'fails'\)?::int \+ 1/);
    // And no pre-read count is interpolated as a parameter — the only JSON
    // value bound is the fresh-insert {fails:1} seed.
    const jsonValues = write.values.filter((v) => typeof v === 'string' && v.includes('fails'));
    expect(jsonValues).toHaveLength(1);
    expect(JSON.parse(jsonValues[0]).fails).toBe(1);
  });

  it('recordLoginFailure resets the counter once the lockout window has passed', async () => {
    const stale = new Date(Date.now() - LOGIN_GUARD_LOCKOUT_MS - 60_000).toISOString();
    const sql = makeSql(guardRow(4, stale));
    await recordLoginFailure(sql, ORG);
    const write = sql.calls.find((c) => /INSERT INTO settings/i.test(c.text));

    const text = write.text.replace(/\s+/g, ' ');
    // Still-fresh -> increment, expired -> reset to 1, decided in SQL against
    // the same lockout window windowExpired() uses.
    expect(text).toMatch(/CASE WHEN .*last_fail_at.*NOW\(\) - .*INTERVAL/);
    expect(text).toMatch(/ELSE 1 END/);
    expect(write.values).toContain(LOGIN_GUARD_LOCKOUT_MS);
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

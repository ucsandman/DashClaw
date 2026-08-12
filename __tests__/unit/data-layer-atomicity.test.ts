import { describe, expect, it, vi } from 'vitest';

import {
  recordLoginFailure,
  getLoginLockState,
  LOGIN_GUARD_LOCKOUT_MS,
} from '@/lib/repositories/login-guard.repository.js';
import {
  deleteActionsByFilter,
  deleteActionsByIds,
} from '@/lib/repositories/actions.repository.js';

// ---------------------------------------------------------------------------
// login-guard.repository.ts — recordLoginFailure used to be read-then-write:
// SELECT the row, compute fails+1 in JS, then INSERT/UPDATE the JS-computed
// value. A burst of concurrent failed logins all read the same pre-increment
// row before any write committed, so every request wrote the same value
// instead of the counter climbing — LOGIN_GUARD_MAX_FAILS could be raced
// past. The fix moves the increment into the UPDATE's SET clause so it is
// computed from the row Postgres is holding at write time, not a JS
// snapshot from an earlier round trip.
//
// This fake `sql` tag models the one property that matters for that bug: a
// single statement mutates the in-memory row synchronously, with no `await`
// between reading and writing it — mirroring how a real row lock makes one
// UPDATE atomic relative to concurrent UPDATEs on the same row. Under
// `Promise.all`, each `recordLoginFailure()` call runs synchronously up to
// its own `await sql\`...\`` before the next call starts; the OLD two-query
// implementation had an extra await (the SELECT) sitting before that write,
// which is exactly the gap the race lived in. Positional destructuring of
// `values` matches the interpolation order of the INSERT..ON CONFLICT query
// in recordLoginFailure: [orgId, agentId, key, freshValue, lockoutMs, now].
// ---------------------------------------------------------------------------

function makeFakeSettingsDb() {
  const table = new Map<string, { fails: number; last_fail_at: string }>();

  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    const rowKey = String(values[0]); // every query here is scoped by orgId as the first interpolation

    if (/^\s*SELECT/i.test(text)) {
      const row = table.get(rowKey);
      return row ? [{ value: JSON.stringify(row) }] : [];
    }

    if (/^\s*DELETE/i.test(text)) {
      table.delete(rowKey);
      return [];
    }

    if (/INSERT INTO settings/i.test(text) && /ON CONFLICT/i.test(text)) {
      const freshValueJson = values[3] as string;
      const lockoutMs = values[4] as number;
      const now = values[5] as string;
      const existing = table.get(rowKey);
      const next = !existing
        ? (JSON.parse(freshValueJson) as { fails: number; last_fail_at: string })
        : {
            fails: Date.parse(now) - Date.parse(existing.last_fail_at) < Number(lockoutMs)
              ? existing.fails + 1
              : 1,
            last_fail_at: now,
          };
      table.set(rowKey, next);
      return [];
    }

    throw new Error(`fake sql: unhandled query shape: ${text}`);
  };

  return { sql, table };
}

describe('login-guard: concurrent failure recording is atomic', () => {
  it('5 concurrent recordLoginFailure calls accumulate to 5, not collapse to 1', async () => {
    const { sql, table } = makeFakeSettingsDb();
    const ORG = 'org_concurrent';

    await Promise.all([
      recordLoginFailure(sql as never, ORG),
      recordLoginFailure(sql as never, ORG),
      recordLoginFailure(sql as never, ORG),
      recordLoginFailure(sql as never, ORG),
      recordLoginFailure(sql as never, ORG),
    ]);

    expect(table.get(ORG)?.fails).toBe(5);
  });

  it('getLoginLockState locks out once concurrent failures reach the max', async () => {
    const { sql } = makeFakeSettingsDb();
    const ORG = 'org_observed';

    await Promise.all(Array.from({ length: 5 }, () => recordLoginFailure(sql as never, ORG)));

    const state = await getLoginLockState(sql as never, ORG);
    expect(state.locked).toBe(true);
  });

  it('window-reset semantics are unchanged: a stale row resets to 1 instead of incrementing', async () => {
    const { sql, table } = makeFakeSettingsDb();
    const ORG = 'org_stale';
    const stale = new Date(Date.now() - LOGIN_GUARD_LOCKOUT_MS - 60_000).toISOString();
    table.set(ORG, { fails: 4, last_fail_at: stale });

    await recordLoginFailure(sql as never, ORG);

    expect(table.get(ORG)?.fails).toBe(1);
  });

  it('a failure inside the window increments rather than resets', async () => {
    const { sql, table } = makeFakeSettingsDb();
    const ORG = 'org_fresh';
    table.set(ORG, { fails: 2, last_fail_at: new Date().toISOString() });

    await recordLoginFailure(sql as never, ORG);

    expect(table.get(ORG)?.fails).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// actions.repository.ts — deleteActionsByFilter / deleteActionsByIds used to
// issue three unguarded sql calls (open_loops, then assumptions, then
// action_records), with nothing rolling back the earlier deletes if a later
// one failed. Both now batch into `sql.transaction()` when the driver
// exposes it (the Neon HTTP driver does); the local/self-host `postgres`
// driver wrapped by app/lib/db.ts exposes no such primitive, so both
// functions feature-detect and fall back to the original sequential order.
// ---------------------------------------------------------------------------

describe('actions.repository: bulk delete is issued as one atomic unit when supported', () => {
  it('deleteActionsByFilter batches all three deletes into a single sql.transaction() call', async () => {
    const txnQueryCalls: { text: string; params?: unknown[] }[] = [];
    const sql = Object.assign(
      vi.fn(async () => []),
      {
        query: vi.fn(async () => []),
        transaction: vi.fn(async (fn: (txn: unknown) => Array<Promise<unknown[]>>) => {
          const txn = {
            query: async (text: string, params?: unknown[]) => {
              txnQueryCalls.push({ text, params });
              return /RETURNING action_id/i.test(text) ? [{ action_id: 'act_1' }] : [];
            },
          };
          const queries = fn(txn);
          return Promise.all(queries);
        }),
      },
    );

    const result = await deleteActionsByFilter(sql as never, 'org_1', { agentId: 'agent_1' });

    expect(sql.transaction).toHaveBeenCalledTimes(1);
    expect(sql.query).not.toHaveBeenCalled();
    expect(txnQueryCalls).toHaveLength(3);
    expect(txnQueryCalls[0]?.text).toContain('DELETE FROM open_loops');
    expect(txnQueryCalls[1]?.text).toContain('DELETE FROM assumptions');
    expect(txnQueryCalls[2]?.text).toContain('DELETE FROM action_records');
    expect(result).toEqual([{ action_id: 'act_1' }]);
  });

  it('deleteActionsByFilter falls back to sequential sql.query calls when transaction() is unavailable (local/self-host Postgres)', async () => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const sql = Object.assign(vi.fn(async () => []), {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        return [];
      }),
    });

    await deleteActionsByFilter(sql as never, 'org_1', { agentId: 'agent_1' });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.text).toContain('DELETE FROM open_loops');
    expect(calls[1]?.text).toContain('DELETE FROM assumptions');
    expect(calls[2]?.text).toContain('DELETE FROM action_records');
  });

  it('deleteActionsByIds batches its three tagged-template deletes into a single sql.transaction() call', async () => {
    let queryCount = 0;
    const sql = Object.assign(
      vi.fn(async () => []),
      {
        query: vi.fn(async () => []),
        transaction: vi.fn(async (fn: (txn: unknown) => Array<Promise<unknown[]>>) => {
          const txn = (_strings: TemplateStringsArray, ..._values: unknown[]) => {
            queryCount += 1;
            return queryCount === 3 ? Promise.resolve([{ action_id: 'act_9' }]) : Promise.resolve([]);
          };
          const queries = fn(txn as never);
          return Promise.all(queries);
        }),
      },
    );

    const result = await deleteActionsByIds(sql as never, 'org_1', ['act_9']);

    expect(sql.transaction).toHaveBeenCalledTimes(1);
    expect(sql).not.toHaveBeenCalled();
    expect(queryCount).toBe(3);
    expect(result).toEqual([{ action_id: 'act_9' }]);
  });

  it('deleteActionsByIds falls back to sequential tagged-template deletes when transaction() is unavailable', async () => {
    const calls: unknown[][] = [];
    const sql = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push(values);
        return strings.join('?').includes('RETURNING action_id') ? [{ action_id: 'act_9' }] : [];
      }),
      { query: vi.fn(async () => []) },
    );

    const result = await deleteActionsByIds(sql as never, 'org_1', ['act_9']);

    expect(calls).toHaveLength(3);
    expect(result).toEqual([{ action_id: 'act_9' }]);
  });
});

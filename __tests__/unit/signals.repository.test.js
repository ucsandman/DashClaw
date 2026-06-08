import { describe, it, expect } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  getExistingSignalHashes,
  upsertSignalSnapshots,
} from '../../app/lib/repositories/signals.repository.js';

describe('getExistingSignalHashes', () => {
  it('queries only the candidate hashes (bounded IN + LIMIT) and returns matches', async () => {
    const sql = createSqlMock({ queryResponses: [[{ signal_hash: 'h1' }]] });

    const result = await getExistingSignalHashes(sql, 'org_1', ['h1', 'h2']);

    expect(result).toEqual(['h1']);
    expect(sql.queryCalls).toHaveLength(1);
    const { text, params } = sql.queryCalls[0];
    expect(text).toContain('FROM signal_snapshots');
    expect(text).toContain('signal_hash IN ($2, $3)');
    expect(text).toContain('LIMIT 2');
    expect(params).toEqual(['org_1', 'h1', 'h2']);
  });

  it('short-circuits with no query when there are no candidate hashes', async () => {
    const sql = createSqlMock();
    const result = await getExistingSignalHashes(sql, 'org_1', []);
    expect(result).toEqual([]);
    expect(sql.queryCalls).toHaveLength(0);
  });
});

describe('upsertSignalSnapshots', () => {
  const now = '2026-06-08T12:00:00.000Z';

  it('writes one multi-row INSERT with ON CONFLICT preserved and exact per-row params', async () => {
    const sql = createSqlMock();
    const snapshots = [
      { _hash: 'h1', type: 'autonomy_spike', severity: 'red', agent_id: 'a1' },
      { _hash: 'h2', type: 'stale_assumption', severity: 'amber', agent_id: null },
    ];

    await upsertSignalSnapshots(sql, 'org_1', snapshots, now);

    expect(sql.queryCalls).toHaveLength(1);
    const { text, params } = sql.queryCalls[0];
    expect(text).toContain('INSERT INTO signal_snapshots');
    expect(text).toContain('ON CONFLICT (org_id, signal_hash) DO UPDATE');
    expect(text).toContain('last_seen_at = EXCLUDED.last_seen_at');
    expect(text).toContain('severity = EXCLUDED.severity');
    expect(text).toContain('($1, $2, $3, $4, $5, $6, $7)');
    expect(text).toContain('($8, $9, $10, $11, $12, $13, $14)');
    // 2 rows × 7 cols
    expect(params).toEqual([
      'org_1', 'h1', 'autonomy_spike', 'red', 'a1', now, now,
      'org_1', 'h2', 'stale_assumption', 'amber', null, now, now,
    ]);
  });

  it('chunks at 500 rows per INSERT', async () => {
    const sql = createSqlMock();
    const snapshots = Array.from({ length: 600 }, (_, i) => ({
      _hash: `h${i}`,
      type: 't',
      severity: 'amber',
      agent_id: null,
    }));

    await upsertSignalSnapshots(sql, 'org_1', snapshots, now);

    expect(sql.queryCalls).toHaveLength(2);
    expect(sql.queryCalls[0].params).toHaveLength(500 * 7);
    expect(sql.queryCalls[1].params).toHaveLength(100 * 7);
  });

  it('de-dupes by hash within a batch keeping the last occurrence', async () => {
    const sql = createSqlMock();
    const snapshots = [
      { _hash: 'dup', type: 't', severity: 'amber', agent_id: null },
      { _hash: 'dup', type: 't', severity: 'red', agent_id: null },
    ];

    await upsertSignalSnapshots(sql, 'org_1', snapshots, now);

    expect(sql.queryCalls).toHaveLength(1);
    // collapsed to one row, last severity wins
    expect(sql.queryCalls[0].params).toEqual(['org_1', 'dup', 't', 'red', null, now, now]);
  });

  it('issues no query for an empty input', async () => {
    const sql = createSqlMock();
    await upsertSignalSnapshots(sql, 'org_1', [], now);
    expect(sql.queryCalls).toHaveLength(0);
  });
});

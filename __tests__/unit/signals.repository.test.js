import { describe, it, expect } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { claimNewSignalSnapshots } from '../../app/lib/repositories/signals.repository.js';

describe('claimNewSignalSnapshots', () => {
  const now = '2026-06-08T12:00:00.000Z';

  it('issues an INSERT ... ON CONFLICT DO NOTHING RETURNING and returns the inserted hashes', async () => {
    // Both rows win the INSERT race — the RETURNING set is the full batch.
    const sql = createSqlMock({
      queryResponses: [[{ signal_hash: 'h1' }, { signal_hash: 'h2' }]],
    });
    const snapshots = [
      { _hash: 'h1', type: 'autonomy_spike', severity: 'red', agent_id: 'a1' },
      { _hash: 'h2', type: 'stale_assumption', severity: 'amber', agent_id: null },
    ];

    const result = await claimNewSignalSnapshots(sql, 'org_1', snapshots, now);

    expect(result).toEqual(['h1', 'h2']);
    // No refresh needed — everything was newly inserted, so only the INSERT ran.
    expect(sql.queryCalls).toHaveLength(1);
    const { text, params } = sql.queryCalls[0];
    expect(text).toContain('INSERT INTO signal_snapshots');
    expect(text).toContain('ON CONFLICT (org_id, signal_hash) DO NOTHING');
    expect(text).toContain('RETURNING signal_hash');
    expect(text).toContain('($1, $2, $3, $4, $5, $6, $7)');
    expect(text).toContain('($8, $9, $10, $11, $12, $13, $14)');
    expect(params).toEqual([
      'org_1', 'h1', 'autonomy_spike', 'red', 'a1', now, now,
      'org_1', 'h2', 'stale_assumption', 'amber', null, now, now,
    ]);
  });

  it('refreshes rows that lost the INSERT race (already existed) via a second UPDATE, and excludes them from the returned set', async () => {
    // INSERT only returns h1 — h2 already had a row (another run, or a prior tick).
    const sql = createSqlMock({
      queryResponses: [[{ signal_hash: 'h1' }]],
    });
    const snapshots = [
      { _hash: 'h1', type: 'autonomy_spike', severity: 'red', agent_id: 'a1' },
      { _hash: 'h2', type: 'stale_assumption', severity: 'amber', agent_id: null },
    ];

    const result = await claimNewSignalSnapshots(sql, 'org_1', snapshots, now);

    expect(result).toEqual(['h1']);
    expect(sql.queryCalls).toHaveLength(2);

    const update = sql.queryCalls[1];
    expect(update.text).toContain('UPDATE signal_snapshots');
    expect(update.text).toContain('FROM (VALUES');
    expect(update.text).toContain('last_seen_at = $1');
    expect(update.text).toContain('severity = v.severity');
    // now, then (hash, severity) for h2, then org_id
    expect(update.params).toEqual([now, 'h2', 'amber', 'org_1']);
  });

  it('chunks the INSERT at 500 rows', async () => {
    const sql = createSqlMock({
      queryResponses: [
        Array.from({ length: 500 }, (_, i) => ({ signal_hash: `h${i}` })),
        Array.from({ length: 100 }, (_, i) => ({ signal_hash: `h${500 + i}` })),
      ],
    });
    const snapshots = Array.from({ length: 600 }, (_, i) => ({
      _hash: `h${i}`,
      type: 't',
      severity: 'amber',
      agent_id: null,
    }));

    const result = await claimNewSignalSnapshots(sql, 'org_1', snapshots, now);

    expect(result).toHaveLength(600);
    expect(sql.queryCalls).toHaveLength(2);
    expect(sql.queryCalls[0].params).toHaveLength(500 * 7);
    expect(sql.queryCalls[1].params).toHaveLength(100 * 7);
  });

  it('de-dupes by hash within the input keeping the last occurrence', async () => {
    const sql = createSqlMock({ queryResponses: [[{ signal_hash: 'dup' }]] });
    const snapshots = [
      { _hash: 'dup', type: 't', severity: 'amber', agent_id: null },
      { _hash: 'dup', type: 't', severity: 'red', agent_id: null },
    ];

    const result = await claimNewSignalSnapshots(sql, 'org_1', snapshots, now);

    expect(result).toEqual(['dup']);
    expect(sql.queryCalls).toHaveLength(1);
    // collapsed to one row, last severity wins
    expect(sql.queryCalls[0].params).toEqual(['org_1', 'dup', 't', 'red', null, now, now]);
  });

  it('issues no query and returns no hashes for an empty input', async () => {
    const sql = createSqlMock();
    const result = await claimNewSignalSnapshots(sql, 'org_1', [], now);
    expect(result).toEqual([]);
    expect(sql.queryCalls).toHaveLength(0);
  });
});

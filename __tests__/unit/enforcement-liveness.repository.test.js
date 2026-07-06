/**
 * v8.2 enforcement liveness — repository tests.
 *
 * In-memory mock of the Neon tagged-template SQL client, routed by keyword
 * matching on the query text (same convention as live-canary.repository.test.js).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  insertEnforcementLivenessRun,
  getLatestEnforcementLivenessRunForOrg,
  listEnforcementLivenessRunsForOrg,
} from '../../app/lib/repositories/enforcement-liveness.repository.ts';
import {
  deriveEnforcementLivenessState,
  ENFORCEMENT_LIVENESS_STALE_MS,
} from '../../app/lib/enforcement-liveness.ts';

function makeSqlMock() {
  const rows = [];
  let seq = 0;
  const sql = vi.fn((strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('INSERT INTO enforcement_liveness_runs')) {
      const [id, orgId, source, verdict, detail, hook, witness, decision, checks, startedAt, finishedAt] = values;
      rows.push({
        id,
        org_id: orgId,
        source,
        verdict,
        detail,
        hook: JSON.parse(hook),
        witness: JSON.parse(witness),
        decision,
        checks: JSON.parse(checks),
        started_at: startedAt,
        finished_at: finishedAt,
        created_at: new Date(Date.now() + seq++).toISOString(),
      });
      return Promise.resolve([]);
    }
    if (text.includes('DELETE FROM enforcement_liveness_runs')) {
      // Retention prune — the mock treats it as a no-op (created_at is "now").
      return Promise.resolve([]);
    }
    if (text.includes('SELECT') && text.includes('FROM enforcement_liveness_runs')) {
      const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (text.includes('WHERE org_id =')) {
        const [orgId, maybeLimit] = values;
        const scoped = sorted.filter((r) => r.org_id === orgId);
        const limit = typeof maybeLimit === 'number' ? maybeLimit : 1;
        return Promise.resolve(scoped.slice(0, limit));
      }
      return Promise.resolve(sorted.slice(0, 1));
    }
    return Promise.resolve([]);
  });
  sql._rows = rows;
  return sql;
}

const RUN = {
  source: 'manual',
  verdict: 'held',
  detail: 'probe action was blocked by require_approval',
  hook: { installed: true, timeout_seconds: 30, mode: 'enforced' },
  witness: { path: '/tmp/enforcement-liveness-witness.json', executed: false },
  decision: 'require_approval',
  checks: [
    { id: 'hook-installed', title: 'Hook installed', status: 'pass' },
    { id: 'witness-absent', title: 'Witness file absent', status: 'pass' },
  ],
  startedAt: '2026-07-06T06:00:00.000Z',
  finishedAt: '2026-07-06T06:00:05.000Z',
};

describe('enforcement-liveness repository (v8.2)', () => {
  let sql;
  beforeEach(() => {
    sql = makeSqlMock();
  });

  it('insertEnforcementLivenessRun stores the run with an elr_ id and prunes retention', async () => {
    const { id } = await insertEnforcementLivenessRun(sql, 'org_default', RUN);
    expect(id).toMatch(/^elr_/);
    expect(sql._rows).toHaveLength(1);
    expect(sql._rows[0].org_id).toBe('org_default');
    expect(sql._rows[0].verdict).toBe('held');
    expect(sql._rows[0].hook.installed).toBe(true);
    expect(sql._rows[0].witness.executed).toBe(false);
    expect(sql._rows[0].checks).toHaveLength(2);
    const deleteCall = sql.mock.calls.find(([strings]) =>
      strings.join(' ').includes('DELETE FROM enforcement_liveness_runs'));
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[0].join(' ')).toContain("interval '30 days'");
  });

  it('getLatestEnforcementLivenessRunForOrg returns the newest run for the org, null when none', async () => {
    expect(await getLatestEnforcementLivenessRunForOrg(sql, 'org_default')).toBeNull();
    await insertEnforcementLivenessRun(sql, 'org_default', { ...RUN, verdict: 'executed' });
    await insertEnforcementLivenessRun(sql, 'org_default', RUN);
    await insertEnforcementLivenessRun(sql, 'org_other', { ...RUN, verdict: 'executed' });
    const latest = await getLatestEnforcementLivenessRunForOrg(sql, 'org_default');
    expect(latest.verdict).toBe('held');
    expect(latest.org_id).toBe('org_default');
  });

  it('listEnforcementLivenessRunsForOrg respects the limit, newest first', async () => {
    await insertEnforcementLivenessRun(sql, 'org_default', { ...RUN, verdict: 'executed' });
    await insertEnforcementLivenessRun(sql, 'org_default', RUN);
    const runs = await listEnforcementLivenessRunsForOrg(sql, 'org_default', 1);
    expect(runs).toHaveLength(1);
    expect(runs[0].verdict).toBe('held');
  });
});

describe('deriveEnforcementLivenessState (v8.2)', () => {
  const NOW = Date.parse('2026-07-06T12:00:00.000Z');

  it('returns stale when there is no latest run', () => {
    expect(deriveEnforcementLivenessState(null, NOW)).toBe('stale');
  });

  it('returns holding for a fresh held verdict', () => {
    const run = { verdict: 'held', finished_at: new Date(NOW - 60 * 1000).toISOString() };
    expect(deriveEnforcementLivenessState(run, NOW)).toBe('holding');
  });

  it('returns broken for a fresh executed verdict', () => {
    const run = { verdict: 'executed', finished_at: new Date(NOW - 60 * 1000).toISOString() };
    expect(deriveEnforcementLivenessState(run, NOW)).toBe('broken');
  });

  it('returns broken for a fresh unprovable verdict', () => {
    const run = { verdict: 'unprovable', finished_at: new Date(NOW - 60 * 1000).toISOString() };
    expect(deriveEnforcementLivenessState(run, NOW)).toBe('broken');
  });

  it('returns stale for an old held verdict past the stale window', () => {
    const run = {
      verdict: 'held',
      finished_at: new Date(NOW - ENFORCEMENT_LIVENESS_STALE_MS - 1000).toISOString(),
    };
    expect(deriveEnforcementLivenessState(run, NOW)).toBe('stale');
  });

  it('treats exactly the stale window boundary as still fresh', () => {
    const run = {
      verdict: 'held',
      finished_at: new Date(NOW - ENFORCEMENT_LIVENESS_STALE_MS).toISOString(),
    };
    expect(deriveEnforcementLivenessState(run, NOW)).toBe('holding');
  });
});

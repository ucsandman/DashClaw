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
  listLatestEnforcementLivenessRunPerRuntime,
} from '../../app/lib/repositories/enforcement-liveness.repository.ts';
import {
  deriveEnforcementLivenessState,
  deriveFleetEnforcementLiveness,
  ENFORCEMENT_LIVENESS_STALE_MS,
} from '../../app/lib/enforcement-liveness.ts';

function makeSqlMock() {
  const rows = [];
  let seq = 0;
  const sql = vi.fn((strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('INSERT INTO enforcement_liveness_runs')) {
      const [id, orgId, source, runtime, verdict, detail, hook, witness, decision, checks, startedAt, finishedAt] = values;
      rows.push({
        id,
        org_id: orgId,
        source,
        runtime,
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
      // DISTINCT ON (runtime): newest row per seam, one row each.
      if (text.includes('DISTINCT ON (runtime)')) {
        const [orgId] = values;
        const newestPerRuntime = new Map();
        for (const r of sorted.filter((x) => x.org_id === orgId)) {
          if (!newestPerRuntime.has(r.runtime)) newestPerRuntime.set(r.runtime, r);
        }
        return Promise.resolve([...newestPerRuntime.values()]);
      }
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
  runtime: 'claude-code',
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

  it('listLatestEnforcementLivenessRunPerRuntime returns one newest row per seam', async () => {
    // codex reports broken FIRST, then claude-code reports healthy. The
    // single-row read returns only the healthy claude-code run; this one must
    // still surface the broken codex seam (drizzle/0072).
    await insertEnforcementLivenessRun(sql, 'org_default', { ...RUN, runtime: 'codex', verdict: 'executed' });
    await insertEnforcementLivenessRun(sql, 'org_default', { ...RUN, runtime: 'claude-code', verdict: 'held' });
    await insertEnforcementLivenessRun(sql, 'org_other', { ...RUN, runtime: 'codex', verdict: 'held' });

    expect((await getLatestEnforcementLivenessRunForOrg(sql, 'org_default')).runtime).toBe('claude-code');

    const perSeam = await listLatestEnforcementLivenessRunPerRuntime(sql, 'org_default');
    expect(perSeam).toHaveLength(2);
    expect(perSeam.find((r) => r.runtime === 'codex').verdict).toBe('executed');
    expect(perSeam.find((r) => r.runtime === 'claude-code').verdict).toBe('held');
    // Never leaks another tenant's seams.
    expect(perSeam.every((r) => r.org_id === 'org_default')).toBe(true);
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

describe('deriveFleetEnforcementLiveness (drizzle/0072)', () => {
  const NOW = Date.parse('2026-07-06T12:00:00.000Z');
  const fresh = (runtime, verdict) => ({
    runtime,
    verdict,
    finished_at: new Date(NOW - 60 * 1000).toISOString(),
  });
  const old = (runtime, verdict) => ({
    runtime,
    verdict,
    finished_at: new Date(NOW - ENFORCEMENT_LIVENESS_STALE_MS - 1000).toISOString(),
  });

  // The bug this column exists to kill: both seams report
  // `source: session-start`, so the newest-row derivation returned 'holding'
  // for the org while codex sat dead.
  it('a fresh healthy seam does NOT mask a fresh broken seam', () => {
    const fleet = deriveFleetEnforcementLiveness(
      [fresh('claude-code', 'held'), fresh('codex', 'executed')],
      NOW,
    );
    expect(fleet.state).toBe('broken');
    expect(fleet.seams.find((s) => s.runtime === 'codex').state).toBe('broken');
    expect(fleet.seams.find((s) => s.runtime === 'claude-code').state).toBe('holding');
  });

  it('a fresh healthy seam does NOT mask a seam that went quiet', () => {
    const fleet = deriveFleetEnforcementLiveness(
      [fresh('claude-code', 'held'), old('codex', 'held')],
      NOW,
    );
    expect(fleet.state).toBe('stale');
  });

  it('is holding only when EVERY seam is holding', () => {
    const fleet = deriveFleetEnforcementLiveness(
      [fresh('claude-code', 'held'), fresh('codex', 'held')],
      NOW,
    );
    expect(fleet.state).toBe('holding');
    expect(fleet.seams).toHaveLength(2);
  });

  it('no seams at all is stale, never holding — no signal is not a health claim', () => {
    expect(deriveFleetEnforcementLiveness([], NOW).state).toBe('stale');
  });

  it('sorts worst seam first so the operator reads the problem before the noise', () => {
    const fleet = deriveFleetEnforcementLiveness(
      [fresh('claude-code', 'held'), old('hermes', 'held'), fresh('codex', 'executed')],
      NOW,
    );
    expect(fleet.seams.map((s) => s.runtime)).toEqual(['codex', 'hermes', 'claude-code']);
  });

  it('labels a pre-0072 row with no runtime as "unknown" rather than dropping it', () => {
    const fleet = deriveFleetEnforcementLiveness(
      [{ verdict: 'held', finished_at: new Date(NOW - 60 * 1000).toISOString() }],
      NOW,
    );
    expect(fleet.seams[0].runtime).toBe('unknown');
    expect(fleet.state).toBe('holding');
  });
});

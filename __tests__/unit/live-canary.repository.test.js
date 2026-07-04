/**
 * v3.4 live-host canary — repository tests.
 *
 * In-memory mock of the Neon tagged-template SQL client, routed by keyword
 * matching on the query text (same convention as jti-replay.repository.test.js).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  insertLiveCanaryRun,
  getLatestLiveCanaryRunForOrg,
  listLiveCanaryRunsForOrg,
  canaryDisplayOrgId,
} from '../../app/lib/repositories/live-canary.repository.ts';

function makeSqlMock() {
  const rows = [];
  let seq = 0;
  const sql = vi.fn((strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('INSERT INTO live_canary_runs')) {
      const [id, orgId, source, status, checks, startedAt, finishedAt] = values;
      rows.push({
        id,
        org_id: orgId,
        source,
        status,
        checks: JSON.parse(checks),
        started_at: startedAt,
        finished_at: finishedAt,
        created_at: new Date(Date.now() + seq++).toISOString(),
      });
      return Promise.resolve([]);
    }
    if (text.includes('DELETE FROM live_canary_runs')) {
      // Retention prune — the mock treats it as a no-op (created_at is "now").
      return Promise.resolve([]);
    }
    if (text.includes('SELECT') && text.includes('FROM live_canary_runs')) {
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
  source: 'github-actions',
  status: 'fail',
  checks: [
    { id: 'marketing-home', title: 'Marketing homepage', status: 'pass' },
    { id: 'mcp-handshake', title: 'Hosted MCP handshake', status: 'fail', detail: 'expected 401, got 500' },
  ],
  startedAt: '2026-07-04T06:00:00.000Z',
  finishedAt: '2026-07-04T06:00:20.000Z',
};

describe('live-canary repository (v3.4)', () => {
  let sql;
  beforeEach(() => {
    sql = makeSqlMock();
  });

  it('insertLiveCanaryRun stores the run with an lcr_ id and prunes retention', async () => {
    const { id } = await insertLiveCanaryRun(sql, 'org_default', RUN);
    expect(id).toMatch(/^lcr_/);
    expect(sql._rows).toHaveLength(1);
    expect(sql._rows[0].org_id).toBe('org_default');
    expect(sql._rows[0].checks).toHaveLength(2);
    const deleteCall = sql.mock.calls.find(([strings]) =>
      strings.join(' ').includes('DELETE FROM live_canary_runs'));
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[0].join(' ')).toContain("interval '14 days'");
  });

  it('getLatestLiveCanaryRunForOrg returns the newest run for the org, null when none', async () => {
    expect(await getLatestLiveCanaryRunForOrg(sql, 'org_default')).toBeNull();
    await insertLiveCanaryRun(sql, 'org_default', { ...RUN, status: 'pass' });
    await insertLiveCanaryRun(sql, 'org_default', RUN);
    await insertLiveCanaryRun(sql, 'org_other', { ...RUN, status: 'pass' });
    const latest = await getLatestLiveCanaryRunForOrg(sql, 'org_default');
    expect(latest.status).toBe('fail');
    expect(latest.org_id).toBe('org_default');
  });

  it('listLiveCanaryRunsForOrg respects the limit, newest first', async () => {
    await insertLiveCanaryRun(sql, 'org_default', { ...RUN, status: 'pass' });
    await insertLiveCanaryRun(sql, 'org_default', RUN);
    const runs = await listLiveCanaryRunsForOrg(sql, 'org_default', 1);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('fail');
  });

  it('canaryDisplayOrgId scopes the public /setup read to the trusted canary org', () => {
    // Security invariant (2026-07-04 review): the public page renders one
    // configured org's runs, never an instance-wide latest — a trial tenant
    // on a hosted instance must not be able to place text on /setup.
    expect(canaryDisplayOrgId({})).toBe('org_default');
    expect(canaryDisplayOrgId({ DASHCLAW_CANARY_ORG_ID: 'org_ops' })).toBe('org_ops');
  });
});

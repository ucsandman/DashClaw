/**
 * v4.2 coverage truth — coverage repository tests.
 *
 * In-memory capturing mock of the Neon tagged-template SQL client. The SQL
 * exclusions/joins can't be evaluated by a mock, so those are pinned by
 * asserting the query text/bound values; the JS-side coverage math (coercion,
 * null edges, clamping) is pinned against synthetic aggregate rows.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  insertCoverageReport,
  getAgentCoverage,
  type AgentCoverage,
} from '../../app/lib/repositories/coverage.repository';
import { SYNTHETIC_AGENT_LIKE_PATTERNS } from '../../app/lib/calibration-mining.js';
import type { SqlTag } from '../../app/lib/types/db';

function makeSqlMock(responses: Record<string, unknown>[][]) {
  const queue = [...responses];
  const calls: { text: string; values: unknown[] }[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: typeof calls };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

const byId = (rows: AgentCoverage[]) => new Map(rows.map((r) => [r.agentId, r]));

describe('insertCoverageReport', () => {
  it('inserts with a cov_ id and returns the row', async () => {
    const sql = makeSqlMock([[{ id: 'cov_x', org_id: 'org_1', agent_id: 'a1', expected: 10, recorded: 8 }]]);
    const row = await insertCoverageReport(sql, {
      orgId: 'org_1', agentId: 'a1', harness: 'claude-code', harnessSessionId: 's1', expected: 10, recorded: 8,
    });
    expect(row).toBeTruthy();
    const call = (sql as unknown as { calls: { text: string; values: unknown[] }[] }).calls[0]!;
    expect(call.text).toContain('INSERT INTO coverage_reports');
    // id is the first bound value and carries the cov_ prefix.
    expect(String(call.values[0])).toMatch(/^cov_/);
    expect(call.values).toContain('a1');
    expect(call.values).toContain(10);
    expect(call.values).toContain(8);
  });

  it('binds null for omitted optional harness fields', async () => {
    const sql = makeSqlMock([[{ id: 'cov_y' }]]);
    await insertCoverageReport(sql, { orgId: 'org_1', agentId: 'a1', expected: 0, recorded: 0 });
    const call = (sql as unknown as { calls: { values: unknown[] }[] }).calls[0]!;
    // harness + harness_session_id are the 4th and 5th bound values.
    expect(call.values[3]).toBeNull();
    expect(call.values[4]).toBeNull();
  });
});

describe('getAgentCoverage', () => {
  it('coerces string-numeric aggregates and computes both coverage percents', async () => {
    const sql = makeSqlMock([[
      { agent_id: 'a1', expected: '100', recorded: '80', outcome_closes: '30', autoclose_closes: '10' },
    ]]);
    const rows = byId(await getAgentCoverage(sql, 'org_1'));
    const a1 = rows.get('a1')!;
    expect(a1.expected).toBe(100);
    expect(a1.recorded).toBe(80);
    expect(a1.recordPct).toBe(80);
    expect(a1.outcomePct).toBe(75); // 30 / (30+10)
    expect(a1.outcomeSample).toBe(40);
  });

  it('recordPct null when the agent has coverage reports absent (no evidence), outcomePct present', async () => {
    const sql = makeSqlMock([[
      { agent_id: 'a3', expected: null, recorded: null, outcome_closes: '5', autoclose_closes: '0' },
    ]]);
    const a3 = byId(await getAgentCoverage(sql, 'org_1')).get('a3')!;
    expect(a3.recordPct).toBeNull();
    expect(a3.expected).toBe(0);
    expect(a3.outcomePct).toBe(100);
    expect(a3.outcomeSample).toBe(5);
  });

  it('outcomePct null when there are no hook-recorded closes (divide-by-zero guard)', async () => {
    const sql = makeSqlMock([[
      { agent_id: 'a2', expected: '50', recorded: '50', outcome_closes: null, autoclose_closes: null },
    ]]);
    const a2 = byId(await getAgentCoverage(sql, 'org_1')).get('a2')!;
    expect(a2.recordPct).toBe(100);
    expect(a2.outcomePct).toBeNull();
    expect(a2.outcomeSample).toBe(0);
  });

  it('recordPct null when expected sums to zero (divide-by-zero guard)', async () => {
    const sql = makeSqlMock([[
      { agent_id: 'a4', expected: '0', recorded: '0', outcome_closes: null, autoclose_closes: null },
    ]]);
    const a4 = byId(await getAgentCoverage(sql, 'org_1')).get('a4')!;
    expect(a4.recordPct).toBeNull();
    expect(a4.outcomePct).toBeNull();
  });

  it('clamps recordPct to 100 when recorded exceeds expected (raw counts stay truthful)', async () => {
    const sql = makeSqlMock([[
      { agent_id: 'a5', expected: '10', recorded: '25', outcome_closes: null, autoclose_closes: null },
    ]]);
    const a5 = byId(await getAgentCoverage(sql, 'org_1')).get('a5')!;
    expect(a5.recordPct).toBe(100); // clamped
    expect(a5.recorded).toBe(25);   // truth preserved
    expect(a5.expected).toBe(10);
  });

  it('excludes synthetic families in SQL — patterns are bound and NOT LIKE ALL is wired', async () => {
    const sql = makeSqlMock([[]]);
    await getAgentCoverage(sql, 'org_1');
    const call = (sql as unknown as { calls: { text: string; values: unknown[] }[] }).calls[0]!;
    expect(call.text).toContain('NOT LIKE ALL');
    expect(call.text).toContain("close_source IN ('outcome', 'stop_autoclose')");
    // The synthetic agent-pattern array is a bound value on both CTEs.
    const boundArrays = call.values.filter((v) => Array.isArray(v)) as unknown[][];
    expect(boundArrays.some((v) => v.includes(SYNTHETIC_AGENT_LIKE_PATTERNS[0]))).toBe(true);
  });

  it('clamps the window to 1..168 hours', async () => {
    const sql = makeSqlMock([[], []]);
    await getAgentCoverage(sql, 'org_1', 9999);
    let call = (sql as unknown as { calls: { values: unknown[] }[] }).calls[0]!;
    expect(call.values).toContain(168);
    await getAgentCoverage(sql, 'org_1', -5);
    call = (sql as unknown as { calls: { values: unknown[] }[] }).calls[1]!;
    expect(call.values).toContain(1);
  });

  it('drops rows with an empty agent_id', async () => {
    const sql = makeSqlMock([[
      { agent_id: null, expected: '5', recorded: '5', outcome_closes: null, autoclose_closes: null },
    ]]);
    expect(await getAgentCoverage(sql, 'org_1')).toHaveLength(0);
  });
});

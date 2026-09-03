import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfidenceCalibration } from '../../app/lib/repositories/actions.repository.js';

/**
 * Tagged-template SQL mock that routes on query text rather than call order.
 * `sqlFragment` builds its fragment by invoking `sql` too (both branches do —
 * the inactive one returns sql``), so a positional queue would hand the
 * fragment's call the buckets response and shift everything by one.
 */
function makeSqlMock({ buckets = [], coverage = [] } = {}) {
  return vi.fn((strings) => {
    const text = queryText([strings]);
    if (text.includes('AS bucket')) return Promise.resolve(buckets);
    if (text.includes('AS stated')) return Promise.resolve(coverage);
    return Promise.resolve([]); // the sqlFragment call
  });
}

/** Joined literal text of a tagged call, with `?` where a value was interpolated. */
function queryText(call) {
  const strings = call[0];
  return Array.isArray(strings) || strings?.raw ? Array.from(strings).join('?') : '';
}

const statementsOf = (sql) =>
  sql.mock.calls.map(queryText).filter((t) => t.includes('FROM action_records'));

describe('getConfidenceCalibration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues exactly two statements and routes each result set to its own key', async () => {
    const bucketRows = [{ agent_id: 'a1', bucket: 'b90_plus', n: 10, completed: 6, avg_confidence: 92 }];
    const coverageRows = [{ agent_id: 'a1', closed: 400, stated: 10 }];
    const sql = makeSqlMock({ buckets: bucketRows, coverage: coverageRows });

    const result = await getConfidenceCalibration(sql, 'org_1');

    expect(statementsOf(sql)).toHaveLength(2);
    expect(result.buckets).toEqual(bucketRows);
    expect(result.coverage).toEqual(coverageRows);
  });

  it('scores only rows that stated a confidence — the default 50 is excluded', async () => {
    const sql = makeSqlMock();
    await getConfidenceCalibration(sql, 'org_1');

    const [buckets, coverage] = statementsOf(sql);
    expect(buckets).toContain('confidence <> 50');
    // Coverage counts every closed action AND how many stated a confidence, so
    // the exclusion appears as a FILTER there, never as a WHERE clause.
    expect(coverage).toContain("COUNT(*) FILTER (WHERE confidence <> 50)");
    expect(coverage).not.toContain('AND confidence <> 50');
  });

  it('restricts both statements to the terminal outcome set', async () => {
    const sql = makeSqlMock();
    await getConfidenceCalibration(sql, 'org_1');

    for (const text of statementsOf(sql)) {
      expect(text).toContain("outcome_status IN ('completed', 'partial', 'failed')");
    }
  });

  it('scopes both statements to the org and parameterises the window with an int cast', async () => {
    const sql = makeSqlMock();
    await getConfidenceCalibration(sql, 'org_scoped', null, 14);

    const queries = sql.mock.calls.filter((c) => queryText(c).includes('FROM action_records'));
    expect(queries).toHaveLength(2);
    for (const call of queries) {
      expect(queryText(call)).toContain('WHERE org_id = ?');
      // make_interval(days => $n::int): without the cast Postgres cannot resolve
      // the overload and the whole panel degrades to null, invisibly.
      expect(queryText(call)).toContain('make_interval(days => ?::int)');
      const values = call.slice(1);
      expect(values[0]).toBe('org_scoped');
      expect(values[values.length - 1]).toBe(14);
    }
  });

  it('defaults to a 30 day window', async () => {
    const sql = makeSqlMock();
    await getConfidenceCalibration(sql, 'org_1');
    for (const call of sql.mock.calls.filter((c) => queryText(c).includes('FROM action_records'))) {
      expect(call.slice(1).at(-1)).toBe(30);
    }
  });

  it('adds the agent filter fragment only when an agentId is given', async () => {
    const withAgent = makeSqlMock();
    await getConfidenceCalibration(withAgent, 'org_1', 'agent_9');
    const fragments = withAgent.mock.calls.filter((c) => queryText(c).includes('AND agent_id ='));
    expect(fragments).toHaveLength(1);
    expect(fragments[0][1]).toBe('agent_9');

    const withoutAgent = makeSqlMock();
    await getConfidenceCalibration(withoutAgent, 'org_1', null);
    expect(withoutAgent.mock.calls.filter((c) => queryText(c).includes('AND agent_id ='))).toHaveLength(0);
    // The inactive fragment is still one empty-template call, shared by both statements.
    expect(withoutAgent.mock.calls).toHaveLength(3);
  });

  it('groups by agent and bucket and averages the stated confidence', async () => {
    const sql = makeSqlMock();
    await getConfidenceCalibration(sql, 'org_1');
    const [buckets, coverage] = statementsOf(sql);
    expect(buckets).toContain('AVG(confidence)::float AS avg_confidence');
    expect(buckets).toContain('GROUP BY agent_id, bucket');
    expect(buckets).toContain('MAX(agent_name) AS agent_name');
    expect(coverage).toContain('GROUP BY agent_id');
  });
});

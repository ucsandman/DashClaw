import { describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  getAssumption,
  getAssumptionsDriftCounts,
  listAssumptions,
} from '../../app/lib/repositories/assumptions.repository.js';

describe('getAssumption — cross-org join guard', () => {
  it('scopes the action_records join to the assumption org', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ assumption_id: 'asm_1', org_id: 'org_a', agent_id: 'agent-from-org-a' }],
    ] });

    const row = await getAssumption(sql, 'org_a', 'asm_1');
    expect(row.assumption_id).toBe('asm_1');

    // Without `ar.org_id = a.org_id` an action_id collision across orgs could
    // leak another org's agent_id/agent_name/declared_goal into the response.
    const query = sql.taggedCalls[0];
    expect(query.text).toMatch(/LEFT JOIN action_records ar ON a\.action_id = ar\.action_id AND ar\.org_id = a\.org_id/);
    expect(query.values).toContain('asm_1');
    expect(query.values).toContain('org_a');
  });
});

describe('getAssumptionsDriftCounts — whole-table aggregate', () => {
  it('computes all counts in SQL under the same filters as listAssumptions', async () => {
    const sql = createSqlMock({ queryResponses: [
      [{ total: '450', at_risk: '120', validated: '200', invalidated: '30', unvalidated: '220' }],
    ] });

    const counts = await getAssumptionsDriftCounts(sql, 'org_a', { agent_id: 'agent-1' });
    expect(counts).toEqual({
      total: 450, at_risk: 120, validated: 200, invalidated: 30, unvalidated: 220,
    });

    const call = sql.queryCalls[0];
    // One aggregate over the whole table — no LIMIT/OFFSET anywhere.
    expect(call.text).not.toMatch(/LIMIT/i);
    expect(call.text).toMatch(/COUNT\(\*\) FILTER \(WHERE a\.validated = 1\)/);
    expect(call.text).toMatch(/14\.85 days/); // drift_score >= 50 boundary
    expect(call.params).toEqual(['org_a', 'agent-1']);
  });

  it('shares the WHERE builder with listAssumptions (same conditions text)', async () => {
    const listSql = createSqlMock({ queryResponses: [[], [{ total: '0' }]] });
    await listAssumptions(listSql, 'org_a', { validated: 'false', agent_id: 'agent-1' });

    const driftSql = createSqlMock({ queryResponses: [[{}]] });
    await getAssumptionsDriftCounts(driftSql, 'org_a', { validated: 'false', agent_id: 'agent-1' });

    // Extract the final WHERE clause (lastIndexOf skips the FILTER (WHERE …)
    // aggregate clauses) from each query and compare verbatim.
    const whereOf = (text) => text.slice(text.lastIndexOf('WHERE')).replace(/\s+/g, ' ').split(' ORDER BY')[0].split(' LIMIT')[0].trim();
    const listWhere = whereOf(listSql.queryCalls[0].text);
    const driftWhere = whereOf(driftSql.queryCalls[0].text);
    expect(driftWhere).toBe(listWhere);
    expect(listWhere).toMatch(/a\.validated = 0 AND a\.invalidated = 0/);
  });
});

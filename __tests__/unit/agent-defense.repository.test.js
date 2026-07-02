import { describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { getGuardDecisionById } from '@/lib/repositories/guardrails.repository';
import { getActionWithRelations } from '@/lib/repositories/actions.repository';

// FK-join wiring for the agent's-advocate rollup: the action detail response
// joins guard_decisions by action_records.guard_decision_id (org-scoped),
// never by the legacy action_type+timestamp heuristic.

describe('getGuardDecisionById', () => {
  it('scopes the lookup to the org (tenant boundary)', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 'act_gd_1', decision: 'allow' }]] });
    const row = await getGuardDecisionById(sql, 'org_a', 'act_gd_1');
    expect(row).toEqual({ id: 'act_gd_1', decision: 'allow' });
    expect(sql.queryCalls).toHaveLength(1);
    expect(sql.queryCalls[0].text).toContain('FROM guard_decisions WHERE org_id = $1 AND id = $2');
    expect(sql.queryCalls[0].params).toEqual(['org_a', 'act_gd_1']);
  });

  it('returns null when the decision does not exist in the org', async () => {
    const sql = createSqlMock({ queryResponses: [[]] });
    await expect(getGuardDecisionById(sql, 'org_b', 'act_gd_1')).resolves.toBeNull();
  });
});

describe('getActionWithRelations agent_defense wiring', () => {
  const actionRow = (overrides = {}) => ({
    action_id: 'act_1',
    org_id: 'org_1',
    action_type: 'deploy',
    declared_goal: 'ship it',
    reasoning: null,
    authorization_scope: null,
    trigger: null,
    guard_decision_id: 'act_gd_9',
    ...overrides,
  });

  it('fetches the linked guard decision by FK and shapes agent_defense', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [actionRow()], // action
        [],            // open_loops
        [{ assumption_id: 'asm_1', validated: 1, invalidated: 0 }], // assumptions
        [{ total: 0, participants: '', first_message_at: null, last_message_at: null }],
      ],
      queryResponses: [[{
        id: 'act_gd_9',
        decision: 'allow',
        reason: null,
        matched_policies: JSON.stringify(['pol_1']),
        context: JSON.stringify({ _shields: { prompt_injection: 'clean' }, _risk_breakdown: { final: 12 } }),
        evidence: null,
        risk_score: 12,
        action_type: 'deploy',
      }]],
    });

    const result = await getActionWithRelations(sql, 'org_1', 'act_1');
    expect(sql.queryCalls).toHaveLength(1);
    expect(sql.queryCalls[0].params).toEqual(['org_1', 'act_gd_9']);

    // JSON text columns come back parsed on the response row.
    expect(result.guard_decision.matched_policies).toEqual(['pol_1']);
    expect(result.guard_decision.context._shields).toEqual({ prompt_injection: 'clean' });

    expect(result.agent_defense.decision).toMatchObject({ linked: true, id: 'act_gd_9', risk_score: 12 });
    expect(result.agent_defense.shields.prompt_injection.status).toBe('clean');
    expect(result.agent_defense.assumed).toEqual({ total: 1, validated: 1, invalidated: 0, open: 0 });
  });

  it('issues no guard-decision query when the action has no FK; renders linked:false', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [actionRow({ guard_decision_id: null })],
        [],
        [],
        [{ total: 0, participants: '', first_message_at: null, last_message_at: null }],
      ],
    });

    const result = await getActionWithRelations(sql, 'org_1', 'act_1');
    expect(sql.queryCalls).toHaveLength(0);
    expect(result.guard_decision).toBeNull();
    expect(result.agent_defense.decision).toEqual({ linked: false });
    expect(result.agent_defense.shields.prompt_injection.status).toBe('not_recorded');
  });
});

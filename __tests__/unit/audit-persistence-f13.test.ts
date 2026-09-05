import { describe, expect, it } from 'vitest';
import { createPlanWithSteps, reviewPlan } from '../../app/lib/repositories/plans.repository';

type SqlCall = { text: string; values: unknown[] };

function sqlCapture(responses: unknown[][]) {
  const calls: SqlCall[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(responses.shift() ?? []);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
    query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    calls: SqlCall[];
  };
  sql.query = async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    return (responses.shift() ?? []) as Record<string, unknown>[];
  };
  sql.calls = calls;
  return sql;
}

describe('F13 plan mutation atomicity', () => {
  it('creates the plan header and every step in one statement under the pending-cap gate', async () => {
    const sql = sqlCapture([[
      {
        plan: { plan_id: 'pa_atomic', status: 'previewing' },
        steps: [{ step_id: 'ps_atomic', plan_id: 'pa_atomic', seq: 1 }],
      },
    ]]);

    const result = await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent_1',
      declaredGoal: 'ship safely',
      ttlMinutes: 60,
      maxPending: 10,
      steps: [{ action_type: 'deploy', step_goal: 'deploy safely' }],
    });

    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]!.text).toContain('INSERT INTO plan_authorizations');
    expect(sql.calls[0]!.text).toContain('INSERT INTO plan_authorization_steps');
    expect(sql.calls[0]!.text).toContain('pg_try_advisory_xact_lock');
    expect(result?.steps).toHaveLength(1);
  });

  it('denies a pending plan header and all of its steps in one statement', async () => {
    const sql = sqlCapture([
      [{ plan_id: 'pa_1', ttl_minutes: 60, status: 'pending' }],
      [{ plan: { plan_id: 'pa_1', status: 'denied' }, steps: [{ step_id: 'ps_1', grant_status: 'denied' }] }],
    ]);

    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', {
      verdict: 'deny', reviewedBy: 'operator', ttlClampMinutes: 480,
    });

    expect(sql.calls).toHaveLength(2);
    const mutation = sql.calls[1]!.text;
    expect(mutation).toContain('UPDATE plan_authorizations');
    expect(mutation).toContain('UPDATE plan_authorization_steps');
    expect(result?.plan.status).toBe('denied');
    expect(result?.steps[0]?.grant_status).toBe('denied');
  });
});

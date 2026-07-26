// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// Repository-level tests — this IS the repository, so the sql tag itself is
// scripted. The mock echoes back the interpolated VALUES as the RETURNING row
// so assertions on minted ids / hashes genuinely exercise createPlanWithSteps
// rather than trusting an arbitrary stub.
import { describe, it, expect } from 'vitest';
import {
  createPlanWithSteps, reviewPlan, consumePlanStepGrant, findDeniedStepMatch,
} from '../../app/lib/repositories/plans.repository';

type SqlCall = { text: string; v: unknown[] };
type ScriptEntry = unknown[] | ((call: SqlCall) => unknown[]);

function sqlMock(script: ScriptEntry[]) {
  const calls: SqlCall[] = [];
  let i = 0;
  const next = (call: SqlCall): unknown[] => {
    const entry = script[i++];
    if (entry === undefined) return [];
    return typeof entry === 'function' ? entry(call) : entry;
  };
  const tag = ((strings: TemplateStringsArray, ...v: unknown[]) => {
    const call: SqlCall = { text: strings.join('?'), v };
    calls.push(call);
    return Promise.resolve(next(call));
  }) as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
    query: (text: string, params?: unknown[]) => Promise<unknown[]>;
    calls: SqlCall[];
  };
  tag.calls = calls;
  tag.query = async (text: string, params: unknown[] = []) => {
    const call: SqlCall = { text, v: params };
    calls.push(call);
    return next(call);
  };
  return tag;
}

describe('plans.repository', () => {
  it('createPlanWithSteps mints pa_/ps_ ids, seq from 1, act hash only when act present', async () => {
    const sql = sqlMock([
      // plan insert: (plan_id, org_id, agent_id, declared_goal, ttl_minutes) — status is a literal
      (c) => [{ plan_id: c.v[0], org_id: c.v[1], agent_id: c.v[2], declared_goal: c.v[3], status: 'pending', ttl_minutes: c.v[4] }],
      // step insert #1: (step_id, plan_id, org_id, seq, action_type, step_goal, act, act_content_hash)
      (c) => [{ step_id: c.v[0], plan_id: c.v[1], org_id: c.v[2], seq: c.v[3], action_type: c.v[4], step_goal: c.v[5], act: c.v[6], act_content_hash: c.v[7] }],
      // step insert #2
      (c) => [{ step_id: c.v[0], plan_id: c.v[1], org_id: c.v[2], seq: c.v[3], action_type: c.v[4], step_goal: c.v[5], act: c.v[6], act_content_hash: c.v[7] }],
    ]);
    const { plan, steps } = await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship the feature', ttlMinutes: 60,
      steps: [
        { action_type: 'code_change', step_goal: 'edit file', act: { kind: 'file', file: { path: 'a.ts' } } },
        { action_type: 'deploy', step_goal: 'deploy it' },
      ],
    });
    expect(plan!.plan_id).toMatch(/^pa_[0-9a-f]{16}$/);
    expect(steps[0]!.step_id).toMatch(/^ps_[0-9a-f]{16}$/);
    expect(steps[0]!.seq).toBe(1);
    expect(steps[1]!.seq).toBe(2);
    // computeActContentHash returns 'sha256:' + base64url digest (canonicalize.ts),
    // not a bare 64-hex sha — the brief's regex assumption doesn't match the real format.
    expect(steps[0]!.act_content_hash).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
    expect(steps[1]!.act_content_hash).toBeNull();
  });

  it('reviewPlan clamps ttl_minutes to ttlClampMinutes', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 99999, status: 'pending' }], // SELECT plan
      [], // SELECT step_id FROM plan_authorization_steps (no steps -> approved, denied=0)
      [{ plan_id: 'pa_1', status: 'approved' }], // UPDATE plan_authorizations RETURNING *
      [], // SELECT steps ORDER BY seq ASC
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', { verdict: 'approve', stepOverrides: {}, reviewedBy: 'operator', ttlClampMinutes: 480 });
    expect(result!.plan!.status).toBe('approved');
    const update = sql.calls.find((c) => c.text.includes('expires_at'));
    expect(update).toBeTruthy();
    // the interval parameter passed must be min(99999, 480) = 480
    expect(update!.v).toContain(480);
  });

  it('reviewPlan approve with a deny override passes ttlClampMinutes, not clampedTtl', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 100, status: 'pending' }], // SELECT plan (clampedTtl would be min(100, 480) = 100)
      [{ step_id: 'ps_1' }, { step_id: 'ps_2' }], // SELECT step_id FROM plan_authorization_steps (two steps)
      [{ plan_id: 'pa_1', status: 'partially_approved' }], // UPDATE plan_authorizations RETURNING *
      [], // UPDATE plan_authorization_steps SET grant_status = 'approved' (ps_1)
      [], // UPDATE plan_authorization_steps SET grant_status = 'denied' (ps_2)
      [], // SELECT steps ORDER BY seq ASC
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', {
      verdict: 'approve', stepOverrides: { ps_2: 'deny' }, reviewedBy: 'operator', ttlClampMinutes: 480,
    });
    expect(result!.plan!.status).toBe('partially_approved');
    const headerUpdate = sql.calls.find((c) => c.text.includes('UPDATE plan_authorizations') && c.text.includes('expires_at'));
    expect(headerUpdate).toBeTruthy();
    // A step denial is an operator "no" — its lifetime is the org clamp (480),
    // never the agent-requested clampedTtl (min(100, 480) = 100).
    expect(headerUpdate!.v).toContain(480);
    expect(headerUpdate!.v).not.toContain(100);
  });

  it('consumePlanStepGrant issues a single atomic UPDATE with grant_used_at IS NULL guard', async () => {
    const sql = sqlMock([
      [{ step_id: 'ps_1', plan_id: 'pa_1', seq: 1, reviewed_by: 'operator', act_content_hash: null, total_steps: 3 }],
    ]);
    const hit = await consumePlanStepGrant(sql as never, 'org_1', {
      agentId: 'agent-a', actionType: 'deploy', declaredGoal: 'deploy it', actHash: null, matchedActionId: 'act_gd_x',
    });
    expect(hit!.step_id).toBe('ps_1');
    const q = sql.calls[0]!.text;
    expect(q).toContain('grant_used_at IS NULL');
    expect(q).toContain('UPDATE plan_authorization_steps');
    // guard appears twice: once in the subquery WHERE, once in the outer WHERE
    expect(q.split('grant_used_at IS NULL').length - 1).toBe(2);
  });

  it('findDeniedStepMatch is a read (no UPDATE)', async () => {
    const sql = sqlMock([[]]);
    const hit = await findDeniedStepMatch(sql as never, 'org_1', { agentId: 'a', actionType: 'deploy', declaredGoal: 'g', actHash: null });
    expect(hit).toBeNull();
    expect(sql.calls[0]!.text).not.toContain('UPDATE');
  });

  it('revoke leaves step grant_status untouched and sets expires_at = now()', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 60, status: 'approved' }], // SELECT plan
      [{ plan_id: 'pa_1', status: 'revoked' }], // UPDATE plan_authorizations RETURNING *
      [], // SELECT steps ORDER BY seq ASC
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', { verdict: 'revoke', reviewedBy: 'operator', ttlClampMinutes: 480 });
    expect(result!.plan!.status).toBe('revoked');
    const touchedStepGrantStatus = sql.calls.some(
      (c) => c.text.includes('UPDATE plan_authorization_steps') && c.text.includes('grant_status'),
    );
    expect(touchedStepGrantStatus).toBe(false);
    // Revoke is the universal kill switch: it also forces expires_at to now(),
    // which is what actually ends explicit step denials in findDeniedStepMatch.
    const headerUpdate = sql.calls.find((c) => c.text.includes('UPDATE plan_authorizations'));
    expect(headerUpdate!.text).toContain("status = 'revoked'");
    expect(headerUpdate!.text).toContain('expires_at = now()');
  });

  it('revoke is allowed from denied status (kills active denials, not just grants)', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 60, status: 'denied' }], // SELECT plan
      [{ plan_id: 'pa_1', status: 'revoked' }], // UPDATE plan_authorizations RETURNING * (guarded, still matches 'denied')
      [], // SELECT steps ORDER BY seq ASC
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', { verdict: 'revoke', reviewedBy: 'operator', ttlClampMinutes: 480 });
    expect(result!.plan!.status).toBe('revoked');
    const headerUpdate = sql.calls.find((c) => c.text.includes('UPDATE plan_authorizations'));
    expect(headerUpdate!.text).toContain("'denied'");
  });

  it('reviewPlan deny uses the org ttlClampMinutes directly, never min(ttl_minutes, clamp)', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 10, status: 'pending' }], // SELECT plan (small ttl_minutes)
      [{ plan_id: 'pa_1', status: 'denied' }], // UPDATE plan_authorizations RETURNING * (header, guarded on status='pending')
      [], // UPDATE plan_authorization_steps SET grant_status = 'denied'
      [], // SELECT steps ORDER BY seq ASC
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', { verdict: 'deny', reviewedBy: 'operator', ttlClampMinutes: 480 });
    expect(result!.plan!.status).toBe('denied');
    const headerUpdate = sql.calls.find((c) => c.text.includes('UPDATE plan_authorizations') && c.text.includes('expires_at'));
    expect(headerUpdate).toBeTruthy();
    // Must be the org clamp (480) — never min(plan.ttl_minutes=10, 480) = 10.
    expect(headerUpdate!.v).toContain(480);
    expect(headerUpdate!.v).not.toContain(10);
  });

  it('findDeniedStepMatch keeps revoked in the status list (belt-and-braces; revoke expiry is what ends denials)', async () => {
    const sql = sqlMock([[]]);
    await findDeniedStepMatch(sql as never, 'org_1', { agentId: 'a', actionType: 'deploy', declaredGoal: 'g', actHash: null });
    expect(sql.calls[0]!.text).toContain("'revoked'");
    expect(sql.calls[0]!.text).toContain('grant_used_at IS NULL');
  });
});

// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// Repository-level tests — this IS the repository, so the sql tag itself is
// scripted. The mock echoes back the interpolated VALUES as the RETURNING row
// so assertions on minted ids / hashes genuinely exercise createPlanWithSteps
// rather than trusting an arbitrary stub.
import { describe, it, expect } from 'vitest';
import {
  createPlanWithSteps, reviewPlan, consumePlanStepGrant, findDeniedStepMatch, countPendingPlans,
  markPlanPending, listPlans, getPlanWithSteps, PENDING_PLAN_CAP_WINDOW_MINUTES,
} from '../../app/lib/repositories/plans.repository';
import { computeActContentHash } from '../../app/lib/act-content-hash';

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
    const { plan, steps } = (await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship the feature', ttlMinutes: 60, maxPending: 10,
      steps: [
        { action_type: 'code_change', step_goal: 'edit file', act: { kind: 'file', file: { path: 'a.ts' } } },
        { action_type: 'deploy', step_goal: 'deploy it' },
      ],
    }))!;
    expect(plan!.plan_id).toMatch(/^pa_[0-9a-f]{16}$/);
    expect(steps[0]!.step_id).toMatch(/^ps_[0-9a-f]{16}$/);
    expect(steps[0]!.seq).toBe(1);
    expect(steps[1]!.seq).toBe(2);
    // U4: inserted as 'previewing', not 'pending' — the route flips it to
    // 'pending' via markPlanPending once every step has a preview verdict.
    // The cap subquery counts BOTH statuses (each occupies a cap slot).
    expect(sql.calls[0]!.text).toContain("'previewing'");
    expect(sql.calls[0]!.text).toContain("status IN ('previewing', 'pending')");
    // computeActContentHash returns 'sha256:' + base64url digest (canonicalize.ts),
    // not a bare 64-hex sha — the brief's regex assumption doesn't match the real format.
    expect(steps[0]!.act_content_hash).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
    expect(steps[1]!.act_content_hash).toBeNull();
  });

  it('S2: stores a redacted act while act_content_hash binds the AS-RECEIVED (unredacted) act', async () => {
    // Built at runtime (not a literal secret-shaped string in source) so it
    // still matches security.ts's openai_key pattern (sk-[A-Za-z0-9]{20,})
    // at test time without tripping secret-scanning on the file itself.
    const fakeKey = ['sk', 'X'.repeat(24)].join('-');
    const secretAct = { kind: 'shell', command: `export TOKEN=${fakeKey} && deploy` };
    const sql = sqlMock([
      (c) => [{ plan_id: c.v[0], org_id: c.v[1], agent_id: c.v[2], declared_goal: c.v[3], status: 'pending', ttl_minutes: c.v[4] }],
      (c) => [{ step_id: c.v[0], plan_id: c.v[1], org_id: c.v[2], seq: c.v[3], action_type: c.v[4], step_goal: c.v[5], act: c.v[6], act_content_hash: c.v[7] }],
    ]);
    const { steps } = (await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'deploy', ttlMinutes: 60, maxPending: 10,
      steps: [{ action_type: 'deploy', step_goal: 'deploy it', act: secretAct }],
    }))!;
    const storedAct = JSON.parse(steps[0]!.act as string);
    expect(storedAct.command).not.toContain(fakeKey);
    // the hash binds the ORIGINAL act, not the redacted display copy
    expect(steps[0]!.act_content_hash).toBe(computeActContentHash(secretAct));
  });

  it('R3: createPlanWithSteps returns null when the SQL-enforced pending cap rejects the insert', async () => {
    // The guarded INSERT ... SELECT ... WHERE returns zero rows when the org
    // is already at maxPending — this is the authoritative check, not just
    // the route's countPendingPlans pre-read (which has a TOCTOU window).
    const sql = sqlMock([[]]);
    const result = await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship the feature', ttlMinutes: 60, maxPending: 10,
      steps: [{ action_type: 'deploy', step_goal: 'deploy it' }],
    });
    expect(result).toBeNull();
    // No step INSERTs are attempted once the header insert is rejected.
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]!.text).toContain('WHERE (SELECT COUNT(*) FROM plan_authorizations');
  });

  it('T1: stamps created_by from input.createdBy into the INSERT', async () => {
    const sql = sqlMock([
      (c) => [{ plan_id: c.v[0], org_id: c.v[1], agent_id: c.v[2], declared_goal: c.v[3], status: 'pending', ttl_minutes: c.v[4], created_by: c.v[5] }],
    ]);
    const { plan } = (await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship the feature', ttlMinutes: 60, maxPending: 10,
      steps: [], createdBy: 'user_submitter',
    }))!;
    expect((plan as { created_by?: string }).created_by).toBe('user_submitter');
    expect(sql.calls[0]!.text).toContain('created_by');
    expect(sql.calls[0]!.v).toContain('user_submitter');
  });

  it('T1: createdBy defaults to null when omitted', async () => {
    const sql = sqlMock([
      (c) => [{ plan_id: c.v[0], created_by: c.v[5] }],
    ]);
    const { plan } = (await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship the feature', ttlMinutes: 60, maxPending: 10, steps: [],
    }))!;
    expect((plan as { created_by?: unknown }).created_by).toBeNull();
  });

  it('T3: the pending-cap INSERT ages out plans older than PENDING_PLAN_CAP_WINDOW_MINUTES', async () => {
    const sql = sqlMock([[]]);
    await createPlanWithSteps(sql as never, 'org_1', {
      agentId: 'agent-a', declaredGoal: 'ship the feature', ttlMinutes: 60, maxPending: 10, steps: [],
    });
    const text = sql.calls[0]!.text;
    expect(text).toContain('created_at > now() - make_interval(mins =>');
    expect(sql.calls[0]!.v).toContain(PENDING_PLAN_CAP_WINDOW_MINUTES);
  });

  it('T3: countPendingPlans applies the same aging predicate as the INSERT guard', async () => {
    const sql = sqlMock([[{ n: 3 }]]);
    const n = await countPendingPlans(sql as never, 'org_1');
    expect(n).toBe(3);
    const text = sql.calls[0]!.text;
    expect(text).toContain('created_at > now() - make_interval(mins =>');
    expect(sql.calls[0]!.v).toContain(PENDING_PLAN_CAP_WINDOW_MINUTES);
    // U4: counts both 'previewing' and 'pending' — each occupies a cap slot.
    expect(text).toContain("status IN ('previewing', 'pending')");
  });

  it('U4: markPlanPending flips a previewing plan to pending, guarded on status in SQL', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', status: 'pending' }],
    ]);
    const result = await markPlanPending(sql as never, 'org_1', 'pa_1');
    expect(result).toEqual({ plan_id: 'pa_1', status: 'pending' });
    const text = sql.calls[0]!.text;
    expect(text).toContain('UPDATE plan_authorizations');
    expect(text).toContain("SET status = 'pending'");
    expect(text).toContain("status = 'previewing'");
  });

  it('U4: markPlanPending returns null when the status precondition loses a race', async () => {
    const sql = sqlMock([[]]);
    const result = await markPlanPending(sql as never, 'org_1', 'pa_1');
    expect(result).toBeNull();
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
    // R1: unlike findDeniedStepMatch, grants must fail safe by UNDER-matching
    // — a grant is only usable by the agent it was actually issued to.
    expect(q).toContain('p.agent_id = ?');
    // guard appears twice: once in the subquery WHERE, once in the outer WHERE
    expect(q.split('grant_used_at IS NULL').length - 1).toBe(2);
    // U3: preview_decision rides the RETURNING clause — it feeds the
    // _plan_grant audit provenance (operator's preview verdict vs. the live
    // evaluation that just consumed the grant).
    expect(q).toContain('s.preview_decision');
  });

  it('S4: consumePlanStepGrant requires step_goal equality on the act-bound branch too (parity with applyOperatorApprovalGrant)', async () => {
    const sql = sqlMock([[]]);
    await consumePlanStepGrant(sql as never, 'org_1', {
      agentId: 'agent-a', actionType: 'deploy', declaredGoal: 'deploy it', actHash: 'sha256:x', matchedActionId: 'act_gd_x',
    });
    const q = sql.calls[0]!.text;
    expect(q).toContain('act_content_hash IS NOT NULL AND st.act_content_hash = ? AND st.step_goal = ?');
  });

  it('findDeniedStepMatch is a read (no UPDATE)', async () => {
    const sql = sqlMock([[]]);
    const hit = await findDeniedStepMatch(sql as never, 'org_1', { actionType: 'deploy', declaredGoal: 'g', actHash: null });
    expect(hit).toBeNull();
    expect(sql.calls[0]!.text).not.toContain('UPDATE');
  });

  it('R1: findDeniedStepMatch does not scope on agent_id — a denial binds the org, not one self-asserted identity', async () => {
    // agent_id is self-asserted at guard time absent a verified JWT, so a
    // denial that only matched the original agent_id could be evaded by the
    // same denied act resuming under a different claimed agent_id. The query
    // must carry no p.agent_id predicate at all, and must still raise the
    // match — org + action_type + goal/hash is sufficient.
    const sql = sqlMock([[{ step_id: 'ps_1', plan_id: 'pa_1', reviewed_by: 'operator' }]]);
    const hit = await findDeniedStepMatch(sql as never, 'org_1', {
      actionType: 'deploy', declaredGoal: 'deploy the thing', actHash: null,
    });
    expect(hit!.step_id).toBe('ps_1');
    expect(sql.calls[0]!.text).not.toContain('agent_id');
  });

  it('S1b: findDeniedStepMatch raises on act hash OR (action_type AND goal) — a denied act-bound step still matches on a goal-only hit with a different act', async () => {
    // Fail-open regression guard: the old query gated each branch behind
    // its own NOT-NULL check ("act_content_hash IS NOT NULL AND hash = ?"
    // OR "act_content_hash IS NULL AND goal = ?"), so mutating a denied
    // act-bound step's act (changing its hash) fell through BOTH branches
    // and silently evaded the denial. The fixed query ORs the two match
    // modes directly so either one alone still raises.
    const sql = sqlMock([[{ step_id: 'ps_1', plan_id: 'pa_1', reviewed_by: 'operator' }]]);
    const hit = await findDeniedStepMatch(sql as never, 'org_1', {
      actionType: 'deploy', declaredGoal: 'deploy the thing', actHash: 'sha256:mutated-act',
    });
    expect(hit!.step_id).toBe('ps_1');
    const q = sql.calls[0]!.text;
    expect(q).not.toContain('act_content_hash IS NOT NULL');
    expect(q).not.toContain('act_content_hash IS NULL AND');
    // V2: action_type is now scoped to the goal branch only — the hash
    // branch matches on the act's content alone, independent of action_type.
    expect(q).toContain('(st.act_content_hash = ? OR (st.action_type = ? AND st.step_goal = ?))');
  });

  // V2: a byte-identical denied act blocks regardless of what action_type
  // the caller declares this time — the hash IS the proof it's the same
  // payload, so relabeling the action_type must not evade the denial.
  it('V2: findDeniedStepMatch matches on act hash alone even when actionType is null (no action_type supplied)', async () => {
    const sql = sqlMock([[{ step_id: 'ps_1', plan_id: 'pa_1', reviewed_by: 'operator' }]]);
    const hit = await findDeniedStepMatch(sql as never, 'org_1', {
      actionType: null, declaredGoal: '', actHash: 'sha256:denied-act',
    });
    expect(hit!.step_id).toBe('ps_1');
  });

  // V2: the goal-only branch is NOT relaxed — action_type is interpolated
  // INSIDE the parenthesized goal clause (proven by the S1b string match
  // above), so a goal hit alone never matches a differently-typed step; only
  // the hash branch is action_type-independent. This asserts the query
  // parameterizes action_type + declaredGoal into that same branch.
  it('V2: findDeniedStepMatch interpolates actionType and declaredGoal together into the goal branch', async () => {
    const sql = sqlMock([[]]);
    await findDeniedStepMatch(sql as never, 'org_1', {
      actionType: 'code_change', declaredGoal: 'deploy the thing', actHash: null,
    });
    expect(sql.calls[0]!.v).toContain('code_change');
    expect(sql.calls[0]!.v).toContain('deploy the thing');
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

  it('U4: revoke is allowed from previewing status (kills a stuck preview run)', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 60, status: 'previewing' }], // SELECT plan
      [{ plan_id: 'pa_1', status: 'revoked' }], // UPDATE plan_authorizations RETURNING *
      [], // SELECT steps ORDER BY seq ASC
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', { verdict: 'revoke', reviewedBy: 'operator', ttlClampMinutes: 480 });
    expect(result!.plan!.status).toBe('revoked');
    const headerUpdate = sql.calls.find((c) => c.text.includes('UPDATE plan_authorizations'));
    expect(headerUpdate!.text).toContain("'previewing'");
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

  it('denyLiftAllowed:false — revoke of a denied plan returns null without writing', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 60, status: 'denied' }], // SELECT plan
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', {
      verdict: 'revoke', reviewedBy: 'submitter_key', ttlClampMinutes: 480, denyLiftAllowed: false,
    });
    expect(result).toBeNull();
    expect(sql.calls.some((c) => c.text.includes('UPDATE'))).toBe(false);
  });

  it('denyLiftAllowed:false — revoke of a live plan still works, and the SQL predicate (not just the pre-read) gates the denied arm', async () => {
    const sql = sqlMock([
      [{ plan_id: 'pa_1', ttl_minutes: 60, status: 'approved' }], // SELECT plan
      [{ plan_id: 'pa_1', status: 'revoked' }], // UPDATE plan_authorizations RETURNING *
      [], // SELECT steps ORDER BY seq ASC
    ]);
    const result = await reviewPlan(sql as never, 'org_1', 'pa_1', {
      verdict: 'revoke', reviewedBy: 'submitter_key', ttlClampMinutes: 480, denyLiftAllowed: false,
    });
    expect(result!.plan!.status).toBe('revoked');
    const headerUpdate = sql.calls.find((c) => c.text.includes('UPDATE plan_authorizations'));
    // The denied arm is parameterized on denyLiftAllowed so it holds at
    // WRITE time — a denial landing after the route's pre-read cannot be
    // lifted by a principal the route computed as not-allowed.
    expect(headerUpdate!.text).toContain("AND status = 'denied'");
    expect(headerUpdate!.v).toContain(false);
  });

  it('read paths derive expired: SELECTs carry the CASE, and a status filter matches the DERIVED value', async () => {
    const sql = sqlMock([
      [], // listPlans query
      [{ plan_id: 'pa_1', status: 'expired' }], // getPlanWithSteps plan query
      [], // getPlanWithSteps steps query
    ]);
    await listPlans(sql as never, 'org_1', { status: 'expired' });
    const listCall = sql.calls[0]!;
    expect(listCall.text).toContain("THEN 'expired' ELSE status END");
    // The filter wraps the derived expression, so ?status=approved excludes
    // lapsed plans and ?status=expired finds them.
    expect(listCall.text).toMatch(/CASE[\s\S]*END\) = \$2/);

    await getPlanWithSteps(sql as never, 'org_1', 'pa_1');
    const detailCall = sql.calls[1]!;
    expect(detailCall.text).toContain("THEN 'expired' ELSE status END");
    // reviewPlan intentionally reads RAW status (denied past TTL stays
    // subject to its own revoke/lift rules) — pinned by it NOT carrying the
    // derivation.
    const reviewSql = sqlMock([[{ plan_id: 'pa_1', ttl_minutes: 60, status: 'denied' }]]);
    await reviewPlan(reviewSql as never, 'org_1', 'pa_1', {
      verdict: 'revoke', reviewedBy: 'x', ttlClampMinutes: 480, denyLiftAllowed: false,
    });
    expect(reviewSql.calls[0]!.text).not.toContain('THEN \'expired\'');
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
    await findDeniedStepMatch(sql as never, 'org_1', { actionType: 'deploy', declaredGoal: 'g', actHash: null });
    expect(sql.calls[0]!.text).toContain("'revoked'");
    expect(sql.calls[0]!.text).toContain('grant_used_at IS NULL');
  });
});

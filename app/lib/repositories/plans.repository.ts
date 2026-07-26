import { randomUUID } from 'crypto';
import { computeActContentHash } from '../act-content-hash';
import { redactAny } from '../security';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// All SQL for the feature lives here — routes must not embed SQL (route-sql:check).
// Grants are single-use: consumption is one atomic UPDATE ... WHERE grant_used_at
// IS NULL RETURNING, the same race-safety shape as applyOperatorApprovalGrant.

// U4: 'previewing' is the transient status between submission and the
// preview loop finishing (POST /api/plans flips it to 'pending' via
// markPlanPending once every step has a stamped preview verdict) — plans
// must not be approvable/deniable before their previews exist. revoke is the
// one verdict that also accepts 'previewing' (an operator can kill a stuck
// preview run).
export const PLAN_STATUSES = ['previewing', 'pending', 'approved', 'partially_approved', 'denied', 'expired', 'revoked'];
export const STEP_GRANT_STATUSES = ['pending', 'approved', 'denied'];

const mintId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

export interface PlanStepInput {
  action_type: string;
  step_goal: string;
  act?: unknown;
}

// T3: a pending plan older than the max grant TTL ceiling can never matter —
// aging it out of the cap query prevents an orphaned submission (one the
// operator never reviewed and that has long since exceeded any TTL a grant
// could carry) from permanently occupying a pending-cap slot and bricking
// the org's ability to submit new plans. Same value as the org's hard TTL
// clamp ceiling (DEFAULT_TTL_CLAMP_MINUTES in app/api/plans/[planId]/route.ts).
export const PENDING_PLAN_CAP_WINDOW_MINUTES = 480;

export async function createPlanWithSteps(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; declaredGoal: string; ttlMinutes: number; steps: PlanStepInput[]; maxPending: number; createdBy?: string | null },
) {
  const planId = mintId('pa');
  // R3: the pending-plan cap is enforced HERE, not only via the route's
  // countPendingPlans pre-read — that read-then-insert has a TOCTOU window
  // (two concurrent submissions can both pass the pre-read before either
  // INSERT lands). Folding the count into the INSERT's WHERE makes the
  // count-and-insert a single atomic statement: a losing race yields zero
  // rows instead of writing an (org_id, 'pending') row over the cap.
  // T3: the cap query ignores pending plans older than
  // PENDING_PLAN_CAP_WINDOW_MINUTES — a stale pending plan nobody reviewed
  // must not permanently occupy a slot.
  // U4: inserted as 'previewing' — the route flips it to 'pending' via
  // markPlanPending once the preview loop finishes. The cap counts BOTH
  // 'previewing' and 'pending' (each consumes a slot for the same reason:
  // an in-flight or unreviewed submission still occupies the org's cap).
  const planRows = await sql`
    INSERT INTO plan_authorizations (plan_id, org_id, agent_id, declared_goal, status, ttl_minutes, created_by)
    SELECT ${planId}, ${orgId}, ${input.agentId}, ${input.declaredGoal}, 'previewing', ${input.ttlMinutes}, ${input.createdBy ?? null}
    WHERE (SELECT COUNT(*) FROM plan_authorizations WHERE org_id = ${orgId} AND status IN ('previewing', 'pending')
      AND created_at > now() - make_interval(mins => ${PENDING_PLAN_CAP_WINDOW_MINUTES})) < ${input.maxPending}
    RETURNING *
  `;
  if (!planRows[0]) return null;
  const steps: Record<string, unknown>[] = [];
  let seq = 0;
  for (const step of input.steps) {
    seq += 1;
    const stepId = mintId('ps');
    // S2: the hash binds the act AS RECEIVED (what the operator's approval
    // actually attests to), but the persisted/returned copy is redacted —
    // otherwise a secret-bearing act would sit unredacted in the DB and in
    // every GET /api/plans response. Same redaction guard decisions use.
    const actHash = computeActContentHash(step.act);
    const redactedAct = step.act === undefined ? null : JSON.stringify(redactAny(step.act, []));
    const rows = await sql`
      INSERT INTO plan_authorization_steps
        (step_id, plan_id, org_id, seq, action_type, step_goal, act, act_content_hash)
      VALUES
        (${stepId}, ${planId}, ${orgId}, ${seq}, ${step.action_type}, ${step.step_goal},
         ${redactedAct}, ${actHash})
      RETURNING *
    `;
    steps.push(rows[0]!);
  }
  return { plan: planRows[0], steps };
}

export async function stampStepPreview(
  sql: SqlClient,
  orgId: string,
  stepId: string,
  preview: { decision: string; riskScore: number; reasons: unknown[] },
) {
  await sql`
    UPDATE plan_authorization_steps
    SET preview_decision = ${preview.decision},
        preview_risk_score = ${preview.riskScore},
        preview_reasons = ${JSON.stringify(preview.reasons)}
    WHERE org_id = ${orgId} AND step_id = ${stepId}
  `;
}

export async function listPlans(
  sql: SqlClient,
  orgId: string,
  filters: { status?: string; agentId?: string; limit?: number } = {},
) {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let idx = 2;
  if (filters.status) { conditions.push(`status = $${idx}`); params.push(filters.status); idx++; }
  if (filters.agentId) { conditions.push(`agent_id = $${idx}`); params.push(filters.agentId); idx++; }
  return sql.query(
    `SELECT * FROM plan_authorizations WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`,
    [...params, filters.limit ?? 50],
  );
}

export async function getPlanWithSteps(sql: SqlClient, orgId: string, planId: string) {
  const plans = await sql`
    SELECT * FROM plan_authorizations WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  if (!plans[0]) return null;
  const steps = await sql`
    SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
  `;
  return { plan: plans[0], steps };
}

export async function countPendingPlans(sql: SqlClient, orgId: string): Promise<number> {
  // T3: same aging-out predicate as the INSERT's guard above — the route's
  // pre-read must agree with the authoritative SQL-enforced cap, or the
  // pre-read would reject submissions the INSERT would actually allow.
  // U4: counts 'previewing' too — same rationale as the INSERT guard above.
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM plan_authorizations
    WHERE org_id = ${orgId} AND status IN ('previewing', 'pending')
      AND created_at > now() - make_interval(mins => ${PENDING_PLAN_CAP_WINDOW_MINUTES})
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * U4: flips a plan from 'previewing' to 'pending' once every step has a
 * stamped preview verdict — plans must not be reviewable (approve/deny) or
 * visible on /approvals (which fetches ?status=pending only) before their
 * previews exist. Guarded on status = 'previewing' in SQL so a losing race
 * (e.g. a concurrent revoke) returns null instead of clobbering a
 * transitioned row.
 */
export async function markPlanPending(sql: SqlClient, orgId: string, planId: string) {
  const rows = await sql`
    UPDATE plan_authorizations
    SET status = 'pending'
    WHERE org_id = ${orgId} AND plan_id = ${planId} AND status = 'previewing'
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Operator verdict. 'approve' honors stepOverrides (step_id -> 'approve'|'deny');
 * unlisted steps inherit 'approve'. Any denied step => plan status
 * 'partially_approved' (all denied => 'denied'). 'deny' denies every step,
 * with expires_at = now() + ttlClampMinutes (the org clamp — a denial's
 * duration is the operator's, never the constrained agent's requested TTL).
 * 'revoke' is the universal kill switch: it ends everything about the plan
 * immediately, both unconsumed grants (status exclusion) and explicit
 * review-time step denials (expires_at forced to now()) — an operator who
 * wants denials to persist keeps the plan un-revoked. Callable from pending,
 * approved, partially_approved, or denied. Approve/deny are only callable
 * from pending. Every header UPDATE carries its status precondition in SQL
 * (not just the pre-read) so a losing race returns null instead of writing
 * steps for a plan that already transitioned; per-step grant_status writes
 * happen only after the guarded header UPDATE succeeds. Returns null when
 * the plan is missing or not transitionable.
 */
export async function reviewPlan(
  sql: SqlClient,
  orgId: string,
  planId: string,
  input: { verdict: 'approve' | 'deny' | 'revoke'; stepOverrides?: Record<string, string>; reviewedBy: string; ttlClampMinutes: number },
) {
  const plans = await sql`
    SELECT * FROM plan_authorizations WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  const plan = plans[0] as { plan_id: string; status: string; ttl_minutes: number } | undefined;
  if (!plan) return null;

  if (input.verdict === 'revoke') {
    // U4: 'previewing' is included so an operator can kill a stuck preview
    // run (e.g. the dry-run loop hung mid-plan) before it ever reaches
    // 'pending'.
    if (!['previewing', 'pending', 'approved', 'partially_approved', 'denied'].includes(plan.status)) return null;
    // Revoke ends everything about the plan immediately: unconsumed grants
    // via the status exclusion in consumePlanStepGrant (which only matches
    // approved/partially_approved), and explicit step denials via
    // expires_at — forced into the past here so findDeniedStepMatch's
    // p.expires_at > now() check excludes them the same instant. It does
    // NOT rewrite step grant_status: grant_status records operator intent
    // (what was explicitly approved/denied at review time), while status +
    // expires_at control liveness. An operator who wants denials to persist
    // simply leaves the plan un-revoked.
    const updated = await sql`
      UPDATE plan_authorizations
      SET status = 'revoked', reviewed_by = ${input.reviewedBy}, reviewed_at = now(), expires_at = now()
      WHERE org_id = ${orgId} AND plan_id = ${planId}
        AND status IN ('previewing', 'pending', 'approved', 'partially_approved', 'denied')
      RETURNING *
    `;
    if (!updated[0]) return null;
    const steps = await sql`
      SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
    `;
    return { plan: updated[0], steps };
  }

  if (plan.status !== 'pending') return null;
  const clampedTtl = Math.min(Number(plan.ttl_minutes) || 60, input.ttlClampMinutes);

  if (input.verdict === 'deny') {
    // expires_at uses the org clamp directly (input.ttlClampMinutes), NOT
    // min(ttl_minutes, ttlClampMinutes): a denial's duration is set by the
    // operator, not by the TTL the constrained agent originally requested.
    const updated = await sql`
      UPDATE plan_authorizations
      SET status = 'denied', reviewed_by = ${input.reviewedBy}, reviewed_at = now(),
          expires_at = now() + make_interval(mins => ${input.ttlClampMinutes})
      WHERE org_id = ${orgId} AND plan_id = ${planId} AND status = 'pending'
      RETURNING *
    `;
    if (!updated[0]) return null;
    await sql`
      UPDATE plan_authorization_steps SET grant_status = 'denied'
      WHERE org_id = ${orgId} AND plan_id = ${planId}
    `;
    const steps = await sql`
      SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
    `;
    return { plan: updated[0], steps };
  }

  // approve (with optional per-step overrides). Compute verdicts up front
  // (needed for the header UPDATE's aggregate status), then write the header
  // row under its 'pending' precondition, and only write per-step
  // grant_status once that guarded UPDATE actually succeeded — a lost race
  // writes nothing to plan_authorization_steps.
  const overrides = input.stepOverrides ?? {};
  const stepRows = await sql`
    SELECT step_id FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  let denied = 0;
  const stepVerdicts = (stepRows as Array<{ step_id: string }>).map((row) => {
    const verdict = overrides[row.step_id] === 'deny' ? 'denied' : 'approved';
    if (verdict === 'denied') denied += 1;
    return { step_id: row.step_id, verdict };
  });
  const status = denied === 0 ? 'approved' : denied === stepRows.length ? 'denied' : 'partially_approved';
  // Same asymmetry as the standalone 'deny' verdict above: any denied step is
  // an operator "no", so its lifetime is the org clamp (input.ttlClampMinutes)
  // rather than the agent-requested clampedTtl. Only the all-approved case
  // (denied === 0) gets the agent's own clamped TTL.
  const ttlMinutes = denied === 0 ? clampedTtl : input.ttlClampMinutes;
  const updated = await sql`
    UPDATE plan_authorizations
    SET status = ${status}, reviewed_by = ${input.reviewedBy}, reviewed_at = now(),
        expires_at = now() + make_interval(mins => ${ttlMinutes})
    WHERE org_id = ${orgId} AND plan_id = ${planId} AND status = 'pending'
    RETURNING *
  `;
  if (!updated[0]) return null;
  for (const v of stepVerdicts) {
    await sql`
      UPDATE plan_authorization_steps SET grant_status = ${v.verdict}
      WHERE org_id = ${orgId} AND step_id = ${v.step_id}
    `;
  }
  const steps = await sql`
    SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
  `;
  return { plan: updated[0], steps };
}

/**
 * Single-use atomic consumption — the plan-grant twin of the operator-grant
 * UPDATE in evaluate.ts. Matching: org + agent + action_type + live plan
 * (approved/partially_approved, unexpired) + approved unconsumed step + act
 * binding (step hash must equal the live hash when the step is act-bound;
 * hashless steps match on step_goal = live declared_goal instead).
 */
export async function consumePlanStepGrant(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; actionType: string; declaredGoal: string; actHash: string | null; matchedActionId: string },
) {
  const rows = await sql`
    UPDATE plan_authorization_steps s
    SET grant_used_at = now(), matched_action_id = ${input.matchedActionId}
    WHERE s.step_id = (
      SELECT st.step_id
      FROM plan_authorization_steps st
      JOIN plan_authorizations p ON p.plan_id = st.plan_id AND p.org_id = st.org_id
      WHERE st.org_id = ${orgId}
        AND p.agent_id = ${input.agentId}
        AND st.action_type = ${input.actionType}
        AND p.status IN ('approved', 'partially_approved')
        AND p.expires_at > now()
        AND st.grant_status = 'approved'
        AND st.grant_used_at IS NULL
        -- S4: act-bound grants also require declared_goal equality — parity
        -- with applyOperatorApprovalGrant, which requires goal equality on
        -- its act-bound branch too. An act hash alone is not sufficient
        -- proof the running action is the one the operator approved.
        AND (
          (st.act_content_hash IS NOT NULL AND st.act_content_hash = ${input.actHash} AND st.step_goal = ${input.declaredGoal})
          OR (st.act_content_hash IS NULL AND st.step_goal = ${input.declaredGoal})
        )
      ORDER BY st.seq ASC
      LIMIT 1
    )
      AND s.org_id = ${orgId}
      AND s.grant_used_at IS NULL
    RETURNING s.step_id, s.plan_id, s.seq, s.act_content_hash, s.preview_decision,
      (SELECT reviewed_by FROM plan_authorizations WHERE plan_id = s.plan_id AND org_id = s.org_id) AS reviewed_by,
      (SELECT COUNT(*)::int FROM plan_authorization_steps WHERE plan_id = s.plan_id AND org_id = s.org_id) AS total_steps
  `;
  return (rows[0] as {
    step_id: string; plan_id: string; seq: number; reviewed_by: string | null;
    act_content_hash: string | null; preview_decision: string | null; total_steps: number;
  } | undefined) ?? null;
}

/**
 * Deny-grant lookup (read-only; denied steps raise on EVERY match until the
 * plan TTL — they are not consumed). Same matching rule as consumption,
 * EXCEPT scoping: no agent_id predicate. agent_id is self-asserted at guard
 * time (absent a verified JWT), so scoping a denial lookup to it would let
 * the denied agent evade the "no" simply by resuming under a different
 * asserted name. A denial binds the ACT for the whole org, not one claimed
 * identity — over-matching a denial (raising for more callers than strictly
 * necessary) is the safe direction; under-matching (letting a denied act
 * back through) is not. consumePlanStepGrant keeps its agent_id scoping —
 * grants must fail safe by under-matching, the opposite asymmetry.
 * This lookup runs once per guard evaluation (any non-block decision), so it
 * must stay a single indexed probe.
 */
export async function findDeniedStepMatch(
  sql: SqlClient,
  orgId: string,
  input: { actionType: string; declaredGoal: string; actHash: string | null },
) {
  const rows = await sql`
    SELECT st.step_id, st.plan_id, p.reviewed_by
    FROM plan_authorization_steps st
    JOIN plan_authorizations p ON p.plan_id = st.plan_id AND p.org_id = st.org_id
    WHERE st.org_id = ${orgId}
      AND st.action_type = ${input.actionType}
      -- 'revoked' stays in this list as belt-and-braces, but it no longer
      -- does the real work: reviewPlan's revoke branch also sets
      -- expires_at = now(), so a revoked plan's explicit step denials are
      -- excluded by the p.expires_at > now() check below the same instant
      -- its unconsumed grants are excluded from consumePlanStepGrant.
      -- Revoke ends everything about the plan immediately; an operator who
      -- wants denials to persist keeps the plan un-revoked instead.
      AND p.status IN ('approved', 'partially_approved', 'denied', 'revoked')
      AND p.expires_at > now()
      AND st.grant_status = 'denied'
      -- Semantically a no-op (denied steps are never consumed — consumption
      -- requires grant_status='approved') but it lets the planner prove the
      -- partial-index predicate, so this per-guard-call probe rides
      -- idx_plan_authorization_steps_consume instead of scanning the table.
      AND st.grant_used_at IS NULL
      -- S1b: denials are fail-closed — a denied step matches on EITHER its
      -- act hash or its goal, so mutating the act cannot evade an operator's
      -- "no". (A strict-AND-per-branch match, as consumePlanStepGrant uses,
      -- is fail-open here: an attacker could tweak the act to change its
      -- hash and slip past a denial while keeping the same declared goal.)
      -- NULL act_content_hash never equals a non-null actHash in SQL, so a
      -- hashless step naturally falls through to the goal branch. Grants
      -- (consumePlanStepGrant) keep the strict match — only denials need to
      -- be fail-closed.
      AND (st.act_content_hash = ${input.actHash} OR st.step_goal = ${input.declaredGoal})
    ORDER BY st.seq ASC
    LIMIT 1
  `;
  return (rows[0] as { step_id: string; plan_id: string; reviewed_by: string | null } | undefined) ?? null;
}

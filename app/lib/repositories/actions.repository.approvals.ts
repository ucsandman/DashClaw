import { buildPromotionGoal } from '../guard/containment';
import { invalidateGuardPolicyCache } from '../guard';
import type { Row, SqlClient } from './actions.repository.shared';

// ── Approvals lifecycle hygiene (roadmap v2.3, drizzle/0039) ────────────────
// A pending_approval row is only approvable while the requesting client can
// still act on the outcome. Clients declare their wait window at request time
// (approval_wait_seconds); the stamp adds a retry grace that mirrors
// OPERATOR_APPROVAL_WINDOW_MINUTES in guard.ts, so "operator approves after
// the hook timed out, agent retries the identical call" keeps working.
export const APPROVAL_RETRY_GRACE_SECONDS = 15 * 60;
// Conservative default for clients that don't declare a window — matches the
// widest shipped client default (MCP/SDK waitForApproval: 300s).
export const DEFAULT_APPROVAL_WAIT_SECONDS = 300;
const APPROVAL_WAIT_MIN_SECONDS = 5;
const APPROVAL_WAIT_MAX_SECONDS = 86_400;
// Legacy rows (created before drizzle/0039) have no expiry stamp; the sweep
// treats them as expired 24h after creation, clearing the historical backlog.
const LEGACY_APPROVAL_TTL_HOURS = 24;

export const APPROVAL_EXPIRED_ERROR =
  'Approval expired: the requesting client stopped waiting before a decision was made';

/** ISO expiry stamp for a new pending_approval row. */
export function computeApprovalExpiry(waitSeconds?: unknown, nowMs: number = Date.now()): string {
  const parsed = Number(waitSeconds);
  const wait = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.round(parsed), APPROVAL_WAIT_MIN_SECONDS), APPROVAL_WAIT_MAX_SECONDS)
    : DEFAULT_APPROVAL_WAIT_SECONDS;
  return new Date(nowMs + (wait + APPROVAL_RETRY_GRACE_SECONDS) * 1000).toISOString();
}

/** JS-side overdue check (rows read before flipping — keeps hot reads free). */
export function isApprovalOverdue(
  row: { approval_expires_at?: unknown; created_at?: unknown },
  nowMs: number = Date.now(),
): boolean {
  const exp = row.approval_expires_at ? new Date(String(row.approval_expires_at)).getTime() : NaN;
  if (Number.isFinite(exp)) return exp < nowMs;
  const created = row.created_at ? new Date(String(row.created_at)).getTime() : NaN;
  return Number.isFinite(created) ? created < nowMs - LEGACY_APPROVAL_TTL_HOURS * 3_600_000 : false;
}

/**
 * Flip ONE overdue pending_approval row to expired. The WHERE clause re-checks
 * both the status and the overdue condition, so a concurrent approve/deny (or
 * a not-actually-overdue caller) safely returns null.
 */
export async function expireOverdueApproval(sql: SqlClient, orgId: string, actionId: string): Promise<Row | null> {
  const rows = await sql`
    UPDATE action_records
    SET status = 'expired',
        error_message = ${APPROVAL_EXPIRED_ERROR},
        updated_at = CURRENT_TIMESTAMP
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
      AND status = 'pending_approval'
      AND (approval_expires_at < NOW()
           OR (approval_expires_at IS NULL AND created_at < NOW() - make_interval(hours => ${LEGACY_APPROVAL_TTL_HOURS})))
    RETURNING *
  `;
  return rows[0] || null;
}

/**
 * Bounded lazy sweep: flip every overdue pending_approval row for the org.
 * Runs opportunistically where operators look at the queue (the
 * status=pending_approval list, the bulk-approval route) — no cron on the
 * free tier. The partial index idx_action_records_pending_expiry keeps this
 * a candidates-only scan.
 */
export async function sweepExpiredApprovals(sql: SqlClient, orgId: string, limit = 200): Promise<Row[]> {
  const cap = Math.min(Math.max(1, limit), 500);
  const rows = await sql`
    UPDATE action_records
    SET status = 'expired',
        error_message = ${APPROVAL_EXPIRED_ERROR},
        updated_at = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId}
      AND action_id IN (
        SELECT action_id FROM action_records
        WHERE org_id = ${orgId}
          AND status = 'pending_approval'
          AND (approval_expires_at < NOW()
               OR (approval_expires_at IS NULL AND created_at < NOW() - make_interval(hours => ${LEGACY_APPROVAL_TTL_HOURS})))
        LIMIT ${cap}
      )
      AND status = 'pending_approval'
    RETURNING action_id, agent_id, action_type
  `;
  return rows;
}

export async function hasAction(sql: SqlClient, orgId: string, actionId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId} LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Bare full action row (no relations). The containment route's re-issue path
 * uses this so every containment verdict response carries the same full-row
 * `action` shape resolveContainment's RETURNING * produces on the other paths.
 */
export async function getActionRecord(sql: SqlClient, orgId: string, actionId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT * FROM action_records
    WHERE action_id = ${actionId} AND org_id = ${orgId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getActionStatus(sql: SqlClient, orgId: string, actionId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT status, agent_id, model, action_type, approval_expires_at, created_at, created_by,
           containment_status, containment_ref
    FROM action_records
    WHERE action_id = ${actionId} AND org_id = ${orgId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getActionSummary(sql: SqlClient, orgId: string, actionId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT action_id, agent_id, action_type, declared_goal, risk_score, status
    FROM action_records
    WHERE action_id = ${actionId} AND org_id = ${orgId}
    LIMIT 1
  `;
  return rows[0] || null;
}

/** Calibration-feedback facts for a set of resolved approvals (bulk route). */
export async function listActionApprovalFacts(
  sql: SqlClient,
  orgId: string,
  actionIds: string[],
): Promise<Array<{ action_id: string; agent_id: string | null; risk_score: number }>> {
  if (actionIds.length === 0) return [];
  const rows = await sql.query(
    `SELECT action_id, agent_id, risk_score
     FROM action_records
     WHERE org_id = $1 AND action_id = ANY($2)`,
    [orgId, actionIds],
  );
  return rows.map((r: Row) => ({
    action_id: String(r.action_id ?? ''),
    agent_id: (r.agent_id as string | null) ?? null,
    risk_score: Number(r.risk_score) || 0,
  }));
}

interface RecordApprovalData {
  newStatus: string;
  errorMessage: string | null;
  decision: string;
  userId: string;
  safeReasoning?: string;
  [field: string]: unknown;
}

export async function recordApproval(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  data: RecordApprovalData,
): Promise<Row | null> {
  const { newStatus, errorMessage, decision, userId } = data;
  // safeReasoning is optional; an approval without reasoning must bind '' —
  // the self-host postgres.js driver rejects undefined params outright
  // (UNDEFINED_VALUE), while Neon's HTTP driver silently tolerates them.
  // Caught live by policy-smoke T1 in CI (2026-07-01).
  const safeReasoning = data.safeReasoning || '';

  const result = await sql`
    UPDATE action_records
    SET status = ${newStatus},
        error_message = ${errorMessage},
        approved_by = ${decision.toUpperCase() === 'ALLOW' ? userId : null},
        approved_at = ${decision.toUpperCase() === 'ALLOW' ? sql`CURRENT_TIMESTAMP` : null},
        reasoning = COALESCE(reasoning, '') || '

[HITL Decision: ' || ${decision.toUpperCase()} || ' by ' || ${userId} || ']' ||
                    CASE WHEN ${safeReasoning} != '' THEN '
Reason: ' || ${safeReasoning} ELSE '' END
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
      AND status = 'pending_approval'
      AND (approval_expires_at >= NOW()
           OR (approval_expires_at IS NULL AND created_at >= NOW() - interval '24 hours'))
      AND (${userId} = 'operator' OR created_by IS DISTINCT FROM ${userId})
    RETURNING *
  `;
  return result[0] || null;
}

// ── Containment Verdicts (RFC 2026-07-06, drizzle/0064) ─────────────────────
// Staged-effect lifecycle: contained -> awaiting_promotion -> promoted|discarded.
// Same WHERE-gate-as-legality-check pattern as recordApproval above: the
// prior-status condition in the WHERE clause IS the legality check — an
// illegal or racing transition simply returns no rows (null), never an error.

/**
 * Agent/hook-side flip: a contained action becomes awaiting_promotion once the
 * staged diff is ready for operator review.
 *
 * SECURITY (IMPORTANT 5, final fix wave 2026-07-27): `agentId` is the
 * caller's own resolved identity (verified JWT, or self-asserted body
 * agent_id — same identity contract every action-creating route uses) and is
 * part of the WHERE gate, same as org_id. Without it, any caller holding the
 * org's shared API key could race this flip on ANOTHER agent's action and
 * stamp an arbitrary ref onto it — the WHERE-gate-as-legality-check pattern
 * (like every other transition in this module) simply returns no rows for a
 * mismatched agent, indistinguishable from "not found", so this never leaks
 * whether a differently-owned action_id exists.
 *
 * SECURITY (server-stamped ref, security follow-up to RFC 2026-07-06): the
 * guard route stamps containment_ref at ?record=true time, so the row's
 * existing ref is authoritative — COALESCE(containment_ref, client) means a
 * client value can only FILL a missing ref (rows recorded before the stamp
 * existed), never overwrite one. A client ref that CONFLICTS with the stamp
 * fails the WHERE gate (no rows, null) instead of being silently ignored:
 * both implementations derive the ref from the same harness session id, so a
 * mismatch is version skew or a forged merge target, and skew only tightens.
 */
export async function setContainmentAwaiting(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  agentId: string,
  containmentRef?: string | null,
): Promise<Row | null> {
  const ref = containmentRef ?? null;
  const rows = await sql`
    UPDATE action_records
    SET containment_status = 'awaiting_promotion',
        containment_ref = COALESCE(containment_ref, ${ref})
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
      AND agent_id = ${agentId}
      AND containment_status = 'contained'
      AND (containment_ref IS NULL OR ${ref}::text IS NULL OR containment_ref = ${ref})
    RETURNING *
  `;
  return rows[0] || null;
}

/**
 * Enforcement visibility (F0, drizzle/0066): PostToolUse witnessed a gated
 * action execute anyway — the pretool verdict was block/require_approval but
 * the tool ran (observe mode, or a bypass). Single-statement WHERE gate: only
 * a row that IS gated (blocked / pending_approval) and not already stamped
 * takes the stamp, so a stray or replayed call cannot mark an ordinary allow
 * row as an enforcement failure. First writer wins; the stamp never clears.
 */
export async function stampExecutedDespite(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  verdict: 'block' | 'require_approval',
): Promise<Row | null> {
  const rows = await sql`
    UPDATE action_records
    SET executed_despite = ${verdict}
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
      AND status IN ('blocked', 'pending_approval')
      AND executed_despite IS NULL
    RETURNING *
  `;
  return rows[0] || null;
}

interface ResolveContainmentData {
  verdict: 'promote' | 'discard';
  resolvedBy: string;
}

/**
 * Operator-side flip: an awaiting_promotion action is resolved to promoted
 * (the staged diff lands) or discarded (thrown away). Admin-gated at the route.
 */
export async function resolveContainment(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  data: ResolveContainmentData,
): Promise<Row | null> {
  const { verdict, resolvedBy } = data;
  const next = verdict === 'promote' ? 'promoted' : 'discarded';
  const rows = await sql`
    UPDATE action_records
    SET containment_status = ${next},
        containment_resolved_by = ${resolvedBy},
        containment_resolved_at = CURRENT_TIMESTAMP
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
      AND containment_status = 'awaiting_promotion'
    RETURNING *
  `;
  return rows[0] || null;
}

/**
 * Stamp operator-approval fields on the synthetic `containment_promote` grant
 * row created by POST /api/actions/[actionId]/containment. createActionRecord
 * intentionally has no approved-fields insert path (never client-settable at
 * creation, drizzle/0055 precedent) — this is the dedicated post-insert stamp,
 * scoped by org_id + action_id like every other write in this module.
 */
export async function stampPromotionApproval(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  userId: string,
): Promise<Row | null> {
  const rows = await sql`
    UPDATE action_records
    SET approved_by = ${userId},
        approved_at = CURRENT_TIMESTAMP,
        approval_expires_at = CURRENT_TIMESTAMP + interval '15 minutes'
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] || null;
}

/**
 * Final fix-wave CRITICAL 1 (2026-07-27): the synthetic containment_promote
 * grant row minted by a promote verdict expires in 15 minutes and is
 * single-use — with no re-issue path, every promote-to-merge gap wider than
 * that window (or a merge conflict that already consumed the grant) leaves
 * the ledger stuck at `promoted` with nothing able to ever merge. Look up
 * whether an UNCONSUMED grant still exists for this contained action so the
 * route can re-stamp its approval window instead of minting a duplicate row.
 * Matches on the canonical declared_goal (buildPromotionGoal) the same way
 * the grant itself is built — action_type + goal is the tuple that
 * identifies "the promotion grant for THIS contained action", exactly as
 * applyOperatorApprovalGrant matches it during consumption.
 *
 * SECURITY fix-wave (2026-07-27, grant laundering): action_type + declared_goal
 * alone is a tuple any org API key can plant via POST /api/actions (a row with
 * an ARBITRARY act) — a later re-issue would find that planted row and
 * `stampPromotionApproval` would stamp a real operator signature onto an
 * attacker-chosen act. Narrow the lookup to rows THIS flow could actually have
 * minted: the same agent_id the contained action carries, the exact act
 * content hash `mintPromotionGrant` would have produced for this
 * containment_ref (computeActContentHash(buildPromotionAct(...))), and a row
 * that has already been through the create+stamp path (approved_by IS NOT
 * NULL) — a freshly planted row is never pre-approved. (POST /api/actions also
 * now rejects a client-supplied action_type of 'containment_promote' outright,
 * so this is defense in depth, not the only gate.)
 */
export async function findUnconsumedPromotionGrant(
  sql: SqlClient,
  orgId: string,
  containedActionId: string,
  agentId: string | null | undefined,
  actContentHash: string | null,
): Promise<Row | null> {
  const declaredGoal = buildPromotionGoal(containedActionId);
  const rows = await sql`
    SELECT * FROM action_records
    WHERE org_id = ${orgId}
      AND action_type = 'containment_promote'
      AND declared_goal = ${declaredGoal}
      AND agent_id IS NOT DISTINCT FROM ${agentId ?? null}
      AND act_content_hash IS NOT DISTINCT FROM ${actContentHash}
      AND approved_by IS NOT NULL
      AND approval_grant_used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

interface RecordBulkApprovalsData {
  newStatus: string;
  errorMessage: string | null;
  decision: string;
  userId: string;
  safeReasoning: string;
}

/**
 * Bulk variant of recordApproval: one UPDATE over many ids. The same
 * status='pending_approval' WHERE guard applies per row, so racing
 * resolutions are simply not returned (callers count them as failed).
 * Separation of duties (drizzle/0055): rows the approver's own principal
 * created are excluded the same way (reported as failed, never resolved);
 * the 'operator' root principal is exempt. Returns the action_ids resolved.
 */
export async function recordBulkApprovals(
  sql: SqlClient,
  orgId: string,
  actionIds: string[],
  data: RecordBulkApprovalsData,
): Promise<string[]> {
  if (!actionIds.length) return [];
  const { newStatus, errorMessage, decision, userId, safeReasoning } = data;
  const decisionUpper = decision.toUpperCase();
  const approvedBy = decisionUpper === 'ALLOW' ? userId : null;
  const reasoningAppend =
    `\n\n[HITL Decision: ${decisionUpper} by ${userId}]` +
    (safeReasoning ? `\nReason: ${safeReasoning}` : '');
  const rows = await sql.query(
    `UPDATE action_records
     SET status = $1,
         error_message = $2,
         approved_by = $3,
         approved_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE NULL END,
         reasoning = COALESCE(reasoning, '') || $5
     WHERE org_id = $6
       AND action_id = ANY($7)
       AND status = 'pending_approval'
       AND (approval_expires_at >= NOW()
            OR (approval_expires_at IS NULL AND created_at >= NOW() - interval '24 hours'))
       AND ($8 = 'operator' OR created_by IS DISTINCT FROM $8)
     RETURNING action_id`,
    [newStatus, errorMessage, approvedBy, decisionUpper === 'ALLOW', reasoningAppend, orgId, actionIds, userId],
  );
  return rows.map((r) => r.action_id as string);
}

/**
 * Pending approvals THIS policy actually caused, resolved through the guard
 * decision that held them (action_records.guard_decision_id ->
 * guard_decisions.matched_policies).
 *
 * Replaces matching by the policy's declared action_types, which was wrong in
 * both directions. Too narrow: a policy whose rules carry no action_types at
 * all — rate_limit, protected_path — yielded an empty set, so the approval-flood
 * banner's "Approve all" was a guaranteed 400 and the operator had no way to
 * clear the flood the banner existed to clear (field report 2026-08-11,
 * "[Claude Code Mode] Warn on action bursts"). Too broad: for a policy that DID
 * declare `action_types: ['api']`, it resolved every pending `api` approval in
 * the window — including ones a DIFFERENT policy was holding.
 *
 * matched_policies is JSON-array text; a plain quoted-substring test avoids a
 * ::jsonb cast that would throw on any legacy row holding non-JSON.
 */
export async function listPendingApprovalIdsByPolicy(
  sql: SqlClient,
  orgId: string,
  policyId: string,
  sinceIso: string,
  limit = 500,
): Promise<string[]> {
  if (!policyId) return [];
  const rows = await sql.query(
    `SELECT ar.action_id FROM action_records ar
     JOIN guard_decisions gd
       ON gd.id = ar.guard_decision_id AND gd.org_id = ar.org_id
     WHERE ar.org_id = $1 AND ar.status = 'pending_approval'
       AND ar.created_at::timestamptz >= $3::timestamptz
       AND (ar.approval_expires_at >= NOW()
            OR (ar.approval_expires_at IS NULL AND ar.created_at >= NOW() - interval '24 hours'))
       AND gd.matched_policies IS NOT NULL
       AND position('"' || $2 || '"' in gd.matched_policies) > 0
     ORDER BY ar.created_at ASC
     LIMIT $4`,
    [orgId, policyId, sinceIso, Math.min(Math.max(1, limit), 500)],
  );
  return (rows as Array<{ action_id: string }>).map((r) => r.action_id);
}

export interface PendingApprovalForGrant {
  action_id: string;
  action_type: string;
  risk_score: number;
  context: string | null;
  created_by: string | null;
  approval_expires_at: string | null;
}

function serializedContext(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * One action with everything the grant route needs to decide whether it may be
 * granted away: status, the risk score for the ceiling, the context the shape
 * is derived from, and the guard decision whose matched_policies carry the
 * ungrantable check. getActionSummary returns none of the last three.
 */
export async function getActionForGrant(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<{ action_id: string; action_type: string; status: string; risk_score: number; context: string | null; guard_decision_id: string | null; created_by: string | null; approval_expires_at: string | null; created_at: string | null } | null> {
  const rows = await sql`
    SELECT ar.action_id, ar.action_type, ar.status, ar.risk_score, gd.context,
           ar.guard_decision_id, ar.created_by, ar.approval_expires_at, ar.created_at
    FROM action_records ar
    LEFT JOIN guard_decisions gd
      ON gd.id = ar.guard_decision_id AND gd.org_id = ar.org_id
    WHERE ar.action_id = ${actionId} AND ar.org_id = ${orgId}
    LIMIT 1
  `;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    action_id: String(r.action_id),
    action_type: String(r.action_type ?? ''),
    status: String(r.status ?? ''),
    risk_score: Number(r.risk_score) || 0,
    context: serializedContext(r.context),
    guard_decision_id: r.guard_decision_id == null ? null : String(r.guard_decision_id),
    created_by: r.created_by == null ? null : String(r.created_by),
    approval_expires_at: r.approval_expires_at == null ? null : String(r.approval_expires_at),
    created_at: r.created_at == null ? null : String(r.created_at),
  };
}

/**
 * Pending approvals of one action_type, carrying the fields a grant needs to
 * decide coverage: the context (target + write_paths) and the risk score.
 *
 * Only action_type is filtered in SQL. Shape and ceiling matching happen in JS
 * through the SAME predicates the guard uses (grantMatches / grantCoversRisk),
 * so the queue can never claim to release something enforcement would have
 * re-interrupted a moment later. Re-implementing prefix semantics as a LIKE
 * here is exactly how the two would drift apart.
 *
 * Overdue rows are excluded on the same predicate as other approval reads: a
 * sweep must never "approve" an approval whose client already stopped waiting
 * (roadmap v2.3).
 */
export async function listPendingApprovalsForGrant(
  sql: SqlClient,
  orgId: string,
  actionType: string,
  limit = 200,
): Promise<{ rows: PendingApprovalForGrant[]; truncated: boolean }> {
  if (!actionType) return { rows: [], truncated: false };
  const cap = Math.min(Math.max(1, limit), 200);
  const rows = await sql.query(
    `SELECT ar.action_id, ar.action_type, ar.risk_score, gd.context,
            ar.created_by, ar.approval_expires_at, COUNT(*) OVER() AS total_candidates
     FROM action_records ar
     LEFT JOIN guard_decisions gd
       ON gd.id = ar.guard_decision_id AND gd.org_id = ar.org_id
     WHERE ar.org_id = $1 AND ar.status = 'pending_approval'
       AND ar.action_type = $2
       AND (ar.approval_expires_at >= NOW()
            OR (ar.approval_expires_at IS NULL AND ar.created_at >= NOW() - interval '24 hours'))
     ORDER BY ar.created_at ASC
     LIMIT $3`,
    [orgId, actionType, cap],
  );
  const mapped = (rows as Array<Record<string, unknown>>).map((r) => ({
    action_id: String(r.action_id),
    action_type: String(r.action_type),
    risk_score: Number(r.risk_score) || 0,
    context: serializedContext(r.context),
    created_by: r.created_by == null ? null : String(r.created_by),
    approval_expires_at: r.approval_expires_at == null ? null : String(r.approval_expires_at),
  }));
  const totalCandidates = Number((rows[0] as Record<string, unknown> | undefined)?.total_candidates);
  return { rows: mapped, truncated: Number.isFinite(totalCandidates) && totalCandidates > cap };
}

/** Atomically re-check source eligibility while persisting its standing grant. */
export async function createApprovalGrant(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  actorId: string,
  data: { id: string; name: string; rules: string },
): Promise<Row | null> {
  const rows = await sql`
    WITH eligible AS (
      SELECT 1 FROM action_records
      WHERE action_id = ${actionId}
        AND org_id = ${orgId}
        AND status = 'pending_approval'
        AND (approval_expires_at >= NOW()
             OR (approval_expires_at IS NULL AND created_at >= NOW() - interval '24 hours'))
        AND (${actorId} = 'operator' OR created_by IS DISTINCT FROM ${actorId})
    )
    INSERT INTO guard_policies
      (id, org_id, name, policy_type, rules, active, created_by, created_at, updated_at)
    SELECT ${data.id}, ${orgId}, ${data.name}, 'allow_grant', ${data.rules}, 1,
           ${actorId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM eligible
    ON CONFLICT (org_id, name) DO UPDATE
      SET rules = EXCLUDED.rules, active = 1, created_by = EXCLUDED.created_by,
          updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;
  if (rows[0]) invalidateGuardPolicyCache(orgId);
  return rows[0] || null;
}

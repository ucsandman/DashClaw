import { OUTCOME_FIELDS } from '../validate.js';
import { computeActContentHash } from '../act-content-hash';
import { buildAgentDefense, type AgentDefense } from '../agent-defense';
import { getGuardDecisionById } from './guardrails.repository';

type Row = Record<string, unknown>;

/**
 * SQL executor used by this repository. Supports the Neon/postgres tagged
 * template form AND the `.query(text, params)` form. The optional
 * `queryCalls` array is present only on the test-contract mock and gates the
 * compatibility paths below.
 */
type SqlClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
  queryCalls?: unknown[];
};

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

export async function getActionTimeBounds(sql: SqlClient, orgId: string, actionId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT agent_id, timestamp_start, timestamp_end
    FROM action_records
    WHERE org_id = ${orgId} AND action_id = ${actionId}
    LIMIT 1
  `;
  return rows[0] || null;
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
    RETURNING *
  `;
  return result[0] || null;
}

/**
 * Flip a just-created action to blocked when a post-insert re-check catches a
 * breach the pre-insert gate could not see (x402 budget TOCTOU close-out,
 * security review 2026-07-02). Preserves the audit trail — the row stays,
 * with the block reason recorded, instead of being compensation-deleted.
 */
export async function markActionBlocked(sql: SqlClient, orgId: string, actionId: string, reason: string): Promise<Row | null> {
  const result = await sql`
    UPDATE action_records
    SET status = 'blocked',
        error_message = ${reason}
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
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
 * staged diff is ready for operator review. The containment_ref (worktree
 * branch) can be (re)stamped on the same call; a null ref leaves it unchanged.
 */
export async function setContainmentAwaiting(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  containmentRef?: string | null,
): Promise<Row | null> {
  const rows = await sql`
    UPDATE action_records
    SET containment_status = 'awaiting_promotion',
        containment_ref = COALESCE(${containmentRef ?? null}, containment_ref)
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
      AND containment_status = 'contained'
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
 * Rows currently awaiting an operator promote/discard verdict, newest-first —
 * ordering matches listActions (timestamp_start DESC) so the /approvals
 * Containment section sorts consistently with every other list on the page.
 */
export async function listAwaitingPromotion(sql: SqlClient, orgId: string, limit: number | string = 50): Promise<Row[]> {
  const capped = Math.max(1, Math.min(Number(limit) || 50, 200));
  return sql`
    SELECT * FROM action_records
    WHERE org_id = ${orgId}
      AND containment_status = 'awaiting_promotion'
    ORDER BY timestamp_start DESC
    LIMIT ${capped}
  `;
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
       AND ($8 = 'operator' OR created_by IS DISTINCT FROM $8)
     RETURNING action_id`,
    [newStatus, errorMessage, approvedBy, decisionUpper === 'ALLOW', reasoningAppend, orgId, actionIds, userId],
  );
  return rows.map((r) => r.action_id as string);
}

interface ListActionsFilters {
  agent_id?: string;
  swarm_id?: string;
  status?: string;
  exclude_status?: string;
  action_type?: string;
  risk_min?: number | string;
  outcome_status?: string;
  /** Containment Verdicts (drizzle/0064): filters to a single lifecycle status. */
  containment_status?: string;
  /** Optional rolling window (1-365 days): scopes the list AND total/stats. */
  days?: number | string;
  /**
   * ISO cutoff for the expired-approvals view: only rows whose
   * approval_expires_at is strictly after this instant are listed. Backs the
   * /approvals "Clear expired" cursor; rows with a NULL expiry (legacy TTL
   * sweeps) are hidden once any cutoff is set.
   */
  expired_after?: string;
  limit?: number | string;
  offset?: number | string;
}

interface ParsedListActionsFilters {
  agent_id?: string;
  swarm_id?: string;
  status?: string;
  exclude_status?: string;
  action_type?: string;
  containment_status?: string;
  outcomeFilter: string | null;
  parsedRiskMin: number | null;
  /** ISO cutoff derived from `days` (null = no window). */
  sinceIso: string | null;
  /** Validated ISO cutoff from `expired_after` (null = no cursor). */
  expiredAfterIso: string | null;
  parsedLimit: number;
  parsedOffset: number;
}

interface ListActionSqlFragments {
  agent: ReturnType<SqlClient>;
  swarm: ReturnType<SqlClient>;
  status: ReturnType<SqlClient>;
  excludeStatus: ReturnType<SqlClient>;
  actionType: ReturnType<SqlClient>;
  riskMin: ReturnType<SqlClient>;
  outcome: ReturnType<SqlClient>;
  since: ReturnType<SqlClient>;
  expiredAfter: ReturnType<SqlClient>;
  containmentStatus: ReturnType<SqlClient>;
}

// Neon returns numeric aggregates (AVG/SUM) as strings; coerce the two stats
// the UI treats as numbers so callers receive numbers, not strings. COUNT-based
// fields are left as-is (callers parse them where needed).
function coerceActionStats(row: Row | undefined): Row {
  const s = row || {};
  return {
    ...s,
    avg_risk: Number(s.avg_risk) || 0,
    total_cost: Number(s.total_cost) || 0,
  };
}

function parseListActionsFilters(filters: ListActionsFilters): ParsedListActionsFilters {
  const {
    agent_id,
    swarm_id,
    status,
    exclude_status,
    action_type,
    risk_min,
    outcome_status,
    containment_status,
    days,
    expired_after,
    limit = 50,
    offset = 0,
  } = filters;
  const validOutcomes = new Set(['pending', 'completed', 'partial', 'failed', 'lost_confirmation']);
  // Rolling window: the cutoff is computed once here so the list, countQuery,
  // and statsQuery all scope identically (the windowed `total` is what makes
  // the activity narrative truthful — it is NOT a buffer length).
  const parsedDays = parseInt(days as string, 10);
  const clampedDays = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 365) : null;
  const expiredAfterMs = expired_after ? Date.parse(expired_after) : NaN;
  return {
    agent_id,
    swarm_id,
    status,
    exclude_status,
    action_type,
    containment_status,
    outcomeFilter: validOutcomes.has(outcome_status as string) ? (outcome_status as string) : null,
    parsedRiskMin: Number.isFinite(Number(risk_min)) ? Number(risk_min) : null,
    sinceIso: clampedDays != null ? new Date(Date.now() - clampedDays * 86_400_000).toISOString() : null,
    expiredAfterIso: Number.isFinite(expiredAfterMs) ? new Date(expiredAfterMs).toISOString() : null,
    parsedLimit: Math.min(parseInt(limit as string, 10) || 50, 200),
    parsedOffset: parseInt(offset as string, 10) || 0,
  };
}

function addQueryCondition(
  conditions: string[],
  params: unknown[],
  condition: string,
  value: unknown,
): void {
  conditions.push(`${condition} $${params.push(value)}`);
}

interface QueryConditionSpec {
  active: boolean;
  condition: string;
  value: unknown;
}

function buildListActionsQueryParts(orgId: string, filters: ParsedListActionsFilters) {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  for (const spec of listActionQuerySpecs(filters)) {
    if (spec.active) addQueryCondition(conditions, params, spec.condition, spec.value);
  }

  return { conditions, params, where: `WHERE ${conditions.join(' AND ')}` };
}

function listActionQuerySpecs(filters: ParsedListActionsFilters): QueryConditionSpec[] {
  return [
    { active: !!filters.agent_id, condition: 'agent_id =', value: filters.agent_id },
    { active: !!filters.swarm_id, condition: 'swarm_id =', value: filters.swarm_id },
    { active: !!filters.status, condition: 'status =', value: filters.status },
    { active: !!filters.exclude_status && !filters.status, condition: 'status !=', value: filters.exclude_status },
    { active: !!filters.action_type, condition: 'action_type =', value: filters.action_type },
    { active: filters.parsedRiskMin != null, condition: 'risk_score >=', value: filters.parsedRiskMin },
    { active: !!filters.outcomeFilter, condition: 'outcome_status =', value: filters.outcomeFilter },
    { active: !!filters.containment_status, condition: 'containment_status =', value: filters.containment_status },
    { active: filters.sinceIso != null, condition: 'created_at::timestamptz >=', value: filters.sinceIso },
    { active: filters.expiredAfterIso != null, condition: 'approval_expires_at::timestamptz >', value: filters.expiredAfterIso },
  ];
}

async function listActionsViaQueryMock(
  sql: SqlClient,
  orgId: string,
  filters: ParsedListActionsFilters,
): Promise<{ actions: Row[]; total: number; stats: Row }> {
  const { conditions, params, where } = buildListActionsQueryParts(orgId, filters);
  const listCols = 'action_id, agent_id, agent_name, swarm_id, action_type, declared_goal, reasoning, authorization_scope, systems_touched, status, reversible, risk_score, confidence, model, output_summary, error_message, side_effects, artifacts_created, duration_ms, cost_estimate, timestamp_start, timestamp_end, created_at, verified, approved_by, approved_at, outcome_status, outcome_at, outcome_summary, outcome_error';
  const query = `SELECT ${listCols} FROM action_records ${where} ORDER BY timestamp_start DESC LIMIT $${params.push(filters.parsedLimit)} OFFSET $${params.push(filters.parsedOffset)}`;
  const countQuery = `SELECT COUNT(*) as total FROM action_records ${where}`;
  const statsQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'blocked') as blocked,
        COUNT(*) FILTER (WHERE risk_score >= 70) as high_risk,
        COALESCE(AVG(risk_score), 0) as avg_risk,
        COALESCE(SUM(cost_estimate), 0) as total_cost
      FROM action_records ${where}
    `;

  const [actions, countResult, stats] = await Promise.all([
    sql.query(query, params),
    sql.query(countQuery, params.slice(0, conditions.length)),
    sql.query(statsQuery, params.slice(0, conditions.length)),
  ]);

  return {
    actions,
    total: parseInt((countResult[0]?.total as string) || '0', 10),
    stats: coerceActionStats(stats[0]),
  };
}

function listActionSqlFragments(
  sql: SqlClient,
  filters: ParsedListActionsFilters,
): ListActionSqlFragments {
  return {
    agent: sqlFragment(sql, !!filters.agent_id, () => sql`AND agent_id = ${filters.agent_id}`),
    swarm: sqlFragment(sql, !!filters.swarm_id, () => sql`AND swarm_id = ${filters.swarm_id}`),
    status: sqlFragment(sql, !!filters.status, () => sql`AND status = ${filters.status}`),
    excludeStatus: sqlFragment(sql, !!filters.exclude_status && !filters.status, () => sql`AND status != ${filters.exclude_status}`),
    actionType: sqlFragment(sql, !!filters.action_type, () => sql`AND action_type = ${filters.action_type}`),
    riskMin: sqlFragment(sql, filters.parsedRiskMin != null, () => sql`AND risk_score >= ${filters.parsedRiskMin}`),
    outcome: sqlFragment(sql, !!filters.outcomeFilter, () => sql`AND outcome_status = ${filters.outcomeFilter}`),
    containmentStatus: sqlFragment(sql, !!filters.containment_status, () => sql`AND containment_status = ${filters.containment_status}`),
    since: sqlFragment(sql, filters.sinceIso != null, () => sql`AND created_at::timestamptz >= ${filters.sinceIso}`),
    expiredAfter: sqlFragment(sql, filters.expiredAfterIso != null, () => sql`AND approval_expires_at::timestamptz > ${filters.expiredAfterIso}`),
  };
}

function sqlFragment(
  sql: SqlClient,
  active: boolean,
  build: () => ReturnType<SqlClient>,
): ReturnType<SqlClient> {
  return active ? build() : sql``;
}

async function listActionsViaTaggedSql(
  sql: SqlClient,
  orgId: string,
  filters: ParsedListActionsFilters,
): Promise<{ actions: Row[]; total: number; stats: Row }> {
  const fragments = listActionSqlFragments(sql, filters);
  const where = listActionsWhere(sql, orgId, fragments);
  const [actions, countResult, stats] = await Promise.all([
    sql`
      SELECT
        action_id, agent_id, agent_name, swarm_id, action_type, declared_goal, reasoning, authorization_scope, systems_touched, status, reversible, risk_score, confidence, model, output_summary, error_message, side_effects, artifacts_created, duration_ms, cost_estimate, timestamp_start, timestamp_end, created_at, verified, approved_by, approved_at, outcome_status, outcome_at, outcome_summary, outcome_error, approval_expires_at, act_content_hash
      FROM action_records
      ${where}
      ORDER BY timestamp_start DESC
      LIMIT ${filters.parsedLimit}
      OFFSET ${filters.parsedOffset}
    `,
    sql`
      SELECT COUNT(*) as total
      FROM action_records
      ${where}
    `,
    sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'blocked') as blocked,
        COUNT(*) FILTER (WHERE risk_score >= 70) as high_risk,
        COALESCE(AVG(risk_score), 0) as avg_risk,
        COALESCE(SUM(cost_estimate), 0) as total_cost
      FROM action_records
      ${where}
    `,
  ]);

  return {
    actions,
    total: parseInt((countResult[0]?.total as string) || '0', 10),
    stats: coerceActionStats(stats[0]),
  };
}

function listActionsWhere(
  sql: SqlClient,
  orgId: string,
  fragments: ListActionSqlFragments,
): ReturnType<SqlClient> {
  return sql`
      WHERE org_id = ${orgId}
        ${fragments.agent}
        ${fragments.swarm}
        ${fragments.status}
        ${fragments.excludeStatus}
        ${fragments.actionType}
        ${fragments.riskMin}
        ${fragments.outcome}
        ${fragments.containmentStatus}
        ${fragments.since}
        ${fragments.expiredAfter}
    `;
}

function clampRiskScore(value: unknown): number {
  return Math.max(0, Math.min(Math.round(Number(value) || 0), 100));
}

// Phantom-zero fix: when neither the client nor a guard decision supplied a
// risk score, persist NULL — not 0. A defaulted 0 used to count as a genuine
// "risk 0" reputation event and deflate swarm AVG(risk_score) as low-risk
// reads piled up, making per-agent risk drift incoherently.
function persistedRiskScore(
  riskScore: unknown,
  fallback: unknown,
  finalFallback: unknown = null,
): unknown {
  if (riskScore != null) return clampRiskScore(riskScore);
  return fallback != null ? fallback : finalFallback;
}

function boolFlag(value: unknown, defaultValue = 0): number {
  if (value === undefined) return defaultValue;
  return value ? 1 : 0;
}

function jsonArrayValue(value: unknown): string {
  return JSON.stringify(value || []);
}

function blockedReasonFromDecision(guardDecision: GuardDecision | null | undefined): string {
  return guardDecision?.reason
    || guardDecision?.reasons?.join('; ')
    || 'Action blocked by policy';
}

function blockedErrorMessage(blockedReason: string, matchedPolicies: string[]): string {
  return 'Blocked by policy: ' + blockedReason + (matchedPolicies.length > 0 ? ' [Policies: ' + matchedPolicies.join(', ') + ']' : '');
}

function orNull<T>(value: T | null | undefined): T | null {
  return value || null;
}

// Fleet attribution (drizzle/0049, v4.3): harness_session_id / subagent_uuid
// are free-form client-supplied ids — accept a string ≤ 200 chars, else NULL.
function boundedIdText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

function orDefault<T>(value: T | null | undefined, fallback: T): T {
  return value || fallback;
}

export async function listActions(
  sql: SqlClient,
  orgId: string,
  filters: ListActionsFilters = {},
): Promise<{ actions: Row[]; total: number; stats: Row }> {
  const parsed = parseListActionsFilters(filters);
  // Test-contract compatibility path for sql mocks that only provide .query() responses.
  if (typeof sql.query === 'function' && Array.isArray(sql.queryCalls)) {
    return listActionsViaQueryMock(sql, orgId, parsed);
  }

  return listActionsViaTaggedSql(sql, orgId, parsed);
}

export async function hasAgentAction(sql: SqlClient, orgId: string, agentId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM action_records WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Returns true if the given action_id is the first action_record ever
 * created for this org — used by the launch-window new-connect alert
 * (Plan 03-02, DOG-04 telemetry). "First" = no OTHER action_record
 * exists for this org besides the one being created.
 */
export async function isFirstActionForOrg(
  sql: SqlClient,
  orgId: string,
  excludingActionId: string,
): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM action_records
    WHERE org_id = ${orgId}
      AND action_id != ${excludingActionId}
    LIMIT 1
  `;
  return rows.length === 0;
}

/**
 * Look up an existing action by idempotency key for this org.
 * Returns the row if found, null otherwise. Used by POST /api/actions
 * to short-circuit duplicate create calls.
 */
export async function getActionByIdempotencyKey(
  sql: SqlClient,
  orgId: string,
  idempotencyKey: string | null | undefined,
): Promise<Row | null> {
  if (!idempotencyKey) return null;
  const rows = await sql`
    SELECT * FROM action_records
    WHERE org_id = ${orgId} AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return rows[0] || null;
}

interface ActionData {
  agent_id?: string | null;
  agent_name?: string | null;
  swarm_id?: string | null;
  parent_action_id?: string | null;
  action_type?: string;
  declared_goal?: string | null;
  reasoning?: string | null;
  authorization_scope?: string | null;
  trigger?: string | null;
  systems_touched?: unknown;
  input_summary?: string | null;
  reversible?: boolean | number;
  risk_score?: number;
  confidence?: number;
  recommendation_id?: string | null;
  recommendation_applied?: boolean | number;
  recommendation_override_reason?: string | null;
  output_summary?: string | null;
  side_effects?: unknown;
  artifacts_created?: unknown;
  error_message?: string | null;
  timestamp_end?: string | null;
  duration_ms?: number | null;
  tokens_in?: number;
  tokens_out?: number;
  model?: string | null;
  idempotency_key?: string | null;
  session_id?: string | null;
  guard_decision_id?: string | null;
  // Fleet attribution (drizzle/0049, v4.3): harness session uuid (stamped on
  // every record) + subagent instance uuid (leaf lineage evidence). Bounded to
  // ≤ 200 chars server-side; anything else persists NULL.
  harness_session_id?: string | null;
  subagent_uuid?: string | null;
  // Approvals lifecycle (drizzle/0039): how long the client will poll for an
  // approval decision. Only read when the row is created as pending_approval.
  approval_wait_seconds?: number | null;
  // Containment Verdicts (drizzle/0064): stamped 'contained' when guard emits
  // allow_contained via ?record=true. NULL for every other action.
  containment_status?: string | null;
  [field: string]: unknown;
}

interface CreateActionPayload {
  orgId: string;
  action_id: string;
  data: ActionData;
  actionStatus: string;
  costEstimate?: number | null;
  signature: unknown;
  verified: unknown;
  timestamp_start: string;
  riskScore?: number | null;
  // Middleware-attributed principal (x-user-id) of the CREATING request —
  // never from the client body. Approvals reject approver === created_by
  // (separation of duties, drizzle/0055); NULL = system/legacy, unenforced.
  createdBy?: string | null;
}

function createActionInsertValues(payload: CreateActionPayload) {
  const { data, riskScore, costEstimate, signature, verified, timestamp_start } = payload;
  return {
    agent_id: data.agent_id,
    agent_name: orNull(data.agent_name),
    swarm_id: orNull(data.swarm_id),
    parent_action_id: orNull(data.parent_action_id),
    action_type: data.action_type,
    declared_goal: data.declared_goal,
    reasoning: orNull(data.reasoning),
    authorization_scope: orNull(data.authorization_scope),
    trigger: orNull(data.trigger),
    systems_touched: jsonArrayValue(data.systems_touched),
    input_summary: orNull(data.input_summary),
    reversible: boolFlag(data.reversible, 1),
    risk_score: persistedRiskScore(riskScore, data.risk_score),
    confidence: orDefault(data.confidence, 50),
    recommendation_id: orNull(data.recommendation_id),
    recommendation_applied: boolFlag(data.recommendation_applied),
    recommendation_override_reason: orNull(data.recommendation_override_reason),
    output_summary: orNull(data.output_summary),
    side_effects: jsonArrayValue(data.side_effects),
    artifacts_created: jsonArrayValue(data.artifacts_created),
    error_message: orNull(data.error_message),
    timestamp_start,
    timestamp_end: orNull(data.timestamp_end),
    duration_ms: orNull(data.duration_ms),
    cost_estimate: costEstimate,
    tokens_in: orDefault(data.tokens_in, 0),
    tokens_out: orDefault(data.tokens_out, 0),
    model: orNull(data.model),
    signature,
    verified,
    idempotency_key: orNull(data.idempotency_key),
    session_id: orNull(data.session_id),
    guard_decision_id: orNull(data.guard_decision_id),
    // Containment Verdicts (drizzle/0064): passthrough only — the guard route
    // is the sole writer (via ?record=true), never client-set on POST /api/actions.
    containment_status: orNull(data.containment_status),
    harness_session_id: boundedIdText(data.harness_session_id),
    subagent_uuid: boundedIdText(data.subagent_uuid),
    // Act-content grant binding (drizzle/0056): server-computed from the act
    // payload the client sent (never a client-supplied hash), so the
    // operator-approval grant can bind a retry to the exact approved act.
    // NULL when no act was supplied — the grant keeps the tuple match.
    act_content_hash: computeActContentHash(data.act),
    created_by: orNull(payload.createdBy),
  };
}

// Lifecycle statuses a row can be created in that are NOT yet terminal. Any
// other create status means the row was born already closed (MCP
// dashclaw_record, POST with a terminal status, or createBlockedActionRecord),
// so close_source is stamped 'direct' — the row never transitioned through a
// PATCH/outcome close. See drizzle/0048 (v4.2 coverage truth).
const NON_TERMINAL_CREATE_STATUSES = new Set(['running', 'pending', 'pending_approval']);

export async function createActionRecord(sql: SqlClient, payload: CreateActionPayload): Promise<Row | null> {
  const {
    orgId,
    action_id,
    actionStatus,
  } = payload;
  const values = createActionInsertValues(payload);
  // Approvals lifecycle (drizzle/0039): only pending rows expire; every other
  // status leaves the stamp NULL.
  const approvalExpiresAt = actionStatus === 'pending_approval'
    ? computeApprovalExpiry(payload.data?.approval_wait_seconds)
    : null;
  // Closure provenance (drizzle/0048): a row born terminal is a 'direct' close.
  const closeSource = NON_TERMINAL_CREATE_STATUSES.has(actionStatus) ? null : 'direct';

  const rows = await sql`
    INSERT INTO action_records (
      org_id, action_id, agent_id, agent_name, swarm_id, parent_action_id,
      action_type, declared_goal, reasoning, authorization_scope,
      trigger, systems_touched, input_summary,
      status, reversible, risk_score, confidence,
      recommendation_id, recommendation_applied, recommendation_override_reason,
      output_summary, side_effects, artifacts_created, error_message,
      timestamp_start, timestamp_end, duration_ms, cost_estimate,
      tokens_in, tokens_out, model,
      signature, verified, idempotency_key, session_id, guard_decision_id,
      containment_status,
      act_content_hash, created_by, harness_session_id, subagent_uuid,
      close_source, approval_expires_at
    ) VALUES (
      ${orgId},
      ${action_id},
      ${values.agent_id},
      ${values.agent_name},
      ${values.swarm_id},
      ${values.parent_action_id},
      ${values.action_type},
      ${values.declared_goal},
      ${values.reasoning},
      ${values.authorization_scope},
      ${values.trigger},
      ${values.systems_touched},
      ${values.input_summary},
      ${actionStatus},
      ${values.reversible},
      ${values.risk_score},
      ${values.confidence},
      ${values.recommendation_id},
      ${values.recommendation_applied},
      ${values.recommendation_override_reason},
      ${values.output_summary},
      ${values.side_effects},
      ${values.artifacts_created},
      ${values.error_message},
      ${values.timestamp_start},
      ${values.timestamp_end},
      ${values.duration_ms},
      ${values.cost_estimate},
      ${values.tokens_in},
      ${values.tokens_out},
      ${values.model},
      ${values.signature},
      ${values.verified},
      ${values.idempotency_key},
      ${values.session_id},
      ${values.guard_decision_id},
      ${values.containment_status},
      ${values.act_content_hash},
      ${values.created_by},
      ${values.harness_session_id},
      ${values.subagent_uuid},
      ${closeSource},
      ${approvalExpiresAt}
    )
    RETURNING *
  `;

  return rows[0] || null;
}

interface GuardDecision {
  reason?: string | null;
  reasons?: string[];
  matched_policies?: string[];
  risk_score?: number;
  [field: string]: unknown;
}

interface CreateBlockedActionPayload {
  orgId: string;
  action_id: string;
  data: ActionData;
  guardDecision?: GuardDecision | null;
  signature: unknown;
  verified: unknown;
  timestamp_start: string;
  riskScore?: number | null;
}

function blockedActionErrorFromPayload(payload: CreateBlockedActionPayload): string {
  const { guardDecision } = payload;
  const blockedReason = blockedReasonFromDecision(guardDecision);
  const matchedPolicies = guardDecision?.matched_policies || [];
  return blockedErrorMessage(blockedReason, matchedPolicies);
}

/**
 * Create a blocked action record for governance visibility.
 * Blocked actions are persisted to ensure they appear in the Decisions Ledger
 * and contribute to agent discovery, even though the action was not executed.
 */
export async function createBlockedActionRecord(
  sql: SqlClient,
  payload: CreateBlockedActionPayload,
): Promise<Row | null> {
  const {
    orgId,
    action_id,
    data,
    guardDecision,
    signature,
    verified,
    timestamp_start,
    riskScore,
  } = payload;
  const errorMessage = blockedActionErrorFromPayload(payload);
  return createActionRecord(sql, {
    orgId,
    action_id,
    data: {
      ...data,
      output_summary: null,
      side_effects: [],
      artifacts_created: [],
      error_message: errorMessage,
      timestamp_end: timestamp_start,
      duration_ms: 0,
      tokens_in: data.tokens_in,
      tokens_out: data.tokens_out,
    },
    actionStatus: 'blocked',
    costEstimate: 0,
    signature,
    verified,
    timestamp_start,
    riskScore: persistedRiskScore(
      riskScore,
      guardDecision?.risk_score != null ? clampRiskScore(guardDecision.risk_score) : null,
      data.risk_score || 0,
    ) as number,
  });
}

interface ActionWithRelations {
  action: Row;
  assumptions: Row[];
  message_summary: {
    total: number;
    participants: string[];
    first_message_at: unknown;
    last_message_at: unknown;
  };
  guard_decision: Row | null;
  agent_defense: AgentDefense;
}

// guard_decisions stores JSON as text; parse the payload columns for the
// response so UI/SDK consumers don't re-implement defensive parsing.
function parseJsonColumn(value: unknown): unknown {
  if (value == null || typeof value === 'object') return value ?? null;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

export async function getActionWithRelations(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<ActionWithRelations | null> {
  const [actions, assumptions, msgSummaryRows] = await Promise.all([
    sql`SELECT * FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId}`,
    sql`SELECT * FROM assumptions WHERE action_id = ${actionId} AND org_id = ${orgId} ORDER BY created_at DESC`,
    sql`SELECT COUNT(*)::int AS total,
        COALESCE(STRING_AGG(DISTINCT from_agent_id, ',') || CASE WHEN STRING_AGG(DISTINCT to_agent_id, ',') IS NOT NULL THEN ',' || STRING_AGG(DISTINCT to_agent_id, ',') ELSE '' END, '') AS participants,
        MIN(created_at) AS first_message_at,
        MAX(created_at) AS last_message_at
      FROM agent_messages WHERE org_id = ${orgId} AND action_id = ${actionId}`,
  ]);

  if (actions.length === 0) return null;

  const msgRaw = msgSummaryRows[0] || { total: 0, participants: '', first_message_at: null, last_message_at: null };
  const msgTotal = parseInt(msgRaw.total as string, 10) || 0;

  const action = actions[0];
  if (!action) return null;

  // Agent's-advocate rollup: join the guard decision by the exact FK stamped
  // at write time (never the legacy action_type+timestamp heuristic). Only
  // queried when the link exists; absence renders as linked:false.
  let guardDecision: Row | null = null;
  if (typeof action.guard_decision_id === 'string' && action.guard_decision_id) {
    guardDecision = await getGuardDecisionById(sql, orgId, action.guard_decision_id);
  }

  return {
    action,
    assumptions,
    guard_decision: guardDecision
      ? (() => {
          const context = parseJsonColumn(guardDecision.context) as Record<string, unknown> | null;
          return {
            ...guardDecision,
            matched_policies: parseJsonColumn(guardDecision.matched_policies),
            context,
            evidence: parseJsonColumn(guardDecision.evidence),
            // Lifted in JS, not SQL: guard_decisions.context is a TEXT column,
            // so `context->'_risk_breakdown'` fails (text -> unknown), and a
            // ::jsonb cast 500s on contexts with literal backslash-u0000 escapes.
            risk_breakdown: context?._risk_breakdown ?? null,
          };
        })()
      : null,
    agent_defense: buildAgentDefense(action, guardDecision, assumptions),
    message_summary: {
      total: msgTotal,
      participants: msgRaw.participants ? [...new Set((msgRaw.participants as string).split(',').filter(Boolean))] : [],
      first_message_at: msgRaw.first_message_at || null,
      last_message_at: msgRaw.last_message_at || null,
    },
  };
}

interface UpdateActionOutcomeOptions {
  gateStatus?: string | null;
  /**
   * Closure provenance to stamp (drizzle/0048, v4.2). Only the caller's close
   * write passes this — 'stop_autoclose' when a close_if_running PATCH wins the
   * close, 'outcome' for a normal completion PATCH. The stamp lands ONLY when
   * this write actually transitions the row to a terminal status (the
   * gateStatus:'running' gate already guarantees the row was open), so a late
   * token/cost update never rewrites the provenance.
   */
  closeSource?: string | null;
  /**
   * Fleet attribution (v4.3, drizzle/0049): the spawned subagent instance uuid
   * the posttool extracts from an Agent/Task tool_response and sends as
   * outcome_metadata.spawned_agent_uuid. Persisted selectively — merged as the
   * single key {"spawned_agent_uuid": ...} into the row's outcome_progress
   * jsonb; every other outcome_metadata key stays dropped. Deliberately NOT
   * gated on the row still being 'running': a sync spawn's patch lands at spawn
   * completion (often after Stop auto-closed the spawn row), and the lineage
   * stamp must land regardless — it is not a close field. Sanitized to a
   * string ≤ 200 chars, else ignored.
   */
  spawnedAgentUuid?: string | null;
}

// Statuses a close write may set. close_source is stamped only when the new
// status is one of these AND a closeSource intent was supplied.
const TERMINAL_CLOSE_STATUSES = ['completed', 'failed', 'cancelled', 'blocked', 'partial'];

interface NormalizedOutcomePatch {
  data: Record<string, unknown>;
  fields: string[];
}

function normalizeOutcomePatch(outcome: Record<string, unknown>): NormalizedOutcomePatch {
  const data: Record<string, unknown> = { ...outcome };
  if (data.side_effects !== undefined) data.side_effects = JSON.stringify(data.side_effects);
  if (data.artifacts_created !== undefined) data.artifacts_created = JSON.stringify(data.artifacts_created);
  return {
    data,
    fields: Object.keys(data).filter(k => OUTCOME_FIELDS.includes(k)),
  };
}

function appendImplicitOutcomeClauses(setClauses: string[], fields: string[]): void {
  const statusIndex = fields.indexOf('status');
  if (statusIndex === -1) return;
  const statusParam = `$${statusIndex + 1}`;
  setClauses.push(
    `outcome_status = CASE
          WHEN outcome_status = 'pending' AND ${statusParam} = 'completed' THEN 'completed'
          WHEN outcome_status = 'pending' AND ${statusParam} IN ('failed', 'cancelled', 'blocked') THEN 'failed'
          ELSE outcome_status
        END`
  );
  setClauses.push(
    `outcome_at = CASE
          WHEN outcome_status = 'pending' AND ${statusParam} IN ('completed', 'failed', 'cancelled', 'blocked') THEN NOW()
          ELSE outcome_at
        END`
  );
}

async function updateActionOutcomeViaQueryMock(
  ctx: {
    sql: SqlClient;
    orgId: string;
    actionId: string;
    patch: NormalizedOutcomePatch;
    gateStatus: string | null | undefined;
  },
): Promise<Row | null> {
  const { sql, orgId, actionId, patch, gateStatus } = ctx;
  const { data, fields } = patch;
  const setClauses = fields.map((f, i) => `${f} = $${i + 1}`);
  const values = fields.map(f => data[f]);
  appendImplicitOutcomeClauses(setClauses, fields);
  const baseWhere = `WHERE action_id = $${fields.length + 1} AND org_id = $${fields.length + 2}`;
  const gateWhere = gateStatus ? ` AND status = $${fields.length + 3}` : '';
  const query = `UPDATE action_records SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP ${baseWhere}${gateWhere} RETURNING *`;
  const queryParams = gateStatus ? [...values, actionId, orgId, gateStatus] : [...values, actionId, orgId];
  const updated = await sql.query(query, queryParams);
  return updated[0] || null;
}

function outcomeValue(
  data: Record<string, unknown>,
  fields: string[],
  field: string,
): unknown {
  return fields.includes(field) ? data[field] : null;
}

async function updateActionOutcomeViaTaggedSql(
  ctx: {
    sql: SqlClient;
    orgId: string;
    actionId: string;
    patch: NormalizedOutcomePatch;
    gate: string | null;
    closeSource: string | null;
    spawnedAgentUuid: string | null;
  },
): Promise<Row | null> {
  const { sql, orgId, actionId, patch, gate, closeSource, spawnedAgentUuid } = ctx;
  const { data, fields } = patch;
  const includeErrorMessage = fields.includes('error_message');
  const newStatus = outcomeValue(data, fields, 'status');
  const updated = await sql`
    UPDATE action_records SET
      status            = COALESCE(${outcomeValue(data, fields, 'status')}, status),
      -- Fleet attribution (v4.3): merge ONLY the spawned_agent_uuid lineage key
      -- into outcome_progress. Unconditional w.r.t. row status (see
      -- UpdateActionOutcomeOptions.spawnedAgentUuid) — the caller passes it on
      -- the ungated write path.
      outcome_progress  = CASE
        WHEN ${spawnedAgentUuid}::text IS NOT NULL
        THEN COALESCE(outcome_progress, '{}'::jsonb)
             || jsonb_build_object('spawned_agent_uuid', ${spawnedAgentUuid}::text)
        ELSE outcome_progress
      END,
      close_source      = CASE
        WHEN ${closeSource}::text IS NOT NULL
          AND ${newStatus} = ANY(${TERMINAL_CLOSE_STATUSES}::text[])
        THEN ${closeSource}
        ELSE close_source
      END,
      output_summary    = COALESCE(${outcomeValue(data, fields, 'output_summary')}, output_summary),
      side_effects      = COALESCE(${outcomeValue(data, fields, 'side_effects')}, side_effects),
      artifacts_created = COALESCE(${outcomeValue(data, fields, 'artifacts_created')}, artifacts_created),
      error_message     = CASE WHEN ${includeErrorMessage} THEN ${includeErrorMessage ? (data.error_message ?? null) : null}::text ELSE error_message END,
      timestamp_end     = COALESCE(${outcomeValue(data, fields, 'timestamp_end')}, timestamp_end),
      duration_ms       = COALESCE(${outcomeValue(data, fields, 'duration_ms')}, duration_ms),
      cost_estimate     = COALESCE(${outcomeValue(data, fields, 'cost_estimate')}, cost_estimate),
      tokens_in         = COALESCE(${outcomeValue(data, fields, 'tokens_in')}, tokens_in),
      tokens_out        = COALESCE(${outcomeValue(data, fields, 'tokens_out')}, tokens_out),
      model             = COALESCE(${outcomeValue(data, fields, 'model')}, model),
      outcome_status    = CASE
        WHEN outcome_status = 'pending' AND ${newStatus} = 'completed' THEN 'completed'
        WHEN outcome_status = 'pending' AND ${newStatus} IN ('failed', 'cancelled', 'blocked') THEN 'failed'
        ELSE outcome_status
      END,
      outcome_at        = CASE
        WHEN outcome_status = 'pending' AND ${newStatus} IN ('completed', 'failed', 'cancelled', 'blocked') THEN NOW()
        ELSE outcome_at
      END,
      updated_at        = CURRENT_TIMESTAMP
    WHERE action_id = ${actionId} AND org_id = ${orgId}
      AND (${gate}::text IS NULL OR status = ${gate})
    RETURNING *
  `;
  return updated[0] || null;
}

export async function updateActionOutcome(
  ...args: [
    sql: SqlClient,
    orgId: string,
    actionId: string,
    outcome: Record<string, unknown>,
    options?: UpdateActionOutcomeOptions,
  ]
): Promise<Row | null> {
  const [sql, orgId, actionId, outcome, options = {}] = args;
  // `gateStatus` (optional) — when set, the UPDATE only applies if the row's
  // current status matches. Used by the Stop hook to close still-running
  // actions without clobbering a terminal state PostToolUse just wrote. If the
  // gate doesn't match, the UPDATE affects 0 rows and this returns null.
  const { gateStatus } = options;
  const gate = gateStatus ?? null;
  const closeSource = options.closeSource ?? null;
  // Fleet attribution (v4.3): sanitized here as the authoritative gate — a
  // non-string or over-200-char value is ignored, never persisted.
  const spawnedAgentUuid = boundedIdText(options.spawnedAgentUuid);

  // Verify existence and ownership
  const existing = await sql`SELECT action_id FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId} LIMIT 1`;
  if (existing.length === 0) return null;

  const { data, fields } = normalizeOutcomePatch(outcome);
  // A lineage-stamp-only call (no outcome fields) is still a real write.
  if (fields.length === 0 && !spawnedAgentUuid) return null;

  // Test-contract compatibility path for sql mocks that only provide .query()
  // responses. close_source / spawnedAgentUuid are not stamped on this path —
  // it exists only for the .query()-only test contract; production always uses
  // the tagged-sql path.
  if (typeof sql.query === 'function' && Array.isArray(sql.queryCalls)) {
    if (fields.length === 0) return null;
    return updateActionOutcomeViaQueryMock({
      sql,
      orgId,
      actionId,
      patch: { data, fields },
      gateStatus,
    });
  }

  return updateActionOutcomeViaTaggedSql({
    sql,
    orgId,
    actionId,
    patch: { data, fields },
    gate,
    closeSource,
    spawnedAgentUuid,
  });
}

interface ActionOutcomeShape {
  action_id: unknown;
  status: unknown;
  outcome_at: unknown;
  summary: unknown;
  error_message: unknown;
  progress: unknown;
  elapsed_ms: number | null;
}

/**
 * Read the durable-execution-finality outcome state of an action.
 * See docs/architecture/durable-execution-finality.md.
 *
 * Returns null when the action does not exist in this org. Returns the full
 * outcome shape (with derived elapsed_ms) when found, regardless of whether
 * the outcome is still pending.
 */
export async function getActionOutcome(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<ActionOutcomeShape | null> {
  const rows = await sql`
    SELECT
      action_id,
      outcome_status,
      outcome_at,
      outcome_summary,
      outcome_error,
      outcome_progress,
      created_at,
      EXTRACT(EPOCH FROM (COALESCE(outcome_at, NOW()) - created_at)) * 1000 AS elapsed_ms
    FROM action_records
    WHERE action_id = ${actionId} AND org_id = ${orgId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row) return null;
  return {
    action_id: row.action_id,
    status: row.outcome_status,
    outcome_at: row.outcome_at,
    summary: row.outcome_summary,
    error_message: row.outcome_error,
    progress: row.outcome_progress,
    elapsed_ms: row.elapsed_ms != null ? Math.round(Number(row.elapsed_ms)) : null,
  };
}

interface SetActionOutcomePayload {
  status: string;
  summary?: unknown;
  error_message?: unknown;
  progress?: unknown;
}

type SetActionOutcomeResult =
  | { ok: true; outcome: ActionOutcomeShape }
  | { ok: false; reason: 'invalid_status' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; current_status: unknown };

/**
 * Atomically transition an action's outcome from `pending` to a terminal state.
 *
 * Returns one of:
 *   { ok: true, outcome }              — transition succeeded; outcome is the
 *                                         post-update shape (same format as
 *                                         getActionOutcome).
 *   { ok: false, reason: 'not_found' } — action does not exist in this org.
 *   { ok: false, reason: 'conflict',
 *     current_status }                  — action exists but outcome is already
 *                                         terminal. current_status carries the
 *                                         existing terminal state so the route
 *                                         can return 409 with detail.
 *
 * One-shot semantics live in the WHERE clause — `outcome_status = 'pending'`
 * gates the UPDATE so two concurrent reporters race deterministically: the
 * first wins, the second gets `conflict`. The system-sweep path that sets
 * `lost_confirmation` uses the same gate, so an agent report and a sweep
 * cannot both terminate the same row.
 */
export async function setActionOutcome(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  payload: SetActionOutcomePayload,
): Promise<SetActionOutcomeResult> {
  const { status, summary = null, error_message = null, progress = null } = payload;

  const allowed = new Set(['completed', 'partial', 'failed', 'lost_confirmation']);
  if (!allowed.has(status)) {
    return { ok: false, reason: 'invalid_status' };
  }

  const progressJson = progress != null ? JSON.stringify(progress) : null;

  const updated = await sql`
    UPDATE action_records
    SET outcome_status   = ${status},
        outcome_at       = NOW(),
        outcome_summary  = ${summary},
        outcome_error    = ${error_message},
        outcome_progress = ${progressJson}::jsonb,
        -- Closure provenance (drizzle/0048, v4.2): the durable-finality outcome
        -- write is a real 'outcome' close. COALESCE preserves any earlier stamp
        -- (e.g. a Stop-hook 'stop_autoclose' PATCH) so first-close truth wins.
        close_source     = COALESCE(close_source, 'outcome'),
        updated_at       = CURRENT_TIMESTAMP
    WHERE action_id = ${actionId}
      AND org_id    = ${orgId}
      AND outcome_status = 'pending'
    RETURNING
      action_id,
      outcome_status,
      outcome_at,
      outcome_summary,
      outcome_error,
      outcome_progress,
      created_at,
      EXTRACT(EPOCH FROM (outcome_at - created_at)) * 1000 AS elapsed_ms
  `;

  if (updated.length > 0) {
    const row = updated[0];
    if (row) {
      return {
        ok: true,
        outcome: {
          action_id: row.action_id,
          status: row.outcome_status,
          outcome_at: row.outcome_at,
          summary: row.outcome_summary,
          error_message: row.outcome_error,
          progress: row.outcome_progress,
          elapsed_ms: row.elapsed_ms != null ? Math.round(Number(row.elapsed_ms)) : null,
        },
      };
    }
  }

  // Gate failed. Distinguish "not found" from "already terminal" with a
  // single follow-up read scoped to this org.
  const current = await sql`
    SELECT outcome_status FROM action_records
    WHERE action_id = ${actionId} AND org_id = ${orgId}
    LIMIT 1
  `;
  if (current.length === 0) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'conflict', current_status: current[0]?.outcome_status };
}

/**
 * Mark all pending outcomes older than the timeout as lost_confirmation
 * for a single org. Atomic UPDATE; returns the rows newly transitioned so
 * the caller can fan out signal emissions and webhook deliveries.
 *
 * The sweep uses the same one-shot gate as setActionOutcome
 * (`outcome_status = 'pending'`), so an agent report racing with the sweep
 * cannot double-terminate.
 *
 * Legacy-status guard (added 2026-05-13): the sweep MUST skip actions whose
 * lifecycle `status` is already terminal (`completed`, `failed`, `cancelled`,
 * `blocked`). Every existing integration that uses the PATCH-based
 * `updateOutcome` path (OpenClaw plugin, Claude Code hooks, the SDK helper
 * by the same name) sets `status` to a terminal value but leaves
 * `outcome_status='pending'` because they predate the durable-finality
 * surface. Without this guard, every such action would be re-marked
 * `lost_confirmation` after the timeout, generating spurious signals and
 * misleading the dashboard. Treats legacy terminal status as a proxy for
 * "outcome was implicitly confirmed via the legacy path." Genuinely orphan
 * actions (status='running' / 'pending' / 'pending_approval' / null) still
 * sweep as intended.
 *
 * Lifecycle reconciliation (zombie-running fix): a swept row whose lifecycle
 * status is still 'running' / 'pending' / NULL ALSO flips to status='unknown'
 * — the ledger must stop implying work is in flight when no outcome was ever
 * confirmed. 'pending_approval' is deliberately NOT flipped here: the
 * approvals expiry sweep owns that lifecycle (approval_expires_at). A late
 * agent PATCH still lands (updateOutcome overwrites status), so a genuinely
 * slow action self-heals to completed/failed. A second backfill UPDATE
 * reconciles rows that were marked lost_confirmation BEFORE this change and
 * are therefore stuck at status='running' with outcome_status already
 * terminal (the primary UPDATE's outcome_status='pending' gate can never
 * reach them again).
 */
export async function sweepLostOutcomesForOrg(
  sql: SqlClient,
  orgId: string,
  timeoutMinutes: number,
): Promise<Row[]> {
  const minutes = Number.isFinite(timeoutMinutes) && timeoutMinutes > 0
    ? Math.floor(timeoutMinutes)
    : 15;
  const rows = await sql`
    UPDATE action_records
    SET outcome_status  = 'lost_confirmation',
        outcome_at      = NOW(),
        outcome_summary = 'No outcome reported within timeout window',
        status          = CASE WHEN status IS NULL OR status IN ('running', 'pending')
                               THEN 'unknown' ELSE status END,
        error_message   = CASE WHEN status IS NULL OR status IN ('running', 'pending')
                               THEN COALESCE(error_message, 'Outcome never reported — reconciled to unknown by the stale-outcome sweep')
                               ELSE error_message END,
        updated_at      = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId}
      AND outcome_status = 'pending'
      AND created_at < NOW() - make_interval(mins => ${minutes})
      AND (status IS NULL OR status NOT IN ('completed', 'failed', 'cancelled', 'blocked'))
    RETURNING action_id, agent_id, agent_name, action_type, declared_goal, created_at, outcome_at
  `;
  // Backfill: rows already lost_confirmation but still claiming 'running' /
  // 'pending' (swept before the lifecycle reconciliation existed). Count-only
  // — their lost_confirmation signal/webhook already fired when they flipped.
  try {
    const backfilled = await sql`
      UPDATE action_records
      SET status = 'unknown',
          error_message = COALESCE(error_message, 'Outcome never reported — reconciled to unknown by the stale-outcome sweep'),
          updated_at = CURRENT_TIMESTAMP
      WHERE org_id = ${orgId}
        AND outcome_status = 'lost_confirmation'
        AND (status IS NULL OR status IN ('running', 'pending'))
      RETURNING action_id
    `;
    if (backfilled.length > 0) {
      console.warn(`[OUTCOME SWEEP] reconciled ${backfilled.length} zombie running/pending row(s) already marked lost_confirmation (org ${orgId})`);
    }
  } catch (err) {
    console.warn('[OUTCOME SWEEP] zombie-status backfill failed:', (err as Error)?.message || err);
  }
  return rows;
}

// ── Lazy outcome-sweep trigger (self-host installs without the cron) ────────
// The cron route (/api/cron/outcome-sweep) is the primary reconciler, but a
// self-host instance with no scheduler would never run it — zombies would
// only ever be *flagged* (signals, doctor), never healed. Piggyback on the
// actions list (the page that would otherwise display the lie), throttled
// per org so Approvals polling doesn't turn into a write per request.
const LOST_OUTCOME_SWEEP_THROTTLE_MS = 10 * 60 * 1000;
const lostOutcomeSweepLastRun = new Map<string, number>();

/** Test-only: clear the lazy outcome-sweep throttle. */
export function __resetLostOutcomeSweepThrottle(): void {
  lostOutcomeSweepLastRun.clear();
}

const OUTCOME_TIMEOUT_DEFAULT_MINUTES = 15;

// Same clamp as the cron route's resolveTimeoutMinutes (floor 1, ceiling 24h).
async function resolveOutcomeTimeoutMinutes(sql: SqlClient, orgId: string): Promise<number> {
  try {
    const { getSettings } = await import('./settings.repository');
    const rows = await getSettings(sql, orgId, { key: 'DASHCLAW_OUTCOME_TIMEOUT_MINUTES' });
    const raw = (rows?.[0] as Row | undefined)?.value;
    if (raw == null || raw === '') return OUTCOME_TIMEOUT_DEFAULT_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n)) return OUTCOME_TIMEOUT_DEFAULT_MINUTES;
    return Math.min(24 * 60, Math.max(1, Math.floor(n)));
  } catch {
    return OUTCOME_TIMEOUT_DEFAULT_MINUTES;
  }
}

/**
 * Throttled lazy wrapper around sweepLostOutcomesForOrg. Returns the newly
 * swept rows, or [] when throttled. Callers treat it as best-effort.
 */
export async function maybeSweepLostOutcomes(sql: SqlClient, orgId: string): Promise<Row[]> {
  const now = Date.now();
  const last = lostOutcomeSweepLastRun.get(orgId) ?? 0;
  if (now - last < LOST_OUTCOME_SWEEP_THROTTLE_MS) return [];
  lostOutcomeSweepLastRun.set(orgId, now);
  const timeoutMinutes = await resolveOutcomeTimeoutMinutes(sql, orgId);
  return sweepLostOutcomesForOrg(sql, orgId, timeoutMinutes);
}

/**
 * Return the distinct org_ids that have at least one pending outcome older
 * than the lowest plausible timeout. Used by the sweep to avoid iterating
 * orgs that cannot possibly have anything to mark.
 */
export async function listOrgsWithStaleOutcomes(
  sql: SqlClient,
  lowerBoundMinutes: number = 5,
): Promise<unknown[]> {
  const minutes = Math.max(1, Math.floor(Number(lowerBoundMinutes) || 5));
  const rows = await sql`
    SELECT DISTINCT org_id
    FROM action_records
    WHERE outcome_status = 'pending'
      AND created_at < NOW() - make_interval(mins => ${minutes})
  `;
  return rows.map((r) => r.org_id);
}

interface ActionTraceData {
  action: Row;
  assumptions: Row[];
  loops: Row[];
  relatedActions: Row[];
  subActions: Row[];
  parentChain: Row[];
}

async function fetchParentChain(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  initialParentId: unknown,
): Promise<Row[]> {
  const parentChain: Row[] = [];
  let currentParentId = initialParentId;
  const visited = new Set([actionId]);
  while (currentParentId && !visited.has(currentParentId as string) && parentChain.length < 10) {
    visited.add(currentParentId as string);
    const parentResult = await sql`
      SELECT action_id, agent_id, agent_name, action_type, declared_goal, status,
             risk_score, timestamp_start, error_message, parent_action_id
      FROM action_records WHERE action_id = ${currentParentId} AND org_id = ${orgId}
    `;
    if (parentResult.length === 0) break;
    const parent = parentResult[0];
    if (!parent) break;
    parentChain.push(parent);
    currentParentId = parent.parent_action_id;
  }
  return parentChain;
}

/**
 * Fetch all data required for an action trace (parent chain, assumptions, loops, related actions, sub-actions).
 */
export async function getActionTraceData(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<ActionTraceData | null> {
  // Fetch the target action first to get metadata for related queries
  const actions = await sql`
    SELECT * FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId}
  `;

  if (actions.length === 0) return null;
  const action = actions[0];
  if (!action) return null;

  // Parallel fetch of direct associations and related signals
  const [assumptions, loops, relatedActions, subActions] = await Promise.all([
    sql`SELECT * FROM assumptions WHERE action_id = ${actionId} AND org_id = ${orgId} ORDER BY created_at ASC`,
    sql`SELECT * FROM open_loops WHERE action_id = ${actionId} AND org_id = ${orgId} ORDER BY created_at ASC`,
    sql`
      SELECT action_id, agent_id, agent_name, action_type, declared_goal, status,
             risk_score, timestamp_start, error_message
      FROM action_records
      WHERE action_id != ${actionId}
        AND org_id = ${orgId}
        AND (
          agent_id = ${action.agent_id}
          OR (systems_touched = ${action.systems_touched} AND systems_touched IS NOT NULL AND systems_touched != '[]')
        )
        AND timestamp_start::timestamptz > ${action.timestamp_start}::timestamptz - INTERVAL '1 hour'
        AND timestamp_start::timestamptz < ${action.timestamp_start}::timestamptz + INTERVAL '1 hour'
      ORDER BY timestamp_start DESC
      LIMIT 20
    `,
    sql`
      SELECT action_id, agent_id, agent_name, action_type, declared_goal, status,
             risk_score, timestamp_start, error_message
      FROM action_records
      WHERE parent_action_id = ${actionId}
        AND org_id = ${orgId}
      ORDER BY timestamp_start ASC
    `
  ]);

  const parentChain = await fetchParentChain(sql, orgId, actionId, action.parent_action_id);

  return {
    action,
    assumptions,
    loops,
    relatedActions,
    subActions,
    parentChain
  };
}

interface GraphNode {
  id: string;
  type: string;
  label: unknown;
  status?: unknown;
  riskScore?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  actionType?: unknown;
  timestamp?: unknown;
  isRoot?: boolean;
  meta?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: unknown;
}

interface GraphAccumulator {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pushNode: (node: GraphNode) => void;
}

function createGraphAccumulator(): GraphAccumulator {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  return {
    nodes,
    edges,
    pushNode(node: GraphNode) {
      if (seenNodes.has(node.id)) return;
      seenNodes.add(node.id);
      nodes.push(node);
    },
  };
}

function toActionNode(a: Row, { isRoot = false }: { isRoot?: boolean } = {}): GraphNode {
  return {
    id: `action:${a.action_id}`,
    type: 'action',
    label: firstPresent(a.declared_goal, a.action_type, a.action_id),
    status: valueOrDefault(a.status, 'unknown'),
    riskScore: a.risk_score ?? null,
    agentId: valueOrNull(a.agent_id),
    agentName: valueOrNull(a.agent_name),
    actionType: valueOrNull(a.action_type),
    timestamp: valueOrNull(a.timestamp_start),
    isRoot,
    meta: {
      error_message: valueOrNull(a.error_message),
      parent_action_id: valueOrNull(a.parent_action_id),
    },
  };
}

function firstPresent(...values: unknown[]): unknown {
  return values.find(Boolean) ?? null;
}

function valueOrNull(value: unknown): unknown {
  return value || null;
}

function valueOrDefault(value: unknown, fallback: unknown): unknown {
  return value || fallback;
}

function addParentChain(acc: GraphAccumulator, action: Row, parentChain: Row[]): void {
  let childActionId = action.action_id;
  for (const parent of parentChain || []) {
    acc.pushNode(toActionNode(parent));
    acc.edges.push({
      id: `edge:pc:${parent.action_id}->${childActionId}`,
      source: `action:${parent.action_id}`,
      target: `action:${childActionId}`,
      type: 'parent_child',
      label: 'spawned',
    });
    childActionId = parent.action_id;
  }
}

function addSubActions(acc: GraphAccumulator, action: Row, subActions: Row[]): void {
  for (const sub of subActions || []) {
    acc.pushNode(toActionNode(sub));
    acc.edges.push({
      id: `edge:pc:${action.action_id}->${sub.action_id}`,
      source: `action:${action.action_id}`,
      target: `action:${sub.action_id}`,
      type: 'parent_child',
      label: 'spawned',
    });
  }
}

function addRelatedActions(acc: GraphAccumulator, action: Row, relatedActions: Row[]): void {
  for (const rel of relatedActions || []) {
    acc.pushNode(toActionNode(rel));
    acc.edges.push({
      id: `edge:rel:${action.action_id}-${rel.action_id}`,
      source: `action:${action.action_id}`,
      target: `action:${rel.action_id}`,
      type: 'related',
      label: 'correlated',
    });
  }
}

function assumptionStatus(a: Row): string {
  const invalidated = a.invalidated === 1 || a.invalidated === true;
  const validated = a.validated === 1 || a.validated === true;
  return invalidated ? 'invalidated' : validated ? 'validated' : 'unresolved';
}

function addAssumptions(acc: GraphAccumulator, action: Row, assumptions: Row[]): void {
  for (const a of assumptions || []) {
    const status = assumptionStatus(a);
    acc.pushNode({
      id: `assumption:${a.assumption_id}`,
      type: 'assumption',
      label: a.assumption || 'Assumption',
      status,
      meta: {
        invalidated_reason: a.invalidated_reason || null,
        drift_score: a.drift_score ?? null,
        created_at: a.created_at || null,
      },
    });
    acc.edges.push({
      id: `edge:as:${a.assumption_id}->${action.action_id}`,
      source: `assumption:${a.assumption_id}`,
      target: `action:${action.action_id}`,
      type: 'assumption_of',
      label: status,
    });
  }
}

function addOpenLoops(acc: GraphAccumulator, action: Row, loops: Row[]): void {
  for (const l of loops || []) {
    acc.pushNode({
      id: `loop:${l.loop_id}`,
      type: 'loop',
      label: firstPresent(l.description, l.loop_type, 'Open loop'),
      status: valueOrDefault(l.status, 'open'),
      meta: {
        priority: valueOrNull(l.priority),
        loop_type: valueOrNull(l.loop_type),
        created_at: valueOrNull(l.created_at),
      },
    });
    acc.edges.push({
      id: `edge:lp:${l.loop_id}->${action.action_id}`,
      source: `loop:${l.loop_id}`,
      target: `action:${action.action_id}`,
      type: 'loop_from',
      label: valueOrDefault(l.priority, 'open'),
    });
  }
}

/**
 * Build a read-only graph payload (nodes + edges) for an action, reusing
 * trace data plus correlated governance artifacts. Powers the Execution Graph
 * tab on the decision replay page.
 *
 * Node id conventions:
 *   action:<action_id>, assumption:<assumption_id>, loop:<loop_id>
 *
 * Edge types:
 *   parent_child   — parent action spawned child action
 *   related        — correlated action (same agent/system, nearby time window)
 *   assumption_of  — assumption supports the root action's decision basis
 *   loop_from      — open loop attached to the root action
 */
export async function buildActionGraph(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<{ rootActionId: unknown; nodes: GraphNode[]; edges: GraphEdge[] } | null> {
  const trace = await getActionTraceData(sql, orgId, actionId);
  if (!trace) return null;

  const { action, assumptions, loops, relatedActions, subActions, parentChain } = trace;
  const acc = createGraphAccumulator();

  // Root action
  acc.pushNode(toActionNode(action, { isRoot: true }));

  // Parent chain — each parent spawned the next link toward the root
  addParentChain(acc, action, parentChain);

  // Sub-actions (root spawned them)
  addSubActions(acc, action, subActions);

  // Related actions (same agent/systems in nearby time window)
  addRelatedActions(acc, action, relatedActions);

  // Assumptions — edge flows from assumption into the action it supports
  addAssumptions(acc, action, assumptions);

  // Open loops — edge flows from loop into the action it blocks/questions
  addOpenLoops(acc, action, loops);

  return {
    rootActionId: action.action_id,
    nodes: acc.nodes,
    edges: acc.edges,
  };
}

interface ActionStatsResult {
  current: Row;
  previousTotal: unknown;
}

function defaultActionStats(): Row {
  return { total: 0, completed: 0, failed: 0, blocked: 0, cancelled: 0, approval: 0 };
}

function actionStatsResult(currentResults: Row[], previousResults: Row[]): ActionStatsResult {
  return {
    current: currentResults[0] || defaultActionStats(),
    previousTotal: previousResults[0]?.total || 0
  };
}

async function getActionStatsViaQueryMock(
  sql: SqlClient,
  orgId: string,
  agentId: string | null,
): Promise<ActionStatsResult> {
  const agentFilter = agentId ? ' AND agent_id = $2' : '';
  const params = agentId ? [orgId, agentId] : [orgId];
  const currentQuery = `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='completed')::int as completed,
        COUNT(*) FILTER (WHERE status='failed')::int as failed,
        COUNT(*) FILTER (WHERE status='blocked')::int as blocked,
        COUNT(*) FILTER (WHERE status='cancelled')::int as cancelled,
        COUNT(*) FILTER (WHERE status='pending_approval')::int as approval
      FROM action_records
      WHERE org_id = $1 AND created_at > NOW() - INTERVAL '24 hours'${agentFilter}
    `;
  const previousQuery = `
      SELECT COUNT(*)::int as total
      FROM action_records
      WHERE org_id = $1 AND created_at <= NOW() - INTERVAL '24 hours' AND created_at > NOW() - INTERVAL '48 hours'${agentFilter}
    `;

  const [currentResults, previousResults] = await Promise.all([
    sql.query(currentQuery, params),
    sql.query(previousQuery, params)
  ]);

  return actionStatsResult(currentResults, previousResults);
}

async function getActionStatsViaTaggedSql(
  sql: SqlClient,
  orgId: string,
  agentId: string | null,
): Promise<ActionStatsResult> {
  const agentFilter = sqlFragment(sql, !!agentId, () => sql`AND agent_id = ${agentId}`);
  const [currentResults, previousResults] = await Promise.all([
    sql`
          SELECT
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE status='completed')::int as completed,
            COUNT(*) FILTER (WHERE status='failed')::int as failed,
            COUNT(*) FILTER (WHERE status='blocked')::int as blocked,
            COUNT(*) FILTER (WHERE status='cancelled')::int as cancelled,
            COUNT(*) FILTER (WHERE status='pending_approval')::int as approval
          FROM action_records
          WHERE org_id = ${orgId}
            ${agentFilter}
            AND created_at > NOW() - INTERVAL '24 hours'
        `,
    sql`
          SELECT COUNT(*)::int as total
          FROM action_records
          WHERE org_id = ${orgId}
            ${agentFilter}
            AND created_at <= NOW() - INTERVAL '24 hours'
            AND created_at > NOW() - INTERVAL '48 hours'
        `
  ]);
  return actionStatsResult(currentResults, previousResults);
}

/**
 * Fetch decision throughput statistics for the last 24h and comparison window.
 */
export async function getActionStats(
  sql: SqlClient,
  orgId: string,
  agentId: string | null = null,
): Promise<ActionStatsResult> {
  // Test-contract compatibility path for sql mocks
  if (typeof sql.query === 'function' && Array.isArray(sql.queryCalls)) {
    return getActionStatsViaQueryMock(sql, orgId, agentId);
  }

  return getActionStatsViaTaggedSql(sql, orgId, agentId);
}

/**
 * Fetch historical actions for policy simulation.
 */
/**
 * Delete actions by a list of specific action IDs, including related loops and assumptions.
 */
export async function deleteActionsByIds(sql: SqlClient, orgId: string, idList: string[]): Promise<Row[]> {
  await sql`DELETE FROM open_loops WHERE action_id = ANY(${idList}) AND org_id = ${orgId}`;
  await sql`DELETE FROM assumptions WHERE action_id = ANY(${idList}) AND org_id = ${orgId}`;
  return sql`DELETE FROM action_records WHERE action_id = ANY(${idList}) AND org_id = ${orgId} RETURNING action_id`;
}

/**
 * Resolve the action_ids a filtered bulk delete would remove, so the erasure
 * audit row can be written (and awaited) BEFORE any row is deleted. Mirrors
 * the filter semantics of DELETE /api/actions exactly.
 */
export async function listActionIdsByFilter(
  sql: SqlClient,
  orgId: string,
  { before, agentId, status }: { before?: string | null; agentId?: string | null; status?: string | null },
): Promise<string[]> {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let paramIdx = 2;
  if (before) {
    conditions.push(`timestamp_start::timestamptz < $${paramIdx++}::timestamptz`);
    params.push(before);
  }
  if (agentId) {
    conditions.push(`agent_id = $${paramIdx++}`);
    params.push(agentId);
  }
  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }
  const rows = await sql.query(
    `SELECT action_id FROM action_records WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows.map((r: Row) => String(r.action_id));
}

/**
 * Fetch historical actions for policy simulation.
 */
export async function listActionsForSimulation(
  sql: SqlClient,
  orgId: string,
  days: number | string = 7,
  limit: number | string = 200,
): Promise<Row[]> {
  return sql`
    SELECT action_id, agent_id, agent_name, action_type, declared_goal, risk_score,
           systems_touched, reversible, timestamp_start, status
    FROM action_records
    WHERE org_id = ${orgId}
      AND timestamp_start::timestamptz > NOW() - INTERVAL '1 day' * ${parseInt(days as string, 10)}
    ORDER BY timestamp_start DESC
    LIMIT ${parseInt(limit as string, 10)}
  `;
}

/** Pending-approval action ids matching a set of action_types since a cutoff (bulk flood resolution). */
export async function listPendingApprovalIdsByActionTypes(
  sql: SqlClient,
  orgId: string,
  actionTypes: string[],
  sinceIso: string,
  limit = 500,
): Promise<string[]> {
  if (!actionTypes.length) return [];
  // Overdue rows are excluded: bulk resolution must never "approve" an
  // approval whose client already stopped waiting (roadmap v2.3). The bulk
  // route also sweeps first; this predicate covers the race in between.
  const rows = await sql.query(
    `SELECT action_id FROM action_records
     WHERE org_id = $1 AND status = 'pending_approval'
       AND action_type = ANY($2)
       AND created_at::timestamptz >= $3::timestamptz
       AND (approval_expires_at >= NOW()
            OR (approval_expires_at IS NULL AND created_at >= NOW() - interval '24 hours'))
     ORDER BY created_at ASC
     LIMIT $4`,
    [orgId, actionTypes, sinceIso, Math.min(Math.max(1, limit), 500)],
  );
  return (rows as Array<{ action_id: string }>).map((r) => r.action_id);
}

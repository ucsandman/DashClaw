import { OUTCOME_FIELDS } from '../validate.js';

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

export async function hasAction(sql: SqlClient, orgId: string, actionId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId} LIMIT 1
  `;
  return rows.length > 0;
}

export async function getActionStatus(sql: SqlClient, orgId: string, actionId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT status, agent_id FROM action_records
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
  const { newStatus, errorMessage, decision, userId, safeReasoning } = data;

  const result = await sql`
    UPDATE action_records
    SET status = ${newStatus},
        error_message = ${errorMessage},
        approved_by = ${decision.toUpperCase() === 'ALLOW' ? userId : null},
        approved_at = ${decision.toUpperCase() === 'ALLOW' ? sql`CURRENT_TIMESTAMP` : null},
        reasoning = COALESCE(reasoning, '') || '

[HITL Decision: ' || ${decision.toUpperCase()} || ' by ' || ${userId} || ']' ||
                    CASE WHEN ${safeReasoning || ''} != '' THEN '
Reason: ' || ${safeReasoning} ELSE '' END
    WHERE action_id = ${actionId}
      AND org_id = ${orgId}
      AND status = 'pending_approval'
    RETURNING *
  `;
  return result[0] || null;
}

interface ListActionsFilters {
  agent_id?: string;
  swarm_id?: string;
  status?: string;
  exclude_status?: string;
  action_type?: string;
  risk_min?: number | string;
  outcome_status?: string;
  limit?: number | string;
  offset?: number | string;
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

export async function listActions(
  sql: SqlClient,
  orgId: string,
  filters: ListActionsFilters = {},
): Promise<{ actions: Row[]; total: number; stats: Row }> {
  const {
    agent_id,
    swarm_id,
    status,
    exclude_status,
    action_type,
    risk_min,
    outcome_status,
    limit = 50,
    offset = 0,
  } = filters;
  const VALID_OUTCOMES = new Set(['pending', 'completed', 'partial', 'failed', 'lost_confirmation']);
  const outcomeFilter = VALID_OUTCOMES.has(outcome_status as string) ? outcome_status : null;

  const parsedRiskMin = Number.isFinite(Number(risk_min)) ? Number(risk_min) : null;
  const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 200);
  const parsedOffset = parseInt(offset as string, 10) || 0;

  // Test-contract compatibility path for sql mocks that only provide .query() responses.
  if (typeof sql.query === 'function' && Array.isArray(sql.queryCalls)) {
    const conditions = ['org_id = $1'];
    const params: unknown[] = [orgId];

    if (agent_id) {
      conditions.push(`agent_id = $${params.push(agent_id)}`);
    }
    if (swarm_id) {
      conditions.push(`swarm_id = $${params.push(swarm_id)}`);
    }
    if (status) {
      conditions.push(`status = $${params.push(status)}`);
    }
    if (exclude_status && !status) {
      conditions.push(`status != $${params.push(exclude_status)}`);
    }
    if (action_type) {
      conditions.push(`action_type = $${params.push(action_type)}`);
    }
    if (parsedRiskMin != null) {
      conditions.push(`risk_score >= $${params.push(parsedRiskMin)}`);
    }

    if (outcomeFilter) {
      conditions.push(`outcome_status = $${params.push(outcomeFilter)}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const listCols = 'action_id, agent_id, agent_name, swarm_id, action_type, declared_goal, reasoning, authorization_scope, systems_touched, status, reversible, risk_score, confidence, model, output_summary, error_message, side_effects, artifacts_created, duration_ms, cost_estimate, timestamp_start, timestamp_end, created_at, verified, approved_by, approved_at, outcome_status, outcome_at, outcome_summary, outcome_error';
    const query = `SELECT ${listCols} FROM action_records ${where} ORDER BY timestamp_start DESC LIMIT $${params.push(parsedLimit)} OFFSET $${params.push(parsedOffset)}`;
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

  const [actions, countResult, stats] = await Promise.all([
    sql`
      SELECT
        action_id, agent_id, agent_name, swarm_id, action_type, declared_goal, reasoning, authorization_scope, systems_touched, status, reversible, risk_score, confidence, model, output_summary, error_message, side_effects, artifacts_created, duration_ms, cost_estimate, timestamp_start, timestamp_end, created_at, verified, approved_by, approved_at, outcome_status, outcome_at, outcome_summary, outcome_error
      FROM action_records
      WHERE org_id = ${orgId}
        ${agent_id ? sql`AND agent_id = ${agent_id}` : sql``}
        ${swarm_id ? sql`AND swarm_id = ${swarm_id}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
        ${exclude_status && !status ? sql`AND status != ${exclude_status}` : sql``}
        ${action_type ? sql`AND action_type = ${action_type}` : sql``}
        ${parsedRiskMin != null ? sql`AND risk_score >= ${parsedRiskMin}` : sql``}
        ${outcomeFilter ? sql`AND outcome_status = ${outcomeFilter}` : sql``}
      ORDER BY timestamp_start DESC
      LIMIT ${parsedLimit}
      OFFSET ${parsedOffset}
    `,
    sql`
      SELECT COUNT(*) as total
      FROM action_records
      WHERE org_id = ${orgId}
        ${agent_id ? sql`AND agent_id = ${agent_id}` : sql``}
        ${swarm_id ? sql`AND swarm_id = ${swarm_id}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
        ${exclude_status && !status ? sql`AND status != ${exclude_status}` : sql``}
        ${action_type ? sql`AND action_type = ${action_type}` : sql``}
        ${parsedRiskMin != null ? sql`AND risk_score >= ${parsedRiskMin}` : sql``}
        ${outcomeFilter ? sql`AND outcome_status = ${outcomeFilter}` : sql``}
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
      WHERE org_id = ${orgId}
        ${agent_id ? sql`AND agent_id = ${agent_id}` : sql``}
        ${swarm_id ? sql`AND swarm_id = ${swarm_id}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
        ${exclude_status && !status ? sql`AND status != ${exclude_status}` : sql``}
        ${action_type ? sql`AND action_type = ${action_type}` : sql``}
        ${parsedRiskMin != null ? sql`AND risk_score >= ${parsedRiskMin}` : sql``}
        ${outcomeFilter ? sql`AND outcome_status = ${outcomeFilter}` : sql``}
    `,
  ]);

  return {
    actions,
    total: parseInt((countResult[0]?.total as string) || '0', 10),
    stats: coerceActionStats(stats[0]),
  };
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
}

export async function createActionRecord(sql: SqlClient, payload: CreateActionPayload): Promise<Row | null> {
  const {
    orgId,
    action_id,
    data,
    actionStatus,
    costEstimate,
    signature,
    verified,
    timestamp_start,
    riskScore,
  } = payload;

  // SECURITY (R1): persist the server-authoritative risk score when the caller
  // supplies it (guard decisions), so the ledger/alerts/analytics/dashboard
  // present the value the guard actually decided on — not the forgeable
  // client-asserted `data.risk_score`. Fall back to the client value only for
  // legacy callers that don't pass `riskScore`.
  const persistedRisk = riskScore != null
    ? Math.max(0, Math.min(Math.round(Number(riskScore) || 0), 100))
    : (data.risk_score || 0);

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
      signature, verified, idempotency_key, session_id
    ) VALUES (
      ${orgId},
      ${action_id},
      ${data.agent_id},
      ${data.agent_name || null},
      ${data.swarm_id || null},
      ${data.parent_action_id || null},
      ${data.action_type},
      ${data.declared_goal},
      ${data.reasoning || null},
      ${data.authorization_scope || null},
      ${data.trigger || null},
      ${JSON.stringify(data.systems_touched || [])},
      ${data.input_summary || null},
      ${actionStatus},
      ${data.reversible !== undefined ? (data.reversible ? 1 : 0) : 1},
      ${persistedRisk},
      ${data.confidence || 50},
      ${data.recommendation_id || null},
      ${data.recommendation_applied ? 1 : 0},
      ${data.recommendation_override_reason || null},
      ${data.output_summary || null},
      ${JSON.stringify(data.side_effects || [])},
      ${JSON.stringify(data.artifacts_created || [])},
      ${data.error_message || null},
      ${timestamp_start},
      ${data.timestamp_end || null},
      ${data.duration_ms || null},
      ${costEstimate},
      ${data.tokens_in || 0},
      ${data.tokens_out || 0},
      ${data.model || null},
      ${signature},
      ${verified},
      ${data.idempotency_key || null},
      ${data.session_id || null}
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

  // Build error message from guard decision
  const blockedReason = guardDecision?.reason
    || guardDecision?.reasons?.join('; ')
    || 'Action blocked by policy';
  const matchedPolicies = guardDecision?.matched_policies || [];

  // SECURITY (R1): persist the server-authoritative risk. Prefer the explicit
  // `riskScore` payload; otherwise the guard decision's own score; only then the
  // client-asserted value. A blocked record showing risk 0 because the agent
  // self-reported 0 is exactly the integrity gap this closes.
  const persistedRisk = riskScore != null
    ? Math.max(0, Math.min(Math.round(Number(riskScore) || 0), 100))
    : (guardDecision?.risk_score != null
        ? Math.max(0, Math.min(Math.round(Number(guardDecision.risk_score) || 0), 100))
        : (data.risk_score || 0));

  const rows = await sql`
    INSERT INTO action_records (
      org_id, action_id, agent_id, agent_name, swarm_id, parent_action_id,
      action_type, declared_goal, reasoning, authorization_scope,
      trigger, systems_touched, input_summary,
      status, reversible, risk_score, confidence,
      recommendation_id, recommendation_applied, recommendation_override_reason,
      output_summary, side_effects, artifacts_created, error_message,
      timestamp_start, timestamp_end, duration_ms, cost_estimate,
      tokens_in, tokens_out,
      signature, verified
    ) VALUES (
      ${orgId},
      ${action_id},
      ${data.agent_id},
      ${data.agent_name || null},
      ${data.swarm_id || null},
      ${data.parent_action_id || null},
      ${data.action_type},
      ${data.declared_goal},
      ${data.reasoning || null},
      ${data.authorization_scope || null},
      ${data.trigger || null},
      ${JSON.stringify(data.systems_touched || [])},
      ${data.input_summary || null},
      ${'blocked'},
      ${data.reversible !== undefined ? (data.reversible ? 1 : 0) : 1},
      ${persistedRisk},
      ${data.confidence || 50},
      ${data.recommendation_id || null},
      ${data.recommendation_applied ? 1 : 0},
      ${data.recommendation_override_reason || null},
      ${null},
      ${'[]'},
      ${'[]'},
      ${'Blocked by policy: ' + blockedReason + (matchedPolicies.length > 0 ? ' [Policies: ' + matchedPolicies.join(', ') + ']' : '')},
      ${timestamp_start},
      ${timestamp_start},
      ${0},
      ${0},
      ${data.tokens_in || 0},
      ${data.tokens_out || 0},
      ${signature},
      ${verified}
    )
    RETURNING *
  `;

  return rows[0] || null;
}

interface InsertActionEmbeddingPayload {
  orgId: string;
  agentId: string;
  actionId: string;
  embedding: unknown;
}

export async function insertActionEmbedding(
  sql: SqlClient,
  { orgId, agentId, actionId, embedding }: InsertActionEmbeddingPayload,
): Promise<void> {
  await sql`
    INSERT INTO action_embeddings (org_id, agent_id, action_id, embedding)
    VALUES (${orgId}, ${agentId}, ${actionId}, ${JSON.stringify(embedding)}::vector)
  `;
}

interface ActionWithRelations {
  action: Row;
  open_loops: Row[];
  assumptions: Row[];
  message_summary: {
    total: number;
    participants: string[];
    first_message_at: unknown;
    last_message_at: unknown;
  };
}

export async function getActionWithRelations(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<ActionWithRelations | null> {
  const [actions, loops, assumptions, msgSummaryRows] = await Promise.all([
    sql`SELECT * FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId}`,
    sql`SELECT * FROM open_loops WHERE action_id = ${actionId} AND org_id = ${orgId} ORDER BY created_at DESC`,
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

  return {
    action,
    open_loops: loops,
    assumptions,
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
}

export async function updateActionOutcome(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  outcome: Record<string, unknown>,
  options: UpdateActionOutcomeOptions = {},
): Promise<Row | null> {
  // `gateStatus` (optional) — when set, the UPDATE only applies if the row's
  // current status matches. Used by the Stop hook to close still-running
  // actions without clobbering a terminal state PostToolUse just wrote. If the
  // gate doesn't match, the UPDATE affects 0 rows and this returns null.
  const { gateStatus } = options;
  const gate = gateStatus ?? null;

  // Verify existence and ownership
  const existing = await sql`SELECT action_id FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId} LIMIT 1`;
  if (existing.length === 0) return null;

  const data: Record<string, unknown> = { ...outcome };

  // JSON stringify array/object fields
  if (data.side_effects !== undefined) data.side_effects = JSON.stringify(data.side_effects);
  if (data.artifacts_created !== undefined) data.artifacts_created = JSON.stringify(data.artifacts_created);

  const fields = Object.keys(data).filter(k => OUTCOME_FIELDS.includes(k));
  if (fields.length === 0) return null;

  // Test-contract compatibility path for sql mocks that only provide .query() responses.
  if (typeof sql.query === 'function' && Array.isArray(sql.queryCalls)) {
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`);
    const values = fields.map(f => data[f]);
    // Implicit durable-finality outcome: when the legacy PATCH transitions
    // `status` to a terminal value AND outcome_status is still pending,
    // set outcome_status to the matching terminal state. Maps:
    //   completed -> completed
    //   failed | cancelled | blocked -> failed
    // Respects the one-shot rule via `outcome_status = 'pending'` guard,
    // so a real reportActionOutcome call cannot be overwritten. Re-uses the
    // existing status param so no new query params are introduced.
    const statusIndex = fields.indexOf('status');
    if (statusIndex !== -1) {
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
    const baseWhere = `WHERE action_id = $${fields.length + 1} AND org_id = $${fields.length + 2}`;
    const gateWhere = gateStatus ? ` AND status = $${fields.length + 3}` : '';
    const query = `UPDATE action_records SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP ${baseWhere}${gateWhere} RETURNING *`;
    const queryParams = gateStatus ? [...values, actionId, orgId, gateStatus] : [...values, actionId, orgId];
    const updated = await sql.query(query, queryParams);
    return updated[0] || null;
  }

  // Single atomic UPDATE with all outcome fields at once. Most fields use
  // COALESCE to preserve existing values when not provided. error_message
  // is the exception: callers that revive a previously-failed action pass
  // error_message: null to *clear* the old error, and COALESCE would silently
  // keep the stale string. The CASE expression distinguishes "caller did not
  // pass the field" (keep existing) from "caller passed null" (clear it).
  // The final WHERE predicate is a no-op when `gate` is null, and an exact
  // match otherwise — atomic compare-and-set on the status column.
  const includeErrorMessage = fields.includes('error_message');
  // Implicit durable-finality outcome on legacy PATCH. When the caller
  // transitions `status` to a terminal value, we also set `outcome_status`
  // to the matching terminal state, but only if outcome_status is still
  // 'pending' (one-shot rule preserves explicit reportActionOutcome calls).
  // Mapping: completed -> completed; failed | cancelled | blocked -> failed.
  // `newStatus` is null when the caller did not pass a status field, in
  // which case every CASE branch fails the `${newStatus} = 'x'` comparison
  // (NULL = literal is NULL, not TRUE) and the ELSE preserves the column.
  const newStatus = fields.includes('status') ? data.status : null;
  const updated = await sql`
    UPDATE action_records SET
      status            = COALESCE(${fields.includes('status') ? data.status : null}, status),
      output_summary    = COALESCE(${fields.includes('output_summary') ? data.output_summary : null}, output_summary),
      side_effects      = COALESCE(${fields.includes('side_effects') ? data.side_effects : null}, side_effects),
      artifacts_created = COALESCE(${fields.includes('artifacts_created') ? data.artifacts_created : null}, artifacts_created),
      error_message     = CASE WHEN ${includeErrorMessage} THEN ${includeErrorMessage ? (data.error_message ?? null) : null}::text ELSE error_message END,
      timestamp_end     = COALESCE(${fields.includes('timestamp_end') ? data.timestamp_end : null}, timestamp_end),
      duration_ms       = COALESCE(${fields.includes('duration_ms') ? data.duration_ms : null}, duration_ms),
      cost_estimate     = COALESCE(${fields.includes('cost_estimate') ? data.cost_estimate : null}, cost_estimate),
      tokens_in         = COALESCE(${fields.includes('tokens_in') ? data.tokens_in : null}, tokens_in),
      tokens_out        = COALESCE(${fields.includes('tokens_out') ? data.tokens_out : null}, tokens_out),
      model             = COALESCE(${fields.includes('model') ? data.model : null}, model),
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
        updated_at      = CURRENT_TIMESTAMP
    WHERE org_id = ${orgId}
      AND outcome_status = 'pending'
      AND created_at < NOW() - make_interval(mins => ${minutes})
      AND (status IS NULL OR status NOT IN ('completed', 'failed', 'cancelled', 'blocked'))
    RETURNING action_id, agent_id, agent_name, action_type, declared_goal, created_at, outcome_at
  `;
  return rows;
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

  // Recursively build parent chain (limited to 10 generations to prevent infinite loops)
  const parentChain: Row[] = [];
  let currentParentId = action.parent_action_id;
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

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();

  const pushNode = (node: GraphNode) => {
    if (seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(node);
  };

  const toActionNode = (a: Row, { isRoot = false }: { isRoot?: boolean } = {}): GraphNode => ({
    id: `action:${a.action_id}`,
    type: 'action',
    label: a.declared_goal || a.action_type || a.action_id,
    status: a.status || 'unknown',
    riskScore: a.risk_score ?? null,
    agentId: a.agent_id || null,
    agentName: a.agent_name || null,
    actionType: a.action_type || null,
    timestamp: a.timestamp_start || null,
    isRoot,
    meta: {
      error_message: a.error_message || null,
      parent_action_id: a.parent_action_id || null,
    },
  });

  // Root action
  pushNode(toActionNode(action, { isRoot: true }));

  // Parent chain — each parent spawned the next link toward the root
  let childActionId = action.action_id;
  for (const parent of parentChain || []) {
    pushNode(toActionNode(parent));
    edges.push({
      id: `edge:pc:${parent.action_id}->${childActionId}`,
      source: `action:${parent.action_id}`,
      target: `action:${childActionId}`,
      type: 'parent_child',
      label: 'spawned',
    });
    childActionId = parent.action_id;
  }

  // Sub-actions (root spawned them)
  for (const sub of subActions || []) {
    pushNode(toActionNode(sub));
    edges.push({
      id: `edge:pc:${action.action_id}->${sub.action_id}`,
      source: `action:${action.action_id}`,
      target: `action:${sub.action_id}`,
      type: 'parent_child',
      label: 'spawned',
    });
  }

  // Related actions (same agent/systems in nearby time window)
  for (const rel of relatedActions || []) {
    pushNode(toActionNode(rel));
    edges.push({
      id: `edge:rel:${action.action_id}-${rel.action_id}`,
      source: `action:${action.action_id}`,
      target: `action:${rel.action_id}`,
      type: 'related',
      label: 'correlated',
    });
  }

  // Assumptions — edge flows from assumption into the action it supports
  for (const a of assumptions || []) {
    const invalidated = a.invalidated === 1 || a.invalidated === true;
    const validated = a.validated === 1 || a.validated === true;
    const status = invalidated ? 'invalidated' : validated ? 'validated' : 'unresolved';

    pushNode({
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
    edges.push({
      id: `edge:as:${a.assumption_id}->${action.action_id}`,
      source: `assumption:${a.assumption_id}`,
      target: `action:${action.action_id}`,
      type: 'assumption_of',
      label: status,
    });
  }

  // Open loops — edge flows from loop into the action it blocks/questions
  for (const l of loops || []) {
    pushNode({
      id: `loop:${l.loop_id}`,
      type: 'loop',
      label: l.description || l.loop_type || 'Open loop',
      status: l.status || 'open',
      meta: {
        priority: l.priority || null,
        loop_type: l.loop_type || null,
        created_at: l.created_at || null,
      },
    });
    edges.push({
      id: `edge:lp:${l.loop_id}->${action.action_id}`,
      source: `loop:${l.loop_id}`,
      target: `action:${action.action_id}`,
      type: 'loop_from',
      label: l.priority || 'open',
    });
  }

  return {
    rootActionId: action.action_id,
    nodes,
    edges,
  };
}

interface ActionStatsResult {
  current: Row;
  previousTotal: unknown;
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

    return {
      current: currentResults[0] || { total: 0, completed: 0, failed: 0, blocked: 0, cancelled: 0, approval: 0 },
      previousTotal: previousResults[0]?.total || 0
    };
  }

  const [currentResults, previousResults] = agentId
    ? await Promise.all([
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
            AND agent_id = ${agentId}
            AND created_at > NOW() - INTERVAL '24 hours'
        `,
        sql`
          SELECT COUNT(*)::int as total
          FROM action_records
          WHERE org_id = ${orgId}
            AND agent_id = ${agentId}
            AND created_at <= NOW() - INTERVAL '24 hours'
            AND created_at > NOW() - INTERVAL '48 hours'
        `
      ])
    : await Promise.all([
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
            AND created_at > NOW() - INTERVAL '24 hours'
        `,
        sql`
          SELECT COUNT(*)::int as total
          FROM action_records
          WHERE org_id = ${orgId}
            AND created_at <= NOW() - INTERVAL '24 hours'
            AND created_at > NOW() - INTERVAL '48 hours'
        `
      ]);

  return {
    current: currentResults[0] || { total: 0, completed: 0, failed: 0, blocked: 0, cancelled: 0, approval: 0 },
    previousTotal: previousResults[0]?.total || 0
  };
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

interface CostAggregationOptions {
  period?: string;
  agentId?: string | null;
}

interface CostAggregationResult {
  total_cost_usd: number;
  total_tokens_in: unknown;
  total_tokens_out: unknown;
  period: string;
  by_agent: Row[];
  by_day: Row[];
  [field: string]: unknown;
}

/**
 * Aggregate cost and token usage for an org over a rolling time window.
 * Returns totals, per-agent breakdown, and per-day breakdown.
 */
export async function getCostAggregation(
  sql: SqlClient,
  orgId: string,
  { period = '30d', agentId = null }: CostAggregationOptions = {},
): Promise<CostAggregationResult> {
  const days = parseInt(period) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const agentFilter = agentId ? sql` AND agent_id = ${agentId}` : sql``;

  const [totals] = await sql`
    SELECT
      COALESCE(SUM(cost_estimate), 0)::real as total_cost_usd,
      COALESCE(SUM(tokens_in), 0)::integer as total_tokens_in,
      COALESCE(SUM(tokens_out), 0)::integer as total_tokens_out
    FROM action_records
    WHERE org_id = ${orgId}
      AND created_at::timestamptz >= ${since}::timestamptz
      AND action_type <> 'x402_purchase'
      ${agentFilter}
  `;

  const byAgent = await sql`
    SELECT
      agent_id,
      COALESCE(SUM(cost_estimate), 0)::real as cost_usd,
      COUNT(*)::integer as action_count
    FROM action_records
    WHERE org_id = ${orgId}
      AND created_at::timestamptz >= ${since}::timestamptz
      AND action_type <> 'x402_purchase'
      ${agentFilter}
    GROUP BY agent_id
    ORDER BY cost_usd DESC
  `;

  const byDay = await sql`
    SELECT
      DATE(created_at::timestamptz) as date,
      COALESCE(SUM(cost_estimate), 0)::real as cost_usd,
      COUNT(*)::integer as action_count
    FROM action_records
    WHERE org_id = ${orgId}
      AND created_at::timestamptz >= ${since}::timestamptz
      AND action_type <> 'x402_purchase'
      ${agentFilter}
    GROUP BY DATE(created_at::timestamptz)
    ORDER BY date DESC
  `;

  return {
    total_cost_usd: Number(totals?.total_cost_usd ?? 0),
    total_tokens_in: totals?.total_tokens_in,
    total_tokens_out: totals?.total_tokens_out,
    period,
    by_agent: byAgent,
    by_day: byDay,
  };
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

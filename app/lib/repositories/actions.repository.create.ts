import { computeActContentHash } from '../act-content-hash';
import { buildAgentDefense, type AgentDefense } from '../agent-defense';
import { getGuardDecisionById } from './guardrails.repository';
import { incrementUsageRollup } from './usage.repository';
import { computeApprovalExpiry } from './actions.repository.approvals';
import { actionProvenance, boundedIdText, type Row, type SqlClient } from './actions.repository.shared';
import { redactAny } from '../security';

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

function orDefault<T>(value: T | null | undefined, fallback: T): T {
  return value || fallback;
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
  // Server-derived merge target (security follow-up, RFC 2026-07-06): stamped
  // by the guard route alongside containment_status, computed from the
  // payload's harness_session_id (buildContainmentRef). Never client-set —
  // validateActionRecord's schema whitelist drops it on POST /api/actions.
  containment_ref?: string | null;
  // Enforcement visibility (F0, drizzle/0066): the client's enforcement
  // posture at decision time ('enforce' | 'observe'). Normalized by
  // enforcementModeField in the routes; anything else persists NULL.
  enforcement_mode?: string | null;
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
  identityVerified?: boolean | null;
  payloadSignatureStatus?: 'verified' | 'invalid' | 'missing' | 'unknown';
}

function createActionInsertValues(payload: CreateActionPayload) {
  const { data, riskScore, costEstimate, signature, verified, timestamp_start } = payload;
  return {
    // `?? null` (not orNull): the strict self-host postgres driver REJECTS an
    // undefined bind outright (UNDEFINED_VALUE) while Neon silently coerces —
    // the exact class the 2026-06 approvals 500 and the 2026-07-28 promote
    // 500 both came from. Nullish-coalesce (not ||) so legitimate 0s persist.
    agent_id: data.agent_id ?? null,
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
    confidence: data.confidence ?? 50,
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
    cost_estimate: costEstimate ?? null,
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
    containment_ref: orNull(data.containment_ref),
    harness_session_id: boundedIdText(data.harness_session_id),
    subagent_uuid: boundedIdText(data.subagent_uuid),
    // Act-content grant binding (drizzle/0056): server-computed from the act
    // payload the client sent (never a client-supplied hash), so the
    // operator-approval grant can bind a retry to the exact approved act.
    // NULL when no act was supplied — the grant keeps the tuple match.
    act_content_hash: computeActContentHash(data.act),
    created_by: orNull(payload.createdBy),
    // Enforcement visibility (F0, drizzle/0066): the client's enforcement
    // posture at decision time. Routes normalize via enforcementModeField
    // before it reaches here — anything else persists NULL (unreported).
    enforcement_mode: orNull(data.enforcement_mode),
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
      containment_status, containment_ref,
      act_content_hash, created_by, harness_session_id, subagent_uuid,
      enforcement_mode, close_source, approval_expires_at, identity_verified, payload_signature_status, execution_protocol
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
      ${values.containment_ref},
      ${values.act_content_hash},
      ${values.created_by},
      ${values.harness_session_id},
      ${values.subagent_uuid},
      ${values.enforcement_mode},
      ${closeSource},
      ${approvalExpiresAt},
      ${payload.identityVerified ?? null},
      ${payload.payloadSignatureStatus ?? 'unknown'},
      ${Array.isArray(payload.data.client_capabilities) && payload.data.client_capabilities.includes('execution_claims') ? 1 : null}
    )
    RETURNING *
  `;

  // G4 metering: every persisted action bumps the org's monthly rollup here,
  // in the single funnel both creation paths share (POST /api/actions and
  // guard ?record=true), so the counters cannot drift between paths.
  // incrementUsageRollup swallows its own failures — metering never breaks
  // the governance write.
  await incrementUsageRollup(sql, orgId, { blocked: actionStatus === 'blocked' });

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
  identityVerified?: boolean | null;
  payloadSignatureStatus?: 'verified' | 'invalid' | 'missing' | 'unknown';
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
    identityVerified: payload.identityVerified,
    payloadSignatureStatus: payload.payloadSignatureStatus,
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
    action: { ...action, context: redactAny(parseJsonColumn(guardDecision?.context), []), provenance: actionProvenance(action) },
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

/**
 * Batched read of guard-decision contexts for one page of action rows.
 *
 * The plain-language translator needs `context.intel` for every pending
 * approval, but `listActions` deliberately does not join guard_decisions —
 * widening that shared query would cost every other caller. One extra
 * indexed lookup per page is cheaper and touches nothing else.
 *
 * Returns a map of guard_decision_id -> parsed context. Rows whose context
 * will not parse are omitted; the caller degrades to an untranslated card.
 *
 * The decision's `reason` rides along as the additive `_gating_reason` sibling
 * (same underscore convention as the other server-set context siblings). Until
 * 2026-09-05 the gating reason was written to guard_decisions and then shown
 * only in chat alerts and the /decisions ledger — never on /approvals, where
 * `action.reasoning` is the AGENT's self-report, not why the guard held it. It
 * is the same column, on the same indexed lookup, so no extra round trip.
 */
export async function getGuardContextsByIds(
  sql: SqlClient,
  orgId: string,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, Record<string, unknown>>();
  if (unique.length === 0) return out;

  const rows = await sql`
    SELECT id, context, reason
    FROM guard_decisions
    WHERE org_id = ${orgId} AND id = ANY(${unique})
  `;

  for (const row of rows) {
    const parsed = parseJsonColumn(row.context);
    if (parsed && typeof parsed === 'object') {
      out.set(String(row.id), {
        ...(parsed as Record<string, unknown>),
        _gating_reason: typeof row.reason === 'string' && row.reason ? row.reason : null,
      });
    }
  }
  return out;
}

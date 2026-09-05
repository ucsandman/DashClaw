import { OUTCOME_FIELDS } from '../validate.js';
import { boundedIdText, type Row, type SqlClient } from './actions.repository.shared';

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

  // Lifecycle reconciliation: the two closure paths were only symmetric in one
  // direction. A terminal PATCH implicitly advances `outcome_status`
  // (updateActionOutcomeViaTaggedSql), but a terminal outcome POST used to
  // leave the lifecycle `status` at 'running' forever — and neither sweep
  // UPDATE can heal that row, because both gate on `outcome_status` still
  // being 'pending' / 'lost_confirmation'. The decision then rendered
  // "RUNNING" beside a "Completed" outcome badge, counted as in-flight in the
  // ops stats, and tripped the doctor's zombie-running check. Mirrors the
  // sweep's reconciliation: only a still-open lifecycle flips, so an
  // already-terminal status and 'pending_approval' (owned by the approvals
  // expiry sweep) are never clobbered. 'partial' maps to 'failed' for the same
  // reason the PATCH direction maps cancelled/blocked to a failed outcome —
  // the action did not successfully complete. The nuance stays visible: the
  // outcome badge still reads "Partial".
  const lifecycleStatus =
    status === 'completed' ? 'completed'
      : status === 'lost_confirmation' ? 'unknown'
        : 'failed';
  // Sent as a bound parameter, not a SQL expression: `timestamp_end` is TEXT
  // in the drizzle schema but timestamptz on some migrated instances, and an
  // untyped parameter resolves against whichever the column actually is.
  const closedAt = new Date().toISOString();

  const updated = await sql`
    UPDATE action_records
    SET outcome_status   = ${status},
        outcome_at       = NOW(),
        outcome_summary  = ${summary},
        outcome_error    = ${error_message},
        outcome_progress = ${progressJson}::jsonb,
        status           = CASE WHEN status IS NULL OR status IN ('running', 'pending')
                                THEN ${lifecycleStatus} ELSE status END,
        timestamp_end    = COALESCE(timestamp_end, ${closedAt}),
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
 * reconciles every row already stuck at status='running' with a terminal
 * outcome_status — whether it was swept to lost_confirmation before the
 * reconciliation above existed, or reported completed/partial/failed through
 * POST /api/actions/:id/outcome before setActionOutcome closed the lifecycle.
 * The primary UPDATE's outcome_status='pending' gate can never reach them.
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
  // Backfill: rows whose outcome is already terminal but whose lifecycle still
  // claims 'running' / 'pending'. Two populations land here — rows swept to
  // lost_confirmation before the reconciliation above existed, and rows that
  // reported completed/partial/failed through POST /api/actions/:id/outcome
  // before setActionOutcome closed the lifecycle. Neither is reachable by the
  // primary UPDATE (its outcome_status='pending' gate can never match them
  // again), so this is their only heal path. Count-only — any signal/webhook
  // for these rows already fired when the outcome landed.
  try {
    const backfilled = await sql`
      UPDATE action_records
      SET status = CASE WHEN outcome_status = 'completed' THEN 'completed'
                        WHEN outcome_status IN ('partial', 'failed') THEN 'failed'
                        ELSE 'unknown' END,
          error_message = CASE WHEN outcome_status = 'lost_confirmation'
                               THEN COALESCE(error_message, 'Outcome never reported — reconciled to unknown by the stale-outcome sweep')
                               ELSE error_message END,
          updated_at = CURRENT_TIMESTAMP
      WHERE org_id = ${orgId}
        AND outcome_status IN ('completed', 'partial', 'failed', 'lost_confirmation')
        AND (status IS NULL OR status IN ('running', 'pending'))
      RETURNING action_id
    `;
    if (backfilled.length > 0) {
      console.warn(`[OUTCOME SWEEP] reconciled ${backfilled.length} zombie running/pending row(s) whose outcome was already terminal (org ${orgId})`);
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

// Dynamic import to avoid an import cycle (outcome-timeout -> settings.repository).
async function resolveOutcomeTimeoutMinutes(sql: SqlClient, orgId: string): Promise<number> {
  const { getOutcomeTimeoutMinutes } = await import('../outcome-timeout');
  return getOutcomeTimeoutMinutes(sql, orgId);
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

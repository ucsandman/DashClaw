/**
 * Repository for the calibrated interruption controller's durable state
 * (guard_calibration_state — one row per org) and its adjudication event
 * ledger (guard_calibration_events — the labeled feedback stream, so the
 * controller's own adaptations are auditable and its state rebuildable).
 *
 * Schema ships in drizzle/0059_calibration_controller.sql; the ensure
 * function mirrors it (the settings-table pattern) so fresh installs and
 * legacy self-hosts that haven't migrated yet both work: writers call
 * ensure, readers tolerate a missing table (42P01 → no state).
 */
import type { SqlTag } from '../types/db';
import type { CalibrationState } from '../guard/calibration';
import { coerceCalibrationState, freshCalibrationState } from '../guard/calibration';

export async function ensureCalibrationTables(sql: SqlTag): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS guard_calibration_state (
      org_id text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS guard_calibration_events (
      id serial PRIMARY KEY,
      org_id text NOT NULL,
      action_id text,
      agent_id text,
      risk_score real,
      theta_before real,
      theta_after real,
      label text NOT NULL,
      loss integer NOT NULL,
      source text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_gcal_events_org_created
      ON guard_calibration_events (org_id, created_at)
  `;
}

const isMissingTable = (err: unknown): boolean =>
  (err as { code?: string })?.code === '42P01' ||
  /does not exist/i.test((err as Error)?.message ?? '');

/** Load the org's controller state; null when none exists yet (or pre-migration). */
export async function getCalibrationState(sql: SqlTag, orgId: string): Promise<CalibrationState | null> {
  try {
    const rows = await sql`
      SELECT state FROM guard_calibration_state WHERE org_id = ${orgId}
    `;
    if (rows.length === 0) return null;
    let raw: unknown = rows[0]?.state;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }
    return coerceCalibrationState(raw);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Upsert the org's controller state (write path — ensures tables first).
 *
 * `expectedPrevState` opts into optimistic CAS: pass the state exactly as
 * read by a prior `getCalibrationState` call (or `null` when none existed
 * yet) and the write only lands if the row still matches it. Returns
 * `false` on a lost race so the caller can re-read, re-fold, and retry
 * instead of the two-writer blind-overwrite that used to silently drop one
 * adjudication (calibration-feedback.ts's read-modify-write had no guard —
 * two approvals resolved a few hundred ms apart could each read theta,
 * fold their own adjudication, and the second write clobbered the first).
 *
 * Omit the 4th arg for the pre-existing blind-upsert behavior (single-writer
 * human resets: resetAgentAlarm / resetCalibrationState below) — always
 * returns `true`.
 */
export async function saveCalibrationState(
  sql: SqlTag,
  orgId: string,
  state: CalibrationState,
  expectedPrevState?: CalibrationState | null,
): Promise<boolean> {
  await ensureCalibrationTables(sql);
  if (expectedPrevState === undefined) {
    await sql`
      INSERT INTO guard_calibration_state (org_id, state, updated_at)
      VALUES (${orgId}, ${JSON.stringify(state)}, NOW())
      ON CONFLICT (org_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
    `;
    return true;
  }
  if (expectedPrevState === null) {
    // No row read a moment ago — only insert if one still doesn't exist.
    // A conflict here means a concurrent first-writer beat us to it.
    const rows = await sql`
      INSERT INTO guard_calibration_state (org_id, state, updated_at)
      VALUES (${orgId}, ${JSON.stringify(state)}, NOW())
      ON CONFLICT (org_id) DO NOTHING
      RETURNING org_id
    `;
    return rows.length > 0;
  }
  // jsonb `=` compares parsed values (key order and number formatting are
  // insignificant), so this matches regardless of how the row round-tripped
  // through coerceCalibrationState.
  const rows = await sql`
    UPDATE guard_calibration_state
    SET state = ${JSON.stringify(state)}, updated_at = NOW()
    WHERE org_id = ${orgId} AND state = ${JSON.stringify(expectedPrevState)}::jsonb
    RETURNING org_id
  `;
  return rows.length > 0;
}

export interface CalibrationEventInsert {
  actionId: string | null;
  agentId: string | null;
  riskScore: number;
  thetaBefore: number;
  thetaAfter: number;
  label: string;
  loss: number;
  source: string;
}

export async function insertCalibrationEvent(sql: SqlTag, orgId: string, ev: CalibrationEventInsert): Promise<void> {
  await sql`
    INSERT INTO guard_calibration_events
      (org_id, action_id, agent_id, risk_score, theta_before, theta_after, label, loss, source)
    VALUES
      (${orgId}, ${ev.actionId}, ${ev.agentId}, ${ev.riskScore}, ${ev.thetaBefore}, ${ev.thetaAfter}, ${ev.label}, ${ev.loss}, ${ev.source})
  `;
}

/** Batched event insert (bulk approval floods) — chunked multi-row VALUES. */
export async function insertCalibrationEvents(sql: SqlTag, orgId: string, events: CalibrationEventInsert[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const rows = chunk.map((ev) => {
      const base = params.length;
      params.push(orgId, ev.actionId, ev.agentId, ev.riskScore, ev.thetaBefore, ev.thetaAfter, ev.label, ev.loss, ev.source);
      return `(${Array.from({ length: 9 }, (_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    await sql.query(
      `INSERT INTO guard_calibration_events
         (org_id, action_id, agent_id, risk_score, theta_before, theta_after, label, loss, source)
       VALUES ${rows.join(', ')}`,
      params,
    );
  }
}

export interface CalibrationEventRow {
  action_id: string | null;
  agent_id: string | null;
  risk_score: number;
  theta_before: number;
  theta_after: number;
  label: string;
  loss: number;
  /** 'approval' | 'bulk_approval' | 'seed' | 'warn_review' — provenance of the verdict. */
  source: string;
  created_at: string;
}

/** Recent adjudication events, newest first (operator page series + audit). */
export async function listCalibrationEvents(sql: SqlTag, orgId: string, limit = 200): Promise<CalibrationEventRow[]> {
  const capped = Math.max(1, Math.min(Math.round(limit) || 200, 1000));
  try {
    const rows = await sql`
      SELECT action_id, agent_id, risk_score, theta_before, theta_after, label, loss, source, created_at
      FROM guard_calibration_events
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${capped}
    `;
    return rows.map((r) => ({
      action_id: (r.action_id as string | null) ?? null,
      agent_id: (r.agent_id as string | null) ?? null,
      risk_score: Number(r.risk_score) || 0,
      theta_before: Number(r.theta_before) || 0,
      theta_after: Number(r.theta_after) || 0,
      label: String(r.label ?? ''),
      loss: Number(r.loss) || 0,
      source: String(r.source ?? ''),
      created_at: String(r.created_at ?? ''),
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Human reset of an agent's standing alarm (audit-logged by the route). */
export async function resetAgentAlarm(sql: SqlTag, orgId: string, agentId: string): Promise<boolean> {
  const state = await getCalibrationState(sql, orgId);
  if (!state || !state.agents[agentId]) return false;
  const next = {
    ...state,
    agents: {
      ...state.agents,
      [agentId]: { ...state.agents[agentId]!, e: 1, alarmed_at: null },
    },
  };
  await saveCalibrationState(sql, orgId, next);
  return true;
}

/** Human reset of the calibrated threshold back to its starting point. */
export async function resetCalibrationState(sql: SqlTag, orgId: string): Promise<void> {
  await saveCalibrationState(sql, orgId, freshCalibrationState());
}

import type { SqlTag } from '../types/db';
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../calibration-mining.js';
import { SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES } from '../silent-lane-witness';

export {
  SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES,
  SILENT_LANE_WITNESS_MIN_WINDOW_MINUTES,
  SILENT_LANE_WITNESS_MAX_WINDOW_MINUTES,
  getWitnessWindowMinutes,
  deriveSilentLaneWitnessState,
  type SilentLaneWitnessState,
  type AgentLaneWitness,
} from '../silent-lane-witness';

/**
 * v8.3 silent-lane witness (docs/plans/2026-08-06-silent-lane-witness-spec.md,
 * MoltFire incident, maintainer log 2026-08-06).
 *
 * Activity evidence: action_records rows whose action_type marks a
 * self-report channel. Today that is exactly `agent_turn`, the row
 * `dashclaw codex notify` mints per Codex turn (cli/lib/codex/notify.js) —
 * the maintainer log confirms this is the actual queryable signature
 * ("I drove a live gateway turn and watched it land in the hosted ledger as
 * an `agent_turn`"). The client also sends a `metadata.source: 'codex-notify'`
 * field, but action_records has no metadata column and
 * createActionInsertValues (actions.repository.ts) never persists it — so
 * ACTIVITY_ACTION_TYPE_SOURCES keys off action_type (what is actually
 * durable) and maps it to the human-readable source label the spec and the
 * /setup panel want to show.
 *
 * Governance witness: guard_decisions rows for the agent, UNION action_records
 * rows the agent produced that carry a guard_decision_id (hook-attributed /
 * evaluated rows — stamped by ?record=true always, POST /api/actions
 * optionally). enforcement_liveness_runs is deliberately NOT joined here: that
 * table has no agent_id column (it is one instance-wide probe run, not
 * per-agent evidence), so folding it in would clear every agent's alarm state
 * whenever the unrelated synthetic probe ran — exactly defeating the incident
 * this feature exists to catch.
 *
 * CRITICAL: guard_decisions.created_at is TEXT on fresh schemas — every
 * comparison casts ::timestamptz (see self-governance.repository.ts, the
 * same known drift class). action_records.created_at is already a real
 * timestamp column; the cast there is a defensive no-op, not a fix.
 */

const ACTIVITY_ACTION_TYPE_SOURCES: Record<string, string> = {
  agent_turn: 'codex-notify',
};
const ACTIVITY_ACTION_TYPES = Object.keys(ACTIVITY_ACTION_TYPE_SOURCES);

interface AgentLaneWitnessRow {
  agent_id: unknown;
  last_activity_at: unknown;
  last_activity_type: unknown;
  last_witness_at: unknown;
  [k: string]: unknown;
}

export interface AgentLaneWitnessAggregate {
  agentId: string;
  lastActivityAt: string | null;
  lastActivitySource: string | null;
  lastWitnessAt: string | null;
}

/**
 * Per-agent activity/witness aggregate over the trailing window. One SQL
 * query, FULL OUTER JOIN of the two evidence sources — same shape as
 * getAgentCoverage (coverage.repository.ts). Returns only agents with at
 * least one row in either source; an agent absent from the result has no
 * evidence at all in the window (the pure derivation reads that as 'quiet').
 */
export async function getAgentLaneWitness(
  sql: SqlTag,
  orgId: string,
  windowMinutes: number = SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES,
  { includeSynthetic = false }: { includeSynthetic?: boolean } = {},
): Promise<AgentLaneWitnessAggregate[]> {
  const mins = Math.max(1, Math.floor(Number(windowMinutes)) || SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES);
  const agentPatterns = includeSynthetic ? [] : SYNTHETIC_AGENT_LIKE_PATTERNS;
  const typePatterns = includeSynthetic ? [] : SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS;

  const rows = await sql`
    WITH activity AS (
      SELECT DISTINCT ON (agent_id)
        agent_id,
        created_at::timestamptz AS last_activity_at,
        action_type AS last_activity_type
      FROM action_records
      WHERE org_id = ${orgId}
        AND action_type = ANY(${ACTIVITY_ACTION_TYPES}::text[])
        AND created_at::timestamptz > NOW() - make_interval(mins => ${mins})
        AND agent_id NOT LIKE ALL(${agentPatterns}::text[])
      ORDER BY agent_id, created_at DESC
    ),
    witness AS (
      SELECT agent_id, MAX(witnessed_at) AS last_witness_at FROM (
        SELECT agent_id, created_at::timestamptz AS witnessed_at
        FROM guard_decisions
        WHERE org_id = ${orgId}
          AND agent_id IS NOT NULL
          AND created_at::timestamptz > NOW() - make_interval(mins => ${mins})
          AND agent_id NOT LIKE ALL(${agentPatterns}::text[])
          AND (action_type IS NULL OR action_type NOT LIKE ALL(${typePatterns}::text[]))
        UNION ALL
        SELECT agent_id, created_at::timestamptz AS witnessed_at
        FROM action_records
        WHERE org_id = ${orgId}
          AND guard_decision_id IS NOT NULL
          AND created_at::timestamptz > NOW() - make_interval(mins => ${mins})
          AND agent_id NOT LIKE ALL(${agentPatterns}::text[])
          AND (action_type IS NULL OR action_type NOT LIKE ALL(${typePatterns}::text[]))
      ) w
      GROUP BY agent_id
    )
    SELECT
      COALESCE(a.agent_id, w.agent_id) AS agent_id,
      a.last_activity_at,
      a.last_activity_type,
      w.last_witness_at
    FROM activity a
    FULL OUTER JOIN witness w ON a.agent_id = w.agent_id
  `;

  return (rows as AgentLaneWitnessRow[])
    .map((r): AgentLaneWitnessAggregate => {
      const activityType = r.last_activity_type ? String(r.last_activity_type) : null;
      return {
        agentId: String(r.agent_id ?? ''),
        lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at as string).toISOString() : null,
        lastActivitySource: activityType ? (ACTIVITY_ACTION_TYPE_SOURCES[activityType] ?? activityType) : null,
        lastWitnessAt: r.last_witness_at ? new Date(r.last_witness_at as string).toISOString() : null,
      };
    })
    .filter((a) => a.agentId !== '');
}

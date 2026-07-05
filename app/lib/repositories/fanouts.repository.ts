/**
 * Fanouts repository — v4.3 fleet attribution
 * (docs/superpowers/specs/2026-07-04-fleet-attribution.md, verdict 5).
 *
 * getRecentFanouts groups a rolling window of action_records by
 * harness_session_id into one "fan-out" unit per harness session: the parent
 * agent, the agents involved, spawn/action counts, and first/last activity.
 * Powers GET /api/agents/fanouts and the /agents Fan-outs panel.
 *
 * Synthetic verification families are excluded (shared LIKE patterns from
 * calibration-mining.js, same NOT LIKE ALL shape as coverage.repository.ts).
 *
 * linked_leaf_count is the spec's read-time lineage join:
 *   leaf.subagent_uuid = spawn.outcome_progress->>'spawned_agent_uuid'
 * scoped inside one harness_session_id. The PATCH path persists ONLY that one
 * outcome_metadata key into the outcome_progress jsonb (see
 * updateActionOutcome's spawnedAgentUuid option); every other outcome_metadata
 * key stays dropped as before.
 *
 * PG numeric gotcha: COUNT/aggregates come back as strings over the Neon HTTP
 * driver, so every count is Number()-coerced before it leaves the repository.
 */

import type { SqlTag } from '../types/db';
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../calibration-mining.js';

export interface FanoutSummary {
  /** The harness session uuid this fan-out is grouped on. */
  harness_session_id: string;
  /** Base agent id (before the ':' composed suffix) of the most frequent agent in the session. */
  parent_agent_id: string;
  /** Distinct agent_ids (parent + composed leaves) that acted in the session. */
  agents: string[];
  /** Count of distinct agent_ids. */
  agent_count: number;
  /** Count of orchestration (spawn) actions in the session. */
  spawn_count: number;
  /** Total action rows in the session. */
  action_count: number;
  /** Leaves whose subagent_uuid matches a spawn row's outcome_progress->>'spawned_agent_uuid' in the same session. */
  linked_leaf_count: number;
  /** ISO timestamp of the earliest action in the session. */
  first_at: string;
  /** ISO timestamp of the latest action in the session. */
  last_at: string;
}

interface FanoutAggRow {
  harness_session_id: unknown;
  parent_agent_id: unknown;
  agents: unknown;
  agent_count: unknown;
  spawn_count: unknown;
  action_count: unknown;
  linked_leaf_count: unknown;
  first_at: unknown;
  last_at: unknown;
  [k: string]: unknown;
}

function toIso(value: unknown): string {
  if (value == null) return '';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export interface GetRecentFanoutsOptions {
  windowHours?: number;
  limit?: number;
  /** Diagnostic view (?include_synthetic=1, U2/V2 precedent): lets smoke prove
   *  the grouping/join math; real views and the /agents panel never set it. */
  includeSynthetic?: boolean;
}

/**
 * Recent multi-agent harness sessions, newest-first. Excludes rows with no
 * harness_session_id and synthetic verification families.
 */
export async function getRecentFanouts(
  sql: SqlTag,
  orgId: string,
  { windowHours = 24, limit = 20, includeSynthetic = false }: GetRecentFanoutsOptions = {},
): Promise<FanoutSummary[]> {
  const hours = Math.max(1, Math.min(Math.floor(Number(windowHours) || 24), 168));
  const lim = Math.max(1, Math.min(Math.floor(Number(limit) || 20), 100));
  // Empty pattern arrays make NOT LIKE ALL vacuously true (coverage.repository
  // precedent), so the diagnostic view reuses the same query shape.
  const agentPatterns = includeSynthetic ? [] : SYNTHETIC_AGENT_LIKE_PATTERNS;
  const typePatterns = includeSynthetic ? [] : SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS;

  const rows = await sql`
    WITH scoped AS (
      SELECT harness_session_id, agent_id, action_type, subagent_uuid,
             outcome_progress->>'spawned_agent_uuid' AS spawned_agent_uuid,
             created_at::timestamptz AS created_ts
      FROM action_records
      WHERE org_id = ${orgId}
        AND harness_session_id IS NOT NULL
        AND created_at::timestamptz > NOW() - make_interval(hours => ${hours})
        AND (agent_id IS NULL OR agent_id NOT LIKE ALL(${agentPatterns}::text[]))
        AND (action_type IS NULL OR action_type NOT LIKE ALL(${typePatterns}::text[]))
    ),
    grouped AS (
      SELECT
        harness_session_id,
        -- Parent = the base id (before the composed ':' suffix) of the session's
        -- most frequent agent_id. mode() ignores NULLs.
        split_part(mode() WITHIN GROUP (ORDER BY agent_id), ':', 1) AS parent_agent_id,
        array_agg(DISTINCT agent_id) FILTER (WHERE agent_id IS NOT NULL)          AS agents,
        COUNT(DISTINCT agent_id)                                                  AS agent_count,
        COUNT(*) FILTER (WHERE action_type = 'orchestration')                     AS spawn_count,
        COUNT(*)                                                                  AS action_count,
        MIN(created_ts)                                                           AS first_at,
        MAX(created_ts)                                                           AS last_at
      FROM scoped
      GROUP BY harness_session_id
    ),
    -- The read-time lineage join (spec verdict 2c): a leaf is "linked" when its
    -- subagent_uuid matches a spawn row's persisted spawned_agent_uuid inside
    -- the same harness session.
    linked AS (
      SELECT l.harness_session_id,
             COUNT(*) AS linked_leaf_count
      FROM scoped l
      WHERE l.subagent_uuid IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM scoped s
          WHERE s.harness_session_id = l.harness_session_id
            AND s.spawned_agent_uuid = l.subagent_uuid
        )
      GROUP BY l.harness_session_id
    )
    SELECT
      g.harness_session_id, g.parent_agent_id, g.agents, g.agent_count,
      g.spawn_count, g.action_count,
      COALESCE(li.linked_leaf_count, 0) AS linked_leaf_count,
      g.first_at, g.last_at
    FROM grouped g
    LEFT JOIN linked li ON li.harness_session_id = g.harness_session_id
    ORDER BY g.last_at DESC
    LIMIT ${lim}
  `;

  return (rows as FanoutAggRow[])
    .map((r): FanoutSummary => ({
      harness_session_id: String(r.harness_session_id ?? ''),
      parent_agent_id: String(r.parent_agent_id ?? ''),
      agents: Array.isArray(r.agents) ? (r.agents as unknown[]).map((a) => String(a)) : [],
      // PG numeric gotcha: COUNT returns strings over the Neon HTTP driver.
      agent_count: Number(r.agent_count) || 0,
      spawn_count: Number(r.spawn_count) || 0,
      action_count: Number(r.action_count) || 0,
      linked_leaf_count: Number(r.linked_leaf_count) || 0,
      first_at: toIso(r.first_at),
      last_at: toIso(r.last_at),
    }))
    .filter((f) => f.harness_session_id !== '');
}

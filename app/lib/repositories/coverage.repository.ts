/**
 * Coverage repository — v4.2 coverage truth
 * (docs/superpowers/specs/2026-07-04-coverage-truth.md).
 *
 * Two responsibilities:
 *   1. insertCoverageReport — append one Stop-hook per-turn expected-vs-recorded
 *      report (record coverage evidence).
 *   2. getAgentCoverage — per-agent aggregate of both coverage dimensions:
 *        - record coverage: sum(recorded)/sum(expected) over the window, from
 *          coverage_reports (client transcript ground truth).
 *        - outcome coverage: outcome/(outcome+stop_autoclose) over the window,
 *          from action_records.close_source ('direct' rows excluded — those
 *          never transitioned through a close). Server-side, harness-agnostic.
 *
 * Synthetic verification families are excluded from aggregates (shared patterns
 * from calibration-mining.js). PG numeric gotcha: SUM/COUNT come back as strings
 * over the Neon HTTP driver, so every aggregate is Number()-coerced before math.
 */

import { randomUUID } from 'node:crypto';
import type { SqlTag } from '../types/db';
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../calibration-mining.js';

export interface InsertCoverageReportInput {
  orgId: string;
  agentId: string;
  harness?: string | null;
  harnessSessionId?: string | null;
  expected: number;
  recorded: number;
}

/** Append one coverage report. id is generated (`cov_` prefix). */
export async function insertCoverageReport(
  sql: SqlTag,
  input: InsertCoverageReportInput,
): Promise<Record<string, unknown> | null> {
  const { orgId, agentId, harness = null, harnessSessionId = null, expected, recorded } = input;
  const id = `cov_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const rows = await sql`
    INSERT INTO coverage_reports (id, org_id, agent_id, harness, harness_session_id, expected, recorded)
    VALUES (${id}, ${orgId}, ${agentId}, ${harness ?? null}, ${harnessSessionId ?? null}, ${expected}, ${recorded})
    RETURNING id, org_id, agent_id, harness, harness_session_id, expected, recorded, created_at
  `;
  return (rows as Record<string, unknown>[])[0] || null;
}

export interface AgentCoverage {
  agentId: string;
  /** Raw sum of expected governed tool_use blocks over the window (0 if no reports). */
  expected: number;
  /** Raw sum of recorded actions over the window (0 if no reports). May exceed expected. */
  recorded: number;
  /** 0-100 record coverage, or null when the agent has no coverage reports in the window. */
  recordPct: number | null;
  /** 0-100 outcome coverage, or null when the agent has no hook-recorded closes in the window. */
  outcomePct: number | null;
  /** Hook-recorded closes counted for outcomePct (outcome + stop_autoclose); the min-sample gate. */
  outcomeSample: number;
}

interface CoverageAggRow {
  agent_id: unknown;
  expected: unknown;
  recorded: unknown;
  outcome_closes: unknown;
  autoclose_closes: unknown;
  [k: string]: unknown;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Per-agent coverage aggregate over a rolling window (default 24h). One SQL
 * query: a FULL OUTER JOIN of the two evidence sources so an agent with reports
 * but no hook closes (or vice versa) still appears with the null side. Returns
 * only agents that carry at least one evidence row — an agent absent from the
 * result has no coverage evidence at all (the "no evidence" render state).
 */
export async function getAgentCoverage(
  sql: SqlTag,
  orgId: string,
  windowHours = 24,
  { includeSynthetic = false }: { includeSynthetic?: boolean } = {},
): Promise<AgentCoverage[]> {
  const hours = Math.max(1, Math.min(Math.floor(Number(windowHours) || 24), 168));
  // Diagnostic view (?include_synthetic=1, U2/U3 precedent): empty pattern
  // arrays make NOT LIKE ALL vacuously true, so synthetic rows pass through
  // without a second query shape.
  const agentPatterns = includeSynthetic ? [] : SYNTHETIC_AGENT_LIKE_PATTERNS;
  const typePatterns = includeSynthetic ? [] : SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS;
  const rows = await sql`
    WITH reports AS (
      SELECT agent_id,
             SUM(expected)::bigint AS expected,
             SUM(recorded)::bigint AS recorded
      FROM coverage_reports
      WHERE org_id = ${orgId}
        AND created_at > NOW() - make_interval(hours => ${hours})
        AND agent_id NOT LIKE ALL(${agentPatterns}::text[])
      GROUP BY agent_id
    ),
    closes AS (
      SELECT agent_id,
             COUNT(*) FILTER (WHERE close_source = 'outcome')::bigint        AS outcome_closes,
             COUNT(*) FILTER (WHERE close_source = 'stop_autoclose')::bigint AS autoclose_closes
      FROM action_records
      WHERE org_id = ${orgId}
        AND close_source IN ('outcome', 'stop_autoclose')
        AND created_at::timestamptz > NOW() - make_interval(hours => ${hours})
        AND (agent_id IS NULL OR agent_id NOT LIKE ALL(${agentPatterns}::text[]))
        AND (action_type IS NULL OR action_type NOT LIKE ALL(${typePatterns}::text[]))
      GROUP BY agent_id
    )
    SELECT
      COALESCE(r.agent_id, c.agent_id) AS agent_id,
      r.expected,
      r.recorded,
      c.outcome_closes,
      c.autoclose_closes
    FROM reports r
    FULL OUTER JOIN closes c ON r.agent_id = c.agent_id
  `;

  return (rows as CoverageAggRow[])
    .map((r): AgentCoverage => {
      // PG numeric gotcha: SUM/COUNT return strings over the Neon HTTP driver.
      const expected = Number(r.expected) || 0;
      const recorded = Number(r.recorded) || 0;
      const outcomeCloses = Number(r.outcome_closes) || 0;
      const autoCloses = Number(r.autoclose_closes) || 0;
      const outcomeSample = outcomeCloses + autoCloses;
      return {
        agentId: String(r.agent_id ?? ''),
        expected,
        recorded,
        // null when there are no reports — absence of evidence must not read as 100%.
        recordPct: expected > 0 ? clampPct(Math.round((recorded / expected) * 100)) : null,
        // null when there are no hook-recorded closes.
        outcomePct: outcomeSample > 0 ? clampPct(Math.round((outcomeCloses / outcomeSample) * 100)) : null,
        outcomeSample,
      };
    })
    .filter((a) => a.agentId !== '');
}

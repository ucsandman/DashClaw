import type { SqlTag } from '../types/db';
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../calibration-mining.js';

/**
 * v7.3 self-governance proof surface: instance-wide, aggregate-only evidence
 * that this instance governs real work. Consumed by GET /api/self-governance
 * (public, but 404 unless DASHCLAW_SELF_GOVERNANCE_PUBLIC — only the instance
 * governing this repo's maintenance opts in).
 *
 * Exposure boundary (spec: docs/superpowers/specs/2026-07-05-self-governance-proof-v73.md):
 * no org identifiers and no free-text columns ever leave the instance. The only
 * strings in the result are ISO timestamps; byDecision keys are fixed literals,
 * so an unexpected decision value simply isn't counted out.
 */

export interface SelfGovernanceStats {
  actions: {
    total: number;
    last30d: number;
    last7d: number;
    firstAt: string | null;
    latestAt: string | null;
    activeDays: number;
  };
  decisions: {
    total: number;
    last30d: number;
    byDecision: { allow: number; warn: number; block: number; require_approval: number };
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(value as string | Date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function getSelfGovernanceStats(sql: SqlTag): Promise<SelfGovernanceStats> {
  // created_at casts ::timestamptz throughout: guard_decisions.created_at is
  // TEXT on fresh schemas (known drift class), and the cast is harmless on the
  // legacy timestamp shape. Counts cast ::int and are Number()-wrapped because
  // pg returns numerics as strings. Synthetic verification families
  // (smoke/loadtest/liveproof, shared patterns) are excluded like every other
  // real-traffic aggregate — the proof page counts real governance only.
  const agentPatterns = SYNTHETIC_AGENT_LIKE_PATTERNS;
  const typePatterns = SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS;
  const [actionRows, decisionRows] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at::timestamptz >= NOW() - INTERVAL '30 days')::int AS last30d,
        COUNT(*) FILTER (WHERE created_at::timestamptz >= NOW() - INTERVAL '7 days')::int AS last7d,
        MIN(created_at::timestamptz) AS first_at,
        MAX(created_at::timestamptz) AS latest_at,
        COUNT(DISTINCT (created_at::timestamptz)::date)::int AS active_days
      FROM action_records
      WHERE (agent_id IS NULL OR agent_id NOT LIKE ALL(${agentPatterns}::text[]))
        AND (action_type IS NULL OR action_type NOT LIKE ALL(${typePatterns}::text[]))
    `,
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at::timestamptz >= NOW() - INTERVAL '30 days')::int AS last30d,
        COUNT(*) FILTER (WHERE decision = 'allow')::int AS allow_count,
        COUNT(*) FILTER (WHERE decision = 'warn')::int AS warn_count,
        COUNT(*) FILTER (WHERE decision = 'block')::int AS block_count,
        COUNT(*) FILTER (WHERE decision = 'require_approval')::int AS require_approval_count
      FROM guard_decisions
      WHERE (agent_id IS NULL OR agent_id NOT LIKE ALL(${agentPatterns}::text[]))
        AND (action_type IS NULL OR action_type NOT LIKE ALL(${typePatterns}::text[]))
    `,
  ]);
  const a: Record<string, unknown> = actionRows[0] ?? {};
  const d: Record<string, unknown> = decisionRows[0] ?? {};
  return {
    actions: {
      total: Number(a.total ?? 0),
      last30d: Number(a.last30d ?? 0),
      last7d: Number(a.last7d ?? 0),
      firstAt: toIso(a.first_at),
      latestAt: toIso(a.latest_at),
      activeDays: Number(a.active_days ?? 0),
    },
    decisions: {
      total: Number(d.total ?? 0),
      last30d: Number(d.last30d ?? 0),
      byDecision: {
        allow: Number(d.allow_count ?? 0),
        warn: Number(d.warn_count ?? 0),
        block: Number(d.block_count ?? 0),
        require_approval: Number(d.require_approval_count ?? 0),
      },
    },
  };
}

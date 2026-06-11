// app/lib/repositories/policy-review.repository.ts
// Review-feed data access: warn decisions grouped by shape + recent interrupts.
// Pure grouping logic is exported separately so it can be unit-tested without SQL.

import type { SqlTag } from '../types/db';
import { extractDecisionShape, type ActionShape } from '../policy-shapes';

const WARN_SCAN_LIMIT = 500;

export interface WarnGroup {
  shape: ActionShape;
  count: number;
  latest_at: string;
  sample_id: string;
  sample_goal: string | null;
}

export async function getWarnDecisionsSince(
  sql: SqlTag,
  orgId: string,
  sinceIso: string,
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id, action_type, context, reason, created_at
    FROM guard_decisions
    WHERE org_id = ${orgId} AND decision = 'warn' AND created_at::timestamptz > ${sinceIso}
    ORDER BY created_at DESC
    LIMIT ${WARN_SCAN_LIMIT}
  `;
}

export async function getRecentInterrupts(
  sql: SqlTag,
  orgId: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id, agent_id, agent_name, action_type, decision, reason, risk_score, created_at
    FROM guard_decisions
    WHERE org_id = ${orgId} AND decision IN ('require_approval', 'block')
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

/**
 * Normalize a Postgres timestamp value to an ISO-8601 string.
 * - Date instance  → .toISOString()
 * - Postgres space-format '2026-06-10 01:00:00' (bare UTC, no zone suffix) →
 *   replace the space with 'T' and append 'Z' so lexicographic comparison
 *   against ISO dismissal stamps is correct.
 * - Already-ISO strings / anything else → returned as-is.
 * - null / undefined / empty → ''.
 */
export function toIso(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  if (s === '') return '';
  // Postgres space-format without a zone suffix: 'YYYY-MM-DD HH:MM:SS[.mmm]'
  if (/^\d{4}-\d{2}-\d{2} /.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}/.test(s)) {
    return s.replace(' ', 'T') + 'Z';
  }
  return s;
}

/** Pure: group warn rows by shape, drop shapes dismissed after their latest row. */
export function groupWarnDecisions(
  rows: Array<Record<string, unknown>>,
  dismissed: Record<string, string>,
): WarnGroup[] {
  const groups = new Map<string, WarnGroup>();
  for (const row of rows) {
    const shape = extractDecisionShape(row);
    const createdAt = toIso(row.created_at);
    const existing = groups.get(shape.key);
    if (existing) {
      existing.count += 1;
      if (createdAt > existing.latest_at) existing.latest_at = createdAt;
    } else {
      let goal: string | null = null;
      if (typeof row.context === 'string') {
        try {
          const ctx = JSON.parse(row.context) as { declared_goal?: unknown };
          if (typeof ctx.declared_goal === 'string') goal = ctx.declared_goal;
        } catch { /* sample goal is best-effort */ }
      }
      groups.set(shape.key, {
        shape,
        count: 1,
        latest_at: createdAt,
        sample_id: String(row.id ?? ''),
        sample_goal: goal,
      });
    }
  }
  return [...groups.values()]
    .filter((g) => {
      const dismissedAt = dismissed[g.shape.key];
      return !dismissedAt || g.latest_at > dismissedAt;
    })
    .sort((a, b) => b.count - a.count);
}

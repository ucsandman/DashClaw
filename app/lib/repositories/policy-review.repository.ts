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
    WHERE org_id = ${orgId} AND decision = 'warn' AND created_at > ${sinceIso}
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

/** Pure: group warn rows by shape, drop shapes dismissed after their latest row. */
export function groupWarnDecisions(
  rows: Array<Record<string, unknown>>,
  dismissed: Record<string, string>,
): WarnGroup[] {
  const groups = new Map<string, WarnGroup>();
  for (const row of rows) {
    const shape = extractDecisionShape(row);
    const createdAt = String(row.created_at ?? '');
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

import { randomUUID } from 'crypto';
import type { SqlTag } from '../types/db';

/**
 * v3.4 live-host canary runs (docs/superpowers/plans/2026-07-04-live-host-canary.md).
 *
 * Verdicts reported by scripts/live-canary.mjs (hourly GitHub Actions cron)
 * via POST /api/live-canary. Stored in their own table — never
 * action_records/guard_decisions — so the canary's synthetic traffic is
 * structurally excluded from posture and calibration mining (the v3.1 bar).
 */

export interface LiveCanaryCheck {
  id: string;
  title: string;
  status: 'pass' | 'fail';
  detail?: string;
  durationMs?: number;
  target?: string;
}

export interface LiveCanaryRun {
  id: string;
  org_id: string;
  source: string;
  status: 'pass' | 'fail';
  checks: LiveCanaryCheck[];
  started_at: string;
  finished_at: string;
  created_at: string;
}

export interface LiveCanaryRunInput {
  source: string;
  status: 'pass' | 'fail';
  checks: LiveCanaryCheck[];
  startedAt: string;
  finishedAt: string;
}

/**
 * Insert a run and prune this org's runs past the retention window in the
 * same call — the canary reports hourly, so retention rides along instead
 * of needing its own cron.
 */
export async function insertLiveCanaryRun(
  sql: SqlTag,
  orgId: string,
  run: LiveCanaryRunInput,
): Promise<{ id: string }> {
  const id = `lcr_${randomUUID()}`;
  await sql`
    INSERT INTO live_canary_runs (id, org_id, source, status, checks, started_at, finished_at)
    VALUES (${id}, ${orgId}, ${run.source}, ${run.status}, ${JSON.stringify(run.checks)}, ${run.startedAt}, ${run.finishedAt})
  `;
  await sql`
    DELETE FROM live_canary_runs
    WHERE org_id = ${orgId} AND created_at < now() - interval '14 days'
  `;
  return { id };
}

export async function getLatestLiveCanaryRunForOrg(
  sql: SqlTag,
  orgId: string,
): Promise<LiveCanaryRun | null> {
  const rows = await sql`
    SELECT id, org_id, source, status, checks, started_at, finished_at, created_at
    FROM live_canary_runs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as LiveCanaryRun | undefined) ?? null;
}

export async function listLiveCanaryRunsForOrg(
  sql: SqlTag,
  orgId: string,
  limit: number,
): Promise<LiveCanaryRun[]> {
  const rows = await sql`
    SELECT id, org_id, source, status, checks, started_at, finished_at, created_at
    FROM live_canary_runs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as LiveCanaryRun[];
}

/**
 * The org whose runs the PUBLIC /setup surface renders. Check titles/details
 * are free text from whoever holds an API key, so the public page must only
 * ever display runs filed by the operator's own canary — never an
 * instance-wide latest, which on a multi-tenant host would let any trial
 * tenant plant arbitrary text on the shared unauthenticated page
 * (2026-07-04 security review, HIGH). Tenants' own runs stay visible to
 * them via the org-scoped GET and posture finding.
 */
export function canaryDisplayOrgId(env: Record<string, string | undefined> = process.env): string {
  return env.DASHCLAW_CANARY_ORG_ID || 'org_default';
}

import { randomUUID } from 'crypto';
import type { SqlTag } from '../types/db';

export {
  ENFORCEMENT_LIVENESS_STALE_MS,
  deriveEnforcementLivenessState,
  deriveFleetEnforcementLiveness,
  type EnforcementLivenessState,
  type EnforcementLivenessSeam,
  type FleetEnforcementLiveness,
} from '../enforcement-liveness';

/**
 * v8.2 enforcement liveness (docs/plans/owner-roadmap.md §v8.2).
 *
 * Verdicts reported by hooks/enforcement_liveness_probe.py, an external
 * probe that drives a synthetic action through the DashClaw pretool hook
 * seam via POST /api/enforcement-liveness. Stored in their own table —
 * never action_records/guard_decisions — so the probe's synthetic traffic
 * is structurally excluded from posture/calibration/funnel mining (the
 * v3.4 live-canary precedent).
 */

export interface EnforcementLivenessCheck {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'info';
  detail?: string;
  durationMs?: number;
}

export interface EnforcementLivenessHook {
  installed: boolean;
  settings_path?: string;
  timeout_seconds?: number;
  effective_timer_ms?: number;
  overflowed?: boolean;
  mode?: string;
  exit_code?: number | null;
  cancelled?: boolean;
}

export interface EnforcementLivenessWitness {
  path: string;
  executed: boolean;
}

export interface EnforcementLivenessRun {
  id: string;
  org_id: string;
  source: string;
  /** Which seam reported: 'claude-code' | 'codex' | 'unknown' (drizzle/0072). */
  runtime: string;
  verdict: 'held' | 'executed' | 'unprovable';
  detail: string;
  hook: EnforcementLivenessHook;
  witness: EnforcementLivenessWitness;
  decision: string | null;
  checks: EnforcementLivenessCheck[];
  started_at: string;
  finished_at: string;
  created_at: string;
}

export interface EnforcementLivenessRunInput {
  source: string;
  runtime: string;
  verdict: 'held' | 'executed' | 'unprovable';
  detail: string;
  hook: EnforcementLivenessHook;
  witness: EnforcementLivenessWitness;
  decision: string | null;
  checks: EnforcementLivenessCheck[];
  startedAt: string;
  finishedAt: string;
}

/**
 * Insert a run and prune this org's runs past the retention window in the
 * same call — the probe reports per-session, so retention rides along
 * instead of needing its own cron (live-canary precedent).
 */
export async function insertEnforcementLivenessRun(
  sql: SqlTag,
  orgId: string,
  run: EnforcementLivenessRunInput,
): Promise<{ id: string }> {
  const id = `elr_${randomUUID()}`;
  await sql`
    INSERT INTO enforcement_liveness_runs
      (id, org_id, source, runtime, verdict, detail, hook, witness, decision, checks, started_at, finished_at)
    VALUES (${id}, ${orgId}, ${run.source}, ${run.runtime}, ${run.verdict}, ${run.detail}, ${JSON.stringify(run.hook)},
      ${JSON.stringify(run.witness)}, ${run.decision}, ${JSON.stringify(run.checks)}, ${run.startedAt}, ${run.finishedAt})
  `;
  await sql`
    DELETE FROM enforcement_liveness_runs
    WHERE org_id = ${orgId} AND created_at < now() - interval '30 days'
  `;
  return { id };
}

export async function getLatestEnforcementLivenessRunForOrg(
  sql: SqlTag,
  orgId: string,
): Promise<EnforcementLivenessRun | null> {
  const rows = await sql`
    SELECT id, org_id, source, runtime, verdict, detail, hook, witness, decision, checks, started_at, finished_at, created_at
    FROM enforcement_liveness_runs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as EnforcementLivenessRun | undefined) ?? null;
}

/**
 * The latest run for EACH seam (drizzle/0072) — the read the fleet rollup needs.
 *
 * `getLatestEnforcementLivenessRunForOrg` above returns the single newest row
 * across all seams, which is exactly what let a healthy Claude Code run mask a
 * dead Codex one. Prefer this for any "is enforcement still on?" question; the
 * single-row read remains only for showing the most recent probe's own detail.
 */
export async function listLatestEnforcementLivenessRunPerRuntime(
  sql: SqlTag,
  orgId: string,
): Promise<EnforcementLivenessRun[]> {
  const rows = await sql`
    SELECT DISTINCT ON (runtime)
      id, org_id, source, runtime, verdict, detail, hook, witness, decision, checks, started_at, finished_at, created_at
    FROM enforcement_liveness_runs
    WHERE org_id = ${orgId}
    ORDER BY runtime, created_at DESC
  `;
  return rows as unknown as EnforcementLivenessRun[];
}

export async function listEnforcementLivenessRunsForOrg(
  sql: SqlTag,
  orgId: string,
  limit: number,
): Promise<EnforcementLivenessRun[]> {
  const rows = await sql`
    SELECT id, org_id, source, verdict, detail, hook, witness, decision, checks, started_at, finished_at, created_at
    FROM enforcement_liveness_runs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as EnforcementLivenessRun[];
}

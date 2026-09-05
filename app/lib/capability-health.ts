import { isLegacyActionRecordsError } from './capability-compat';
import type { SqlTag } from './types/db';

type Row = Record<string, unknown>;

/** A capability row as read from the DB; shape is dynamic so fields stay loose. */
interface Capability {
  capability_id?: unknown;
  name?: unknown;
  slug: string;
  category?: unknown;
  risk_level?: unknown;
  health_status?: string;
  invocation_schema?: { circuit_breaker?: CircuitBreakerConfig | null } | null;
  [key: string]: unknown;
}

interface CircuitBreakerConfig {
  enabled?: boolean;
  consecutive_failures?: number;
  [key: string]: unknown;
}

interface LatestTest {
  action_id?: unknown;
  status?: string;
  timestamp_start?: unknown;
  duration_ms?: unknown;
  output_summary?: unknown;
  error_message?: unknown;
  [key: string]: unknown;
}

export interface CapabilityHealthSummary {
  status: string;
  certification_status: string;
  last_checked_at: string;
  last_success_at: unknown;
  last_failure_at: unknown;
  last_tested_at: unknown;
  last_test_status: string | null;
  last_test_action_id: unknown;
  last_test_duration_ms: number | null;
  last_test_summary: unknown;
  stale_check: boolean;
  total_invocations: number;
  successful_invocations: number;
  failed_invocations: number;
  pending_approvals: number;
  success_rate_1d: number;
  success_rate_7d: number;
  p95_latency_ms: number | null;
  recent_errors: Array<{ message: unknown; timestamp: unknown }>;
}

function toInt(value: unknown): number {
  return parseInt((value as string) || '0', 10);
}

function deriveStatus(capabilityHealthStatus: string | undefined, stats: Row): string {
  const total = toInt(stats.total_invocations);
  const successful = toInt(stats.successful_invocations);
  const failed = toInt(stats.failed_invocations);
  const pending = toInt(stats.pending_approvals);

  if (total === 0) {
    return capabilityHealthStatus && capabilityHealthStatus !== 'unknown'
      ? capabilityHealthStatus
      : 'untested';
  }

  if (failed > 0 && successful === 0) {
    return 'failing';
  }

  if (failed > 0 || pending > 0) {
    return 'degraded';
  }

  return 'healthy';
}

function deriveCertificationStatus(latestTest: LatestTest | null): string {
  if (!latestTest) return 'uncertified';
  if (latestTest.status === 'completed') {
    const lastTestedAt = latestTest.timestamp_start ? new Date(latestTest.timestamp_start as string).getTime() : 0;
    const ageMs = Date.now() - lastTestedAt;
    return ageMs > 30 * 24 * 60 * 60 * 1000 ? 'stale' : 'certified';
  }
  if (latestTest.status === 'failed') return 'failed';
  return 'uncertified';
}

function deriveStaleCheck(latestTest: LatestTest | null): boolean {
  if (!latestTest) return true;
  if (latestTest.status !== 'completed') return true;
  const lastTestedAt = latestTest.timestamp_start ? new Date(latestTest.timestamp_start as string).getTime() : 0;
  return Date.now() - lastTestedAt > 30 * 24 * 60 * 60 * 1000;
}

async function getCapabilityHealthSummaryLegacy(
  sql: SqlTag,
  orgId: string,
  capability: Capability,
): Promise<CapabilityHealthSummary> {
  const systemsTouched = JSON.stringify([`capability:${capability.slug}`]);
  const [statsRows, testRows] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int as total_invocations,
        COUNT(*) FILTER (WHERE status = 'completed')::int as successful_invocations,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed_invocations,
        COUNT(*) FILTER (WHERE status = 'pending_approval')::int as pending_approvals,
        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day'
        )::int as total_invocations_1d,
        COUNT(*) FILTER (
          WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '1 day'
        )::int as successful_invocations_1d,
        MAX(CASE WHEN status = 'completed' THEN created_at END) as last_success_at,
        MAX(CASE WHEN status = 'failed' THEN created_at END) as last_failure_at
      FROM action_records
      WHERE org_id = ${orgId}
        AND action_type = 'capability_invoke'
        AND systems_touched = ${systemsTouched}
        AND created_at >= NOW() - INTERVAL '7 days'
    `,
    sql`
      SELECT action_id, status, created_at as timestamp_start
      FROM action_records
      WHERE org_id = ${orgId}
        AND action_type = 'capability_test'
        AND systems_touched = ${systemsTouched}
      ORDER BY created_at DESC
      LIMIT 1
    `,
  ]);

  const stats: Row = statsRows[0] || {};
  const latestTest: LatestTest | null = (testRows[0] as LatestTest | undefined) || null;
  const totalInvocations = toInt(stats.total_invocations);
  const successfulInvocations = toInt(stats.successful_invocations);
  const failedInvocations = toInt(stats.failed_invocations);
  const pendingApprovals = toInt(stats.pending_approvals);
  const totalInvocations1d = toInt(stats.total_invocations_1d);
  const successfulInvocations1d = toInt(stats.successful_invocations_1d);

  return {
    status: deriveStatus(capability.health_status, stats),
    certification_status: deriveCertificationStatus(latestTest),
    last_checked_at: new Date().toISOString(),
    last_success_at: stats.last_success_at || null,
    last_failure_at: stats.last_failure_at || null,
    last_tested_at: latestTest?.timestamp_start || null,
    last_test_status: (latestTest?.status as string | undefined) || null,
    last_test_action_id: latestTest?.action_id || null,
    last_test_duration_ms: null,
    last_test_summary: null,
    stale_check: deriveStaleCheck(latestTest),
    total_invocations: totalInvocations,
    successful_invocations: successfulInvocations,
    failed_invocations: failedInvocations,
    pending_approvals: pendingApprovals,
    success_rate_1d: totalInvocations1d > 0
      ? Math.round((successfulInvocations1d / totalInvocations1d) * 100)
      : 0,
    success_rate_7d: totalInvocations > 0
      ? Math.round((successfulInvocations / totalInvocations) * 100)
      : 0,
    p95_latency_ms: null,
    recent_errors: [],
  };
}

export async function getCapabilityHealthSummary(
  sql: SqlTag,
  orgId: string,
  capability: Capability,
): Promise<CapabilityHealthSummary> {
  const systemsTouched = JSON.stringify([`capability:${capability.slug}`]);
  let statsRows: Row[];
  let errorRows: Row[];
  let testRows: Row[];

  try {
    [statsRows, errorRows, testRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int as total_invocations,
          COUNT(*) FILTER (WHERE status = 'completed')::int as successful_invocations,
          COUNT(*) FILTER (WHERE status = 'failed')::int as failed_invocations,
          COUNT(*) FILTER (WHERE status = 'pending_approval')::int as pending_approvals,
          COUNT(*) FILTER (
            WHERE timestamp_start::timestamptz >= NOW() - INTERVAL '1 day'
          )::int as total_invocations_1d,
          COUNT(*) FILTER (
            WHERE status = 'completed' AND timestamp_start::timestamptz >= NOW() - INTERVAL '1 day'
          )::int as successful_invocations_1d,
          MAX(CASE WHEN status = 'completed' THEN timestamp_start::timestamptz END) as last_success_at,
          MAX(CASE WHEN status = 'failed' THEN timestamp_start::timestamptz END) as last_failure_at,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
            FILTER (WHERE duration_ms IS NOT NULL AND duration_ms > 0) as p95_latency_ms
        FROM action_records
        WHERE org_id = ${orgId}
          AND action_type = 'capability_invoke'
          AND systems_touched = ${systemsTouched}
          AND timestamp_start::timestamptz >= NOW() - INTERVAL '7 days'
      `,
      sql`
        SELECT error_message, timestamp_start
        FROM action_records
        WHERE org_id = ${orgId}
          AND action_type = 'capability_invoke'
          AND systems_touched = ${systemsTouched}
          AND status = 'failed'
          AND error_message IS NOT NULL
        ORDER BY timestamp_start::timestamptz DESC
        LIMIT 5
      `,
      sql`
        SELECT action_id, status, timestamp_start, duration_ms, output_summary, error_message
        FROM action_records
        WHERE org_id = ${orgId}
          AND action_type = 'capability_test'
          AND systems_touched = ${systemsTouched}
        ORDER BY timestamp_start::timestamptz DESC
        LIMIT 1
      `,
    ]);
  } catch (error) {
    if (!isLegacyActionRecordsError(error as { code?: unknown; message?: unknown; detail?: unknown })) {
      throw error;
    }
    return getCapabilityHealthSummaryLegacy(sql, orgId, capability);
  }

  const stats: Row = statsRows[0] || {};
  const latestTest: LatestTest | null = (testRows[0] as LatestTest | undefined) || null;
  const totalInvocations = toInt(stats.total_invocations);
  const successfulInvocations = toInt(stats.successful_invocations);
  const failedInvocations = toInt(stats.failed_invocations);
  const pendingApprovals = toInt(stats.pending_approvals);
  const totalInvocations1d = toInt(stats.total_invocations_1d);
  const successfulInvocations1d = toInt(stats.successful_invocations_1d);

  return {
    status: deriveStatus(capability.health_status, stats),
    certification_status: deriveCertificationStatus(latestTest),
    last_checked_at: new Date().toISOString(),
    last_success_at: stats.last_success_at || null,
    last_failure_at: stats.last_failure_at || null,
    last_tested_at: latestTest?.timestamp_start || null,
    last_test_status: (latestTest?.status as string | undefined) || null,
    last_test_action_id: latestTest?.action_id || null,
    last_test_duration_ms: latestTest?.duration_ms != null ? toInt(latestTest.duration_ms) : null,
    last_test_summary: latestTest?.output_summary || latestTest?.error_message || null,
    stale_check: deriveStaleCheck(latestTest),
    total_invocations: totalInvocations,
    successful_invocations: successfulInvocations,
    failed_invocations: failedInvocations,
    pending_approvals: pendingApprovals,
    success_rate_1d: totalInvocations1d > 0
      ? Math.round((successfulInvocations1d / totalInvocations1d) * 100)
      : 0,
    success_rate_7d: totalInvocations > 0
      ? Math.round((successfulInvocations / totalInvocations) * 100)
      : 0,
    p95_latency_ms: stats.p95_latency_ms != null ? Math.round(Number(stats.p95_latency_ms)) : null,
    recent_errors: errorRows.map((row) => ({
      message: row.error_message,
      timestamp: row.timestamp_start,
    })),
  };
}

export interface CircuitBreakerResult {
  open: boolean;
  consecutive_failures?: number;
}

export async function checkCircuitBreaker(
  sql: SqlTag,
  orgId: string,
  capability: Capability,
): Promise<CircuitBreakerResult> {
  const cb = capability.invocation_schema?.circuit_breaker;
  if (!cb || !cb.enabled) {
    return { open: false };
  }

  if (capability.health_status === 'healthy') {
    return { open: false };
  }

  const threshold = cb.consecutive_failures || 5;
  const systemsTouched = JSON.stringify([`capability:${capability.slug}`]);

  const rows = await sql`
    SELECT status FROM action_records
    WHERE org_id = ${orgId}
      AND action_type = 'capability_invoke'
      AND systems_touched = ${systemsTouched}
    ORDER BY timestamp_start DESC
    LIMIT ${threshold}
  `;

  if (rows.length < threshold) {
    return { open: false };
  }

  const allFailed = rows.every((row) => row.status === 'failed');
  if (allFailed) {
    return { open: true, consecutive_failures: threshold };
  }

  return { open: false };
}

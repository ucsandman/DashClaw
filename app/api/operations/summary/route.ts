export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    // Each query is individually resilient — a single failing query won't break the whole card
    const safe = (promise: Promise<Record<string, unknown>[]>): Promise<Record<string, unknown>[]> =>
      promise.catch(() => [{} as Record<string, unknown>]);

    const [throughput, latency, approvalBacklog, workflowHealth, capHealth] = await Promise.all([
      // Decision throughput
      safe(sql`
        SELECT
          COUNT(*) FILTER (WHERE timestamp_start::timestamptz > NOW() - INTERVAL '1 hour')::int AS last_1h,
          COUNT(*) FILTER (WHERE timestamp_start::timestamptz > NOW() - INTERVAL '24 hours')::int AS last_24h
        FROM action_records
        WHERE org_id = ${orgId}
          AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      `),

      // Decision latency — true percentiles (the labels are p50/p95). Previously this
      // returned AVG as "p50" and MAX as "p95", so the UI's "Latency p95" was actually
      // the single slowest outlier (e.g. 393s vs a real p95 of ~47s). PERCENTILE_CONT is
      // standard Postgres/Neon; the whole query stays wrapped in safe() so any config that
      // rejected it degrades to 0 rather than breaking the card.
      safe(sql`
        SELECT
          COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p50,
          COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95
        FROM action_records
        WHERE org_id = ${orgId}
          AND status = 'completed'
          AND duration_ms IS NOT NULL
          AND duration_ms > 0
          AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      `),

      // Approval backlog. avg_wait_minutes must average the elapsed time, NOT the
      // timestamps: Postgres has no avg(timestamptz), so AVG(timestamp_start::timestamptz)
      // threw at plan time and safe() swallowed the whole query — silently zeroing
      // pending_count/oldest_minutes/avg_wait_minutes regardless of real backlog.
      safe(sql`
        SELECT
          COUNT(*)::int AS pending_count,
          COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(timestamp_start::timestamptz))) / 60, 0)::int AS oldest_minutes,
          COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - timestamp_start::timestamptz))) / 60, 0)::int AS avg_wait_minutes
        FROM action_records
        WHERE org_id = ${orgId}
          AND status = 'pending_approval'
      `),

      // Workflow health (last 24h)
      safe(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'running')::int AS running,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_24h,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_24h,
          COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed' AND duration_ms > 0), 0)::int AS avg_duration_ms
        FROM action_records
        WHERE org_id = ${orgId}
          AND action_type = 'workflow_execute'
          AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      `),

      // Capability health counts. The buckets must PARTITION every row so the
      // "Capabilities X/Y" denominator (healthy+degraded+failing+untested) equals COUNT(*).
      // 'unknown' = never-invoked capabilities; the canonical deriveStatus() (capability-health.ts)
      // and the Capabilities page call these UNTESTED (neutral), NOT degraded — so they get their
      // own bucket and are excluded from degraded, keeping all three surfaces consistent.
      safe(sql`
        SELECT
          COUNT(*) FILTER (WHERE health_status = 'healthy' OR health_status IS NULL)::int AS healthy,
          COUNT(*) FILTER (WHERE health_status = 'failing')::int AS failing,
          COUNT(*) FILTER (WHERE health_status = 'unknown')::int AS untested,
          COUNT(*) FILTER (WHERE health_status IS NOT NULL AND health_status NOT IN ('healthy', 'failing', 'unknown'))::int AS degraded
        FROM capabilities
        WHERE org_id = ${orgId}
      `),
    ]);

    return NextResponse.json({
      throughput: {
        last_1h: throughput[0]?.last_1h || 0,
        last_24h: throughput[0]?.last_24h || 0,
      },
      latency: {
        p50_ms: latency[0]?.p50 || 0,
        p95_ms: latency[0]?.p95 || 0,
      },
      approval_backlog: {
        pending_count: approvalBacklog[0]?.pending_count || 0,
        oldest_minutes: approvalBacklog[0]?.oldest_minutes || 0,
        avg_wait_minutes: approvalBacklog[0]?.avg_wait_minutes || 0,
      },
      workflows: {
        running: workflowHealth[0]?.running || 0,
        failed_24h: workflowHealth[0]?.failed_24h || 0,
        completed_24h: workflowHealth[0]?.completed_24h || 0,
        avg_duration_ms: workflowHealth[0]?.avg_duration_ms || 0,
      },
      capabilities: {
        healthy: capHealth[0]?.healthy || 0,
        degraded: capHealth[0]?.degraded || 0,
        failing: capHealth[0]?.failing || 0,
        untested: capHealth[0]?.untested || 0,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, 'OPERATIONS_SUMMARY');
  }
}

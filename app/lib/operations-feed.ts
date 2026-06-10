/**
 * Operations feed aggregation.
 * Pure mapper functions normalize items from 6 data sources into a unified feed.
 */

import { computeSignals } from './signals.js';
import { getCachedIntegrationHealth } from './integration-health.js';
import { signalDismissKey } from './signal-hash.js';
import type { SqlTag } from './types/db';

export const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Loose row shapes — these come from raw SQL reads / external sources.
type Row = Record<string, any>;

export interface FeedItem {
  id: string;
  category: string;
  severity: string;
  title: string;
  detail: string;
  source: string;
  source_id: string | null;
  agent_id: string | null;
  timestamp: string | null;
  action_url: string;
  suggested_action: string;
  metadata?: Record<string, unknown>;
  /** Per-instance dismissal key (signal items only) so the client can hide signals
   *  dismissed in posture, keeping the feed and the "active signals" count in sync. */
  dismiss_key?: string | null;
}

// ─── Mappers ───────────────────────────────────────────────────

export function mapApprovals(actions: Row[] | null | undefined): FeedItem[] {
  return (actions || []).map((a) => ({
    id: `approval:${a.action_id}`,
    category: 'approval',
    severity: (a.risk_score || 0) >= 70 ? 'high' : 'medium',
    title: `Awaiting approval: ${a.declared_goal || a.action_type || 'Unknown action'}`,
    detail: [
      a.agent_id && `agent: ${a.agent_id}`,
      a.risk_score != null && `risk: ${a.risk_score}`,
      a.systems_touched && `systems: ${a.systems_touched}`,
    ].filter(Boolean).join(', '),
    source: 'action',
    source_id: a.action_id,
    agent_id: a.agent_id || null,
    timestamp: a.timestamp_start || a.created_at || null,
    action_url: `/decisions/${a.action_id}`,
    suggested_action: 'approve',
  }));
}

export function mapFailures(actions: Row[] | null | undefined): FeedItem[] {
  // Count failures per agent to detect repeated failures
  const agentFailureCounts: Record<string, number> = {};
  for (const a of (actions || [])) {
    const id = a.agent_id || 'unknown';
    agentFailureCounts[id] = (agentFailureCounts[id] || 0) + 1;
  }

  return (actions || []).map((a) => {
    const agentCount = agentFailureCounts[a.agent_id || 'unknown'] || 1;
    const isWorkflowRun = typeof a.trigger === 'string' && a.trigger.startsWith('workflow:');
    return {
      id: `failure:${a.action_id}`,
      category: 'failure',
      severity: agentCount >= 3 ? 'high' : 'medium',
      title: `Failed: ${a.declared_goal || a.action_type || 'Unknown action'}`,
      detail: [
        a.error_message,
        a.agent_id && `agent: ${a.agent_id}`,
        a.duration_ms != null && `${a.duration_ms}ms`,
      ].filter(Boolean).join(', '),
      source: 'action',
      source_id: a.action_id,
      agent_id: a.agent_id || null,
      timestamp: a.timestamp_start || a.created_at || null,
      action_url: `/decisions/${a.action_id}`,
      suggested_action: isWorkflowRun ? 'retry' : 'investigate',
      ...(isWorkflowRun ? { metadata: { template_id: a.trigger.slice('workflow:'.length), run_action_id: a.action_id } } : {}),
    };
  });
}

export function mapSignals(signals: Row[] | null | undefined): FeedItem[] {
  return (signals || []).map((s) => ({
    id: `signal:${s.type || s.signal_type}:${s.agent_id || 'system'}:${s.action_id || s.loop_id || s.assumption_id || ''}`,
    category: 'signal',
    severity: s.severity === 'red' ? 'critical' : 'high',
    title: s.label || `${s.type || s.signal_type}: ${s.agent_id || 'system'}`,
    detail: s.detail || '',
    source: 'signal',
    source_id: s.action_id || s.loop_id || s.assumption_id || null,
    dismiss_key: signalDismissKey(s),
    agent_id: s.agent_id || null,
    timestamp: s.detected_at || null,
    action_url: s.agent_id ? `/agents/${encodeURIComponent(s.agent_id)}` : '/security',
    suggested_action: s.type === 'integration_mismatch' ? 'disable' : s.type === 'workflow_stuck' ? 'cancel' : 'investigate',
    ...(s.type === 'workflow_stuck' && s.action_id ? {
      metadata: {
        run_action_id: s.action_id,
        template_id: (s.trigger && s.trigger.startsWith('workflow:')) ? s.trigger.slice('workflow:'.length) : null,
      },
    } : {}),
  }));
}

export function mapCapabilityHealth(capabilities: Row[] | null | undefined): FeedItem[] {
  return (capabilities || [])
    .filter((c) => c.status === 'failing' || c.status === 'degraded')
    .map((c) => ({
      id: `cap_health:${c.capability_id}`,
      category: 'health',
      severity: c.status === 'failing' ? 'critical' : 'high',
      title: `Capability ${c.name}: ${c.status}`,
      detail: [
        c.success_rate_1d != null && `success rate: ${Math.round(c.success_rate_1d * 100)}%`,
        c.recent_errors?.length && `${c.recent_errors.length} recent errors`,
      ].filter(Boolean).join(', '),
      source: 'capability',
      source_id: c.capability_id,
      agent_id: null,
      timestamp: c.last_invocation || null,
      action_url: `/capabilities/${c.capability_id}`,
      suggested_action: c.status === 'failing' ? 'disable' : 'investigate',
      metadata: { capability_id: c.capability_id },
    }));
}

export function mapIntegrationHealth(healthMap: Record<string, Row> | null | undefined): FeedItem[] {
  return Object.entries(healthMap || {})
    .filter(([, h]) => h.status === 'error' || h.status === 'degraded')
    .map(([provider, h]) => ({
      id: `int_health:${provider}`,
      category: 'health',
      severity: h.status === 'error' ? 'high' : 'medium',
      title: `Integration ${provider}: ${h.status}`,
      detail: h.message || '',
      source: 'integration',
      source_id: provider,
      agent_id: null,
      timestamp: h.checked_at || null,
      action_url: '/integrations',
      suggested_action: 'investigate',
    }));
}

export function mapStaleLoops(loops: Row[] | null | undefined): FeedItem[] {
  return (loops || []).map((l) => ({
    id: `stale_loop:${l.loop_id}`,
    category: 'stale',
    severity: 'medium',
    title: `Stale dependency: ${l.description || l.loop_type || 'Open loop'}`,
    detail: [
      l.loop_type && `type: ${l.loop_type}`,
      l.priority && `priority: ${l.priority}`,
    ].filter(Boolean).join(', '),
    source: 'loop',
    source_id: l.loop_id,
    agent_id: l.agent_id || null,
    timestamp: l.created_at || null,
    action_url: l.action_id ? `/decisions/${l.action_id}` : '/dashboard',
    suggested_action: 'investigate',
  }));
}

// ─── Orchestrator ──────────────────────────────────────────────

export interface OperationsFeedFilters {
  category?: string;
  severity?: string;
  agent_id?: string;
  limit?: number | string;
  offset?: number | string;
}

export interface OperationsFeedResult {
  items: FeedItem[];
  counts: Record<string, number>;
}

export async function buildOperationsFeed(
  sql: SqlTag,
  orgId: string,
  filters: OperationsFeedFilters = {},
): Promise<OperationsFeedResult> {
  const { category, severity, agent_id: agentId, limit = 50, offset = 0 } = filters;
  const parsedLimit = Math.min(parseInt(String(limit), 10) || 50, 200);
  const parsedOffset = parseInt(String(offset), 10) || 0;

  // Fetch all data sources in parallel. When agentId is set, scope agent-
  // owned sources (approvals, failures, signals, stale loops) to that agent.
  // Capability + integration health remain system-wide since they aren't
  // per-agent.
  const [pendingRows, failedRows, signalResult, capHealthRows, integrationHealth, staleLoopRows] = await Promise.all([
    agentId
      ? sql`
          SELECT action_id, agent_id, declared_goal, risk_score, systems_touched, timestamp_start, created_at
          FROM action_records
          WHERE org_id = ${orgId} AND status = 'pending_approval' AND agent_id = ${agentId}
          ORDER BY timestamp_start::timestamptz DESC
          LIMIT 50
        `
      : sql`
          SELECT action_id, agent_id, declared_goal, risk_score, systems_touched, timestamp_start, created_at
          FROM action_records
          WHERE org_id = ${orgId} AND status = 'pending_approval'
          ORDER BY timestamp_start::timestamptz DESC
          LIMIT 50
        `,
    agentId
      ? sql`
          SELECT action_id, agent_id, declared_goal, error_message, duration_ms, timestamp_start, created_at, trigger
          FROM action_records
          WHERE org_id = ${orgId} AND status = 'failed' AND agent_id = ${agentId}
            AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
          ORDER BY timestamp_start::timestamptz DESC
          LIMIT 50
        `
      : sql`
          SELECT action_id, agent_id, declared_goal, error_message, duration_ms, timestamp_start, created_at, trigger
          FROM action_records
          WHERE org_id = ${orgId} AND status = 'failed'
            AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
          ORDER BY timestamp_start::timestamptz DESC
          LIMIT 50
        `,
    computeSignals(orgId, agentId || null, sql).catch(() => []),
    sql`
      SELECT capability_id, name, status, success_rate_1d, recent_errors, last_invocation
      FROM (
        SELECT c.capability_id, c.name,
          CASE
            WHEN COUNT(CASE WHEN ar.status = 'failed' THEN 1 END)::float / NULLIF(COUNT(*), 0) > 0.5 THEN 'failing'
            WHEN COUNT(CASE WHEN ar.status = 'failed' THEN 1 END)::float / NULLIF(COUNT(*), 0) > 0.2 THEN 'degraded'
            ELSE 'healthy'
          END AS status,
          1.0 - (COUNT(CASE WHEN ar.status = 'failed' THEN 1 END)::float / NULLIF(COUNT(*), 0)) AS success_rate_1d,
          NULL AS recent_errors,
          MAX(ar.timestamp_start) AS last_invocation
        FROM capabilities c
        LEFT JOIN action_records ar ON ar.systems_touched::text LIKE '%capability:' || c.slug || '%'
          AND ar.org_id = ${orgId}
          AND ar.timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
        WHERE c.org_id = ${orgId}
        GROUP BY c.capability_id, c.name
      ) sub
      WHERE status IN ('failing', 'degraded')
    `.catch(() => []),
    // Cache-only read — the feed request path never awaits live external probes.
    getCachedIntegrationHealth(orgId, sql).catch(() => ({})),
    agentId
      ? sql`
          SELECT ol.loop_id, ol.description, ol.priority, ol.loop_type, ol.created_at, ol.action_id, ar.agent_id
          FROM open_loops ol
          LEFT JOIN action_records ar ON ol.action_id = ar.action_id
          WHERE ol.status = 'open' AND ol.org_id = ${orgId}
            AND ol.created_at < NOW() - INTERVAL '48 hours'
            AND ar.agent_id = ${agentId}
          ORDER BY ol.created_at ASC
          LIMIT 20
        `
      : sql`
          SELECT ol.loop_id, ol.description, ol.priority, ol.loop_type, ol.created_at, ol.action_id, ar.agent_id
          FROM open_loops ol
          LEFT JOIN action_records ar ON ol.action_id = ar.action_id
          WHERE ol.status = 'open' AND ol.org_id = ${orgId}
            AND ol.created_at < NOW() - INTERVAL '48 hours'
          ORDER BY ol.created_at ASC
          LIMIT 20
        `,
  ]);

  // Map all sources to feed items
  const signals = Array.isArray(signalResult) ? signalResult : ((signalResult as Row | null)?.signals || []);
  let allItems: FeedItem[] = [
    ...mapApprovals(pendingRows as Row[]),
    ...mapFailures(failedRows as Row[]),
    ...mapSignals(signals),
    ...mapCapabilityHealth(capHealthRows as Row[]),
    ...mapIntegrationHealth(integrationHealth as Record<string, Row>),
    ...mapStaleLoops(staleLoopRows as Row[]),
  ];

  // Apply filters. When agentId is set, drop items without an owning agent
  // (capability/integration health) so the feed matches the dropdown scope.
  if (agentId) {
    allItems = allItems.filter((item) => item.agent_id === agentId);
  }
  if (category) {
    allItems = allItems.filter((item) => item.category === category);
  }
  if (severity) {
    allItems = allItems.filter((item) => item.severity === severity);
  }

  // Count before pagination
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, total: allItems.length };
  for (const item of allItems) {
    counts[item.severity] = (counts[item.severity] || 0) + 1;
  }

  // Sort: severity rank ASC (critical first), then timestamp DESC (newest first)
  allItems.sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    return (new Date(b.timestamp as string).getTime()) - (new Date(a.timestamp as string).getTime());
  });

  // Paginate
  const items = allItems.slice(parsedOffset, parsedOffset + parsedLimit);

  return { items, counts };
}

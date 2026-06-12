/**
 * Shared signal computation. Extracted from /api/signals/route.js
 * Used by both the API route and the cron job.
 */

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// Each signal is a heterogeneous record; the various signal categories share a
// base shape and add category-specific fields. Kept loose because the consumers
// (UI + notification pipeline) read by name and the union is open-ended.
interface Signal {
  type: string;
  severity: 'red' | 'amber';
  label: string;
  detail: string;
  help: string;
  agent_id?: string | null;
  detected_at?: string | null;
  action_id?: string | null;
  loop_id?: string | null;
  assumption_id?: string | null;
  session_id?: string | null;
  provider?: string | null;
  policy_id?: string | null;
  trigger?: string | null;
}

// DB rows from the various signal queries are dynamic; fields are read by name.
type Row = Record<string, any>;

/**
 * Compute all 18 risk signal types for an org.
 *
 * @param orgId
 * @param filterAgentId - optional agent filter
 * @param sql - neon sql tagged template
 * @returns signals array
 */
export async function computeSignals(
  orgId: string,
  filterAgentId: string | null,
  sql: SqlClient,
): Promise<Signal[]> {
  // Autonomy-spike threshold (decisions/hr) is configurable per org. A fixed
  // low bar is noise on a busy fleet — claude-code alone runs ~280/hr of normal
  // tool-call actions. Default 100; override via the
  // DASHCLAW_AUTONOMY_SPIKE_THRESHOLD org setting. Red fires at 2x the threshold.
  let spikeThreshold = 100;
  try {
    const rows = await sql`
      SELECT value FROM settings
      WHERE org_id = ${orgId} AND key = 'DASHCLAW_AUTONOMY_SPIKE_THRESHOLD' AND agent_id IS NULL
      LIMIT 1
    `;
    const n = Number((rows?.[0] as Row | undefined)?.value);
    if (Number.isFinite(n) && n >= 1) spikeThreshold = Math.floor(n);
  } catch { /* settings table optional; keep default */ }

  // Wave 2 of 2: every remaining query runs in ONE parallel batch (the only
  // real data dependency is spikeThreshold → autonomy-spike HAVING clause,
  // satisfied by wave 1 above). Best-effort categories keep their original
  // failure semantics via per-query catch handlers that resolve to null.
  const warnNull = (label: string) => (e: unknown): null => {
    console.warn(`[signals] ${label} category failed:`, (e as Error)?.message || e);
    return null;
  };

  const [autonomySpikes, highImpact, repeatedFailures, staleLoops, assumptionDrift, staleAssumptions, staleRunning, stalePresence, stuckWorkflows, staleApprovals, connections, health, stalledSessions, recentDecisions, recentMcpDecisions, greenDecisions, driftAlerts] = (await Promise.all([
    sql`
      SELECT agent_id, agent_name, COUNT(*) as action_count,
             MAX(timestamp_start::timestamptz) AS last_seen
      FROM action_records
      WHERE timestamp_start::timestamptz > NOW() - INTERVAL '1 hour'
        AND org_id = ${orgId}
      GROUP BY agent_id, agent_name
      HAVING COUNT(*) > ${spikeThreshold}
      ORDER BY action_count DESC
    `,
    sql`
      SELECT action_id, agent_id, agent_name, declared_goal, risk_score, action_type,
             timestamp_start
      FROM action_records
      WHERE reversible = 0
        AND org_id = ${orgId}
        AND risk_score >= 70
        AND (authorization_scope IS NULL OR authorization_scope = '')
        AND status = 'running'
        AND outcome_status <> 'lost_confirmation'
        AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      ORDER BY risk_score DESC
      LIMIT 10
    `,
    sql`
      SELECT agent_id, agent_name, COUNT(*) as failure_count,
             MAX(timestamp_start::timestamptz) AS last_seen
      FROM action_records
      WHERE status = 'failed'
        AND org_id = ${orgId}
        AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      GROUP BY agent_id, agent_name
      HAVING COUNT(*) > 3
      ORDER BY failure_count DESC
    `,
    sql`
      SELECT ol.loop_id, ol.description, ol.priority, ol.loop_type, ol.created_at,
             ar.agent_id, ar.agent_name, ar.declared_goal
      FROM open_loops ol
      LEFT JOIN action_records ar ON ol.action_id = ar.action_id
      WHERE ol.status = 'open'
        AND ol.org_id = ${orgId}
        AND ol.created_at < NOW() - INTERVAL '48 hours'
      ORDER BY ol.created_at ASC
      LIMIT 10
    `,
    sql`
      SELECT ar.agent_id, ar.agent_name, COUNT(*) as invalidation_count,
             MAX(a.invalidated_at::timestamptz) AS last_seen
      FROM assumptions a
      LEFT JOIN action_records ar ON a.action_id = ar.action_id
      WHERE a.invalidated = 1
        AND a.org_id = ${orgId}
        AND a.invalidated_at IS NOT NULL
        AND a.invalidated_at::timestamptz > NOW() - INTERVAL '7 days'
      GROUP BY ar.agent_id, ar.agent_name
      HAVING COUNT(*) >= 2
      ORDER BY invalidation_count DESC
    `,
    sql`
      SELECT a.assumption_id, a.assumption, a.created_at, a.action_id,
             ar.agent_id, ar.agent_name
      FROM assumptions a
      LEFT JOIN action_records ar ON a.action_id = ar.action_id
      WHERE a.validated = 0
        AND a.org_id = ${orgId}
        AND a.invalidated = 0
        AND a.created_at < NOW() - INTERVAL '14 days'
      ORDER BY a.created_at ASC
      LIMIT 10
    `,
    sql`
      SELECT action_id, agent_id, agent_name, declared_goal, timestamp_start, risk_score
      FROM action_records
      WHERE status = 'running'
        AND org_id = ${orgId}
        AND timestamp_start::timestamptz < NOW() - INTERVAL '4 hours'
        AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
        AND outcome_status <> 'lost_confirmation'
        AND (action_type IS NULL OR action_type <> 'workflow_execute')
      ORDER BY timestamp_start ASC
      LIMIT 10
    `,
    // Stale heartbeat = an agent that recently went quiet (silent 10m..48h).
    // The UPPER bound is load-bearing: agent_presence.status is never reaped
    // back to 'offline', so without it any agent that ran once and stopped fires
    // this signal forever — one-shot test/setup agents end up "lost" for 80 days
    // and bury real incidents. Past 48h an agent is retired/offline, not an
    // active incident, so it is noise, not signal.
    sql`
      SELECT agent_id, agent_name, last_heartbeat_at, current_task_id, status
      FROM agent_presence
      WHERE org_id = ${orgId}
        AND last_heartbeat_at::timestamptz < NOW() - INTERVAL '10 minutes'
        AND last_heartbeat_at::timestamptz > NOW() - INTERVAL '48 hours'
        AND (status != 'offline' OR current_task_id IS NOT NULL)
      LIMIT 10
    `,
    // Workflow executions stuck running for > 30 minutes (but not yet swept as lost)
    sql`
      SELECT action_id, agent_id, agent_name, declared_goal, timestamp_start, duration_ms, trigger
      FROM action_records
      WHERE status = 'running'
        AND org_id = ${orgId}
        AND action_type = 'workflow_execute'
        AND outcome_status <> 'lost_confirmation'
        AND timestamp_start::timestamptz < NOW() - INTERVAL '30 minutes'
        AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      ORDER BY timestamp_start ASC
      LIMIT 10
    `,
    // Pending approvals older than 1 hour
    sql`
      SELECT action_id, agent_id, agent_name, declared_goal, timestamp_start, risk_score
      FROM action_records
      WHERE status = 'pending_approval'
        AND org_id = ${orgId}
        AND timestamp_start::timestamptz < NOW() - INTERVAL '1 hour'
      ORDER BY timestamp_start ASC
      LIMIT 10
    `,
    // Integration mismatch inputs — table may not exist yet; skip silently (null).
    sql`SELECT DISTINCT provider, agent_id FROM agent_connections WHERE org_id = ${orgId} AND status = 'active'`.catch(() => null),
    sql`SELECT provider, status, checked_at FROM integration_health WHERE org_id = ${orgId}`.catch(() => null),
    // Stalled sessions — best-effort, silent on failure.
    sql`
      SELECT id, agent_id, status, last_activity, status_since
      FROM agent_sessions
      WHERE org_id = ${orgId}
        AND status = 'running'
        AND last_activity < NOW() - INTERVAL '2 hours'
        ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
    `.catch(() => null),
    // Guard-decision intel categories — best-effort, warn on failure.
    sql`
      SELECT id, agent_id, context, created_at FROM guard_decisions
      WHERE org_id = ${orgId} AND created_at::timestamptz > NOW() - INTERVAL '1 hour'
      ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
      ORDER BY created_at DESC LIMIT 20
    `.catch(warnNull('branch_stale')),
    sql`
      SELECT id, agent_id, context, created_at FROM guard_decisions
      WHERE org_id = ${orgId} AND created_at::timestamptz > NOW() - INTERVAL '30 minutes'
      ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
      ORDER BY created_at DESC LIMIT 20
    `.catch(warnNull('mcp_degraded')),
    sql`
      SELECT id, agent_id, context, reason, created_at FROM guard_decisions
      WHERE org_id = ${orgId} AND created_at::timestamptz > NOW() - INTERVAL '1 hour'
      AND decision IN ('block', 'warn')
      ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
      ORDER BY created_at DESC LIMIT 10
    `.catch(warnNull('green_insufficient')),
    // Statistical behavioral drift — open warning/critical alerts from the
    // drift engine (app/lib/drift.ts). Best-effort: the tables may not exist
    // on older deploys. Without this query, a critical drift alert was
    // invisible unless someone happened to visit /drift.
    sql`
      SELECT id, agent_id, metric, severity, direction, pct_change, z_score, description, created_at
      FROM drift_alerts
      WHERE org_id = ${orgId} AND acknowledged = FALSE AND severity IN ('warning', 'critical')
        AND created_at::timestamptz > NOW() - INTERVAL '7 days'
        ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
      ORDER BY created_at DESC LIMIT 10
    `.catch(warnNull('drift_alert')),
    // Tuple cast: each Promise.all result is a non-empty Row[] (or null for a
    // failed best-effort query); a plain array type makes destructured
    // positions possibly-undefined under noUncheckedIndexedAccess.
  ])) as [Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[] | null, Row[] | null, Row[] | null, Row[] | null, Row[] | null, Row[] | null, Row[] | null];

  const signals: Signal[] = [];

  for (const presence of stalePresence) {
    const minutesSilent = Math.max(
      10,
      Math.round((Date.now() - new Date(presence.last_heartbeat_at).getTime()) / 60000),
    );
    signals.push({
      type: 'agent_silent',
      severity: presence.current_task_id ? 'red' : 'amber',
      label: `Agent heartbeat lost: ${presence.agent_name || presence.agent_id}`,
      detail: `This agent has not sent a heartbeat for ${minutesSilent} minutes.`,
      help: presence.current_task_id
        ? 'Agent is silent while assigned to an active task. Investigate potential process crash or network failure.'
        : 'Agent heartbeat lost. It may be offline or unable to reach the dashboard.',
      agent_id: presence.agent_id,
      detected_at: presence.last_heartbeat_at,
    });
  }

  for (const spike of autonomySpikes) {
    signals.push({
      type: 'autonomy_spike',
      severity: parseInt(spike.action_count, 10) > spikeThreshold * 2 ? 'red' : 'amber',
      label: `Governance alert: ${spike.agent_name || spike.agent_id} (${spike.action_count} ungoverned decisions/hr)`,
      detail: `This agent made ${spike.action_count} decisions in the last hour without proportional oversight, exceeding the governance threshold of ${spikeThreshold}.`,
      help: 'High decision frequency without oversight may indicate ungoverned autonomy. Review recent decisions and enforce policy throttling.',
      agent_id: spike.agent_id,
      detected_at: spike.last_seen || null,
    });
  }

  for (const action of highImpact) {
    signals.push({
      type: 'high_impact_low_oversight',
      severity: parseInt(action.risk_score, 10) >= 90 ? 'red' : 'amber',
      label: `Ungoverned high-risk decision: ${action.declared_goal?.substring(0, 50) || 'Unknown'}`,
      detail: `${action.agent_name || action.agent_id} is executing an irreversible decision (risk: ${action.risk_score}) without governance authorization.`,
      help: 'High-risk irreversible decisions must have explicit authorization_scope. Enforce policy compliance before execution.',
      agent_id: action.agent_id,
      action_id: action.action_id,
      detected_at: action.timestamp_start,
    });
  }

  for (const fail of repeatedFailures) {
    signals.push({
      type: 'repeated_failures',
      severity: parseInt(fail.failure_count, 10) > 5 ? 'red' : 'amber',
      label: `Decision reliability degraded: ${fail.agent_name || fail.agent_id} (${fail.failure_count} failures in 24h)`,
      detail: `This agent's decision reliability has degraded with ${fail.failure_count} failures in the last 24 hours, exceeding the integrity threshold of 3.`,
      help: 'Repeated decision failures indicate degraded reliability. Review decision rationale and underlying assumptions.',
      agent_id: fail.agent_id,
      detected_at: fail.last_seen || null,
    });
  }

  for (const loop of staleLoops) {
    const hoursOld = Math.round((Date.now() - new Date(loop.created_at).getTime()) / (1000 * 60 * 60));
    signals.push({
      type: 'stale_loop',
      severity: hoursOld > 96 ? 'red' : 'amber',
      label: `Unresolved dependency (${hoursOld}h): ${loop.description?.substring(0, 50) || 'Unknown'}`,
      detail: `Unresolved dependency for ${loop.agent_name || loop.agent_id || 'unknown agent'} has been blocking decision completion for ${hoursOld} hours.`,
      help: 'Unresolved dependencies weaken decision integrity. Resolve or cancel to restore the governance chain.',
      agent_id: loop.agent_id,
      loop_id: loop.loop_id,
      detected_at: loop.created_at,
    });
  }

  for (const drift of assumptionDrift) {
    signals.push({
      type: 'assumption_drift',
      severity: parseInt(drift.invalidation_count, 10) >= 4 ? 'red' : 'amber',
      label: `Decision basis degrading: ${drift.agent_name || drift.agent_id} (${drift.invalidation_count} assumptions invalidated)`,
      detail: `${drift.invalidation_count} assumptions invalidated in the last 7 days, indicating the decision basis for this agent is eroding.`,
      help: 'Frequent assumption invalidations degrade the decision basis. Review and re-validate the foundational assumptions.',
      agent_id: drift.agent_id,
      detected_at: drift.last_seen || null,
    });
  }

  for (const row of driftAlerts || []) {
    const absZ = Math.abs(Number(row.z_score));
    const zPhrase = absZ >= 999 ? 'baseline shows no variance' : `z ${Number(row.z_score)}`;
    signals.push({
      type: 'drift_alert',
      severity: row.severity === 'critical' ? 'red' : 'amber',
      label: `Behavioral drift: ${row.agent_id} ${String(row.metric).replace(/_/g, ' ')} ${row.direction} ${Math.abs(Number(row.pct_change))}%`,
      detail: row.description || `${row.metric} for ${row.agent_id} shifted from its 30-day baseline (${zPhrase}).`,
      help: 'This agent\'s recent behavior deviates statistically from its 30-day baseline. Review the evidence on the Drift page and acknowledge the alert once triaged.',
      agent_id: row.agent_id,
      detected_at: row.created_at,
    });
  }

  for (const asm of staleAssumptions) {
    const daysOld = Math.round((Date.now() - new Date(asm.created_at).getTime()) / (1000 * 60 * 60 * 24));
    signals.push({
      type: 'stale_assumption',
      severity: daysOld > 30 ? 'red' : 'amber',
      label: `Unverified decision basis (${daysOld}d): ${asm.assumption?.substring(0, 50) || 'Unknown'}`,
      detail: `This assumption has not been verified for ${daysOld} days and may no longer support sound decisions.`,
      help: 'Unverified assumptions weaken the decision basis. Validate or invalidate to maintain decision integrity.',
      agent_id: asm.agent_id,
      assumption_id: asm.assumption_id,
      detected_at: asm.created_at,
    });
  }

  for (const action of staleRunning) {
    const hoursRunning = Math.round((Date.now() - new Date(action.timestamp_start).getTime()) / (1000 * 60 * 60));
    signals.push({
      type: 'stale_running_action',
      severity: hoursRunning > 24 ? 'red' : 'amber',
      label: `Stalled decision (${hoursRunning}h): ${action.declared_goal?.substring(0, 60) || 'Unknown goal'}`,
      detail: `${action.agent_name || action.agent_id} has had this decision executing for ${hoursRunning} hours without resolution. The governance record is incomplete.`,
      help: 'Stalled decisions leave the audit trail incomplete. Investigate whether the decision is stuck or should be finalized.',
      agent_id: action.agent_id,
      action_id: action.action_id,
      detected_at: action.timestamp_start,
    });
  }

  for (const row of stuckWorkflows) {
    const ageMinutes = Math.round((Date.now() - new Date(row.timestamp_start).getTime()) / 60000);
    signals.push({
      type: 'workflow_stuck',
      severity: ageMinutes > 60 ? 'red' : 'amber',
      label: `Stuck workflow: ${row.declared_goal || 'Unknown'}`,
      detail: `Running for ${ageMinutes}m without completing. Agent: ${row.agent_name || row.agent_id || 'unknown'}.`,
      help: 'Cancel the workflow from the operations feed or investigate the stuck step.',
      agent_id: row.agent_id,
      action_id: row.action_id,
      trigger: row.trigger || null,
      detected_at: row.timestamp_start,
    });
  }

  for (const row of staleApprovals) {
    const ageHours = Math.round((Date.now() - new Date(row.timestamp_start).getTime()) / 3600000);
    signals.push({
      type: 'approval_backlog',
      severity: ageHours >= 4 ? 'red' : 'amber',
      label: `Stale approval: ${row.declared_goal || 'Unknown'}`,
      detail: `Pending for ${ageHours}h. Risk: ${row.risk_score || 'unknown'}. Agent: ${row.agent_name || row.agent_id || 'unknown'}.`,
      help: 'Review and approve or deny this action from the approvals queue.',
      agent_id: row.agent_id,
      action_id: row.action_id,
      detected_at: row.timestamp_start,
    });
  }

  // Integration mismatch: agent reports using a provider but credentials are missing or broken
  // (skipped when either prefetched query failed — integration_health table may not exist yet)
  if (connections && health) {
    const healthMap: Record<string, Row> = Object.fromEntries(health.map((h) => [h.provider, h]));
    for (const conn of connections) {
      const entry = healthMap[conn.provider];
      const h = entry?.status;
      if (h === 'error') {
        signals.push({
          type: 'integration_mismatch',
          severity: 'red',
          label: `Integration Credential Error (${conn.provider})`,
          detail: `Agent "${conn.agent_id}" reports using ${conn.provider} but stored credentials are invalid.`,
          help: 'Update credentials on the Integrations page.',
          agent_id: conn.agent_id,
          provider: conn.provider,
          detected_at: entry?.checked_at || null,
        });
      } else if (!h && h !== 'healthy' && h !== 'degraded') {
        // No health record means credentials were never configured or checked
        const hasAnyHealth = health.length > 0; // health cron has run at least once
        if (hasAnyHealth) {
          signals.push({
            type: 'integration_mismatch',
            severity: 'amber',
            label: `Missing Integration Credentials (${conn.provider})`,
            detail: `Agent "${conn.agent_id}" reports using ${conn.provider} but no credentials are configured.`,
            help: 'Configure credentials on the Integrations page.',
            agent_id: conn.agent_id,
            provider: conn.provider,
            detected_at: null,
          });
        }
      }
    }
  }

  // Detect sessions in 'running' status with no activity for 2+ hours
  try {
    for (const sess of stalledSessions || []) {
      const hoursStalled = Math.round((Date.now() - new Date(sess.last_activity).getTime()) / 3600000);
      signals.push({
        type: 'session_stalled',
        severity: hoursStalled >= 4 ? 'red' : 'amber',
        label: `Session stalled (${hoursStalled}h): ${sess.agent_id}`,
        detail: `Session ${sess.id} has been running with no tool activity for ${hoursStalled} hours`,
        help: 'Consider restarting the agent session or checking for blockers',
        agent_id: sess.agent_id,
        session_id: sess.id,
        detected_at: sess.last_activity || null,
      });
    }
  } catch (e) { /* signal collection is best-effort */ }

  // Stale branch detection from recent guard decisions with intel
  try {
    const seenAgents = new Set();
    for (const dec of recentDecisions || []) {
      try {
        const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
        const branch = ctx?.intel?.branch;
        if (branch?.freshness === 'stale' && !seenAgents.has(dec.agent_id)) {
          seenAgents.add(dec.agent_id);
          const behind = branch.commits_behind || 0;
          signals.push({
            type: 'branch_stale', severity: behind >= 5 ? 'red' : 'amber',
            label: `Stale branch: ${branch.name || 'unknown'} (${behind} behind)`,
            detail: `Agent ${dec.agent_id} is working on a branch ${behind} commits behind main`,
            help: 'Rebase or merge-forward before running tests',
            agent_id: dec.agent_id,
            detected_at: dec.created_at || null,
          });
        }
      } catch (e) {
        console.warn(`[signals] branch_stale: failed to parse context for decision ${dec.id}:`, (e as Error)?.message || e);
      }
    }
  } catch (e) {
    console.warn('[signals] branch_stale category failed:', (e as Error)?.message || e);
  }

  // MCP server health from recent guard decisions with intel
  try {
    const seenServers = new Set();
    for (const dec of recentMcpDecisions || []) {
      try {
        const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
        const mcp = ctx?.intel?.mcp;
        if (mcp && !mcp.healthy && !seenServers.has(mcp.server)) {
          seenServers.add(mcp.server);
          signals.push({
            type: 'mcp_degraded', severity: mcp.status === 'auth_required' ? 'red' : 'amber',
            label: `MCP degraded: ${mcp.server} (${mcp.status})`,
            detail: mcp.error || `MCP server ${mcp.server} is ${mcp.status}`,
            help: 'Check MCP server configuration and connectivity',
            agent_id: dec.agent_id,
            detected_at: dec.created_at || null,
          });
        }
      } catch (e) {
        console.warn(`[signals] mcp_degraded: failed to parse context for decision ${dec.id}:`, (e as Error)?.message || e);
      }
    }
  } catch (e) {
    console.warn('[signals] mcp_degraded category failed:', (e as Error)?.message || e);
  }

  // Green contract insufficiency from recent guard decisions
  try {
    const seenGreenAgents = new Set();
    for (const dec of greenDecisions || []) {
      try {
        const reason = dec.reason || '';
        if (reason.includes('Green contract') && !seenGreenAgents.has(dec.agent_id)) {
          seenGreenAgents.add(dec.agent_id);
          const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
          const green = ctx?.intel?.green;
          signals.push({
            type: 'green_insufficient', severity: 'red',
            label: `Green insufficient: ${dec.agent_id} (${green?.observed_level || 'none'})`,
            detail: 'Agent attempted deploy/merge without sufficient test verification',
            help: 'Run tests at the required green level before proceeding',
            agent_id: dec.agent_id,
            detected_at: dec.created_at || null,
          });
        }
      } catch (e) {
        console.warn(`[signals] green_insufficient: failed to parse context for decision ${dec.id}:`, (e as Error)?.message || e);
      }
    }
  } catch (e) {
    console.warn('[signals] green_insufficient category failed:', (e as Error)?.message || e);
  }

  // ── W3: approval flood (red) — mirrors the interruption-budget state ──
  try {
    const { getFloodState, FLEET_KEY } = await import('./approval-flood');
    const flood = await getFloodState(sql as never, orgId);
    for (const [policyId, entry] of Object.entries(flood)) {
      signals.push({
        type: 'approval_flood',
        severity: 'red',
        label: policyId === FLEET_KEY
          ? `Approval flood: fleet-wide (${entry.count} interrupts in window)`
          : `Approval flood: policy ${policyId} (${entry.count} interrupts in window)`,
        detail: 'A single source is generating bulk approval interruptions. Per-action pings are paused; pending approvals are intact.',
        help: 'Review /approvals — pause the rule or bulk-resolve. A flood almost always means an over-broad require_approval rule.',
        policy_id: policyId,
        detected_at: entry.tripped_at,
      });
    }
  } catch (e) { warnNull('approval_flood')(e); }

  // ── W3: attribution coverage drop (amber) ──
  try {
    const { getCostAggregation } = await import('./repositories/actions.repository');
    const cost = await getCostAggregation(sql as never, orgId, { period: '7d' });
    const cov = cost.attribution;
    if (cov && cov.total_count >= 50 && cov.coverage_pct !== null && cov.coverage_pct < 90) {
      signals.push({
        type: 'coverage_drop',
        severity: 'amber',
        label: `Token attribution coverage at ${cov.coverage_pct}%`,
        detail: `${cov.attributed_count} of ${cov.total_count} actions in the last 7d carry token usage — cost reporting is undercounting.`,
        help: 'Check that runtime plugins emit usage (see /spend). A disabled plugin or unsupported runtime drops attribution.',
      });
    }
  } catch (e) { warnNull('coverage_drop')(e); }

  // Post-filter by agent_id if requested
  const filteredSignals = filterAgentId
    ? signals.filter((s) => s.agent_id === filterAgentId)
    : signals;

  // Sort: red first, then amber
  filteredSignals.sort((a, b) => {
    if (a.severity === 'red' && b.severity !== 'red') return -1;
    if (a.severity !== 'red' && b.severity === 'red') return 1;
    return 0;
  });

  return filteredSignals;
}

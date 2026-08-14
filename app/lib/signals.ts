/**
 * Shared signal computation. Extracted from /api/signals/route.js
 * Used by both the API route and the cron job.
 *
 * Structure (v4.66.x health pass): computeSignals fetches the org's rows in
 * one parallel batch, then delegates each signal category to a pure
 * `build*Signals` function below. The builders are exported for direct unit
 * testing of severity thresholds; their bodies (and the push order, which
 * the stable red-first sort preserves for equal severities) are unchanged
 * from the original inline loops.
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

export function buildStalePresenceSignals(stalePresence: Row[]): Signal[] {
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
  return signals;
}

export function buildAutonomySpikeSignals(autonomySpikes: Row[], spikeThreshold: number): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

export function buildHighImpactSignals(highImpact: Row[]): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

export function buildRepeatedFailureSignals(repeatedFailures: Row[]): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

export function buildAssumptionDriftSignals(assumptionDrift: Row[]): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

export function buildStaleAssumptionSignals(staleAssumptions: Row[]): Signal[] {
  const signals: Signal[] = [];
  for (const asm of staleAssumptions) {
    const daysOld = Math.round((Date.now() - new Date(asm.created_at).getTime()) / (1000 * 60 * 60 * 24));
    // Rows arrive pre-grouped by assumption text (occurrence_count = how many
    // times agents re-recorded the same assumption) — one signal per distinct
    // assumption, not one per recording.
    const occurrences = parseInt(asm.occurrence_count, 10) || 1;
    signals.push({
      type: 'stale_assumption',
      severity: daysOld > 30 ? 'red' : 'amber',
      label: `Unverified decision basis (${daysOld}d): ${asm.assumption?.substring(0, 50) || 'Unknown'}`,
      detail: occurrences > 1
        ? `This assumption has not been verified for ${daysOld} days and was recorded ${occurrences} times. It may no longer support sound decisions.`
        : `This assumption has not been verified for ${daysOld} days and may no longer support sound decisions.`,
      help: 'Unverified assumptions weaken the decision basis. Validate or invalidate to maintain decision integrity.',
      agent_id: asm.agent_id,
      assumption_id: asm.assumption_id,
      detected_at: asm.created_at,
    });
  }
  return signals;
}

export function buildStaleRunningSignals(staleRunning: Row[]): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

export function buildStaleApprovalSignals(staleApprovals: Row[]): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

/**
 * Integration mismatch: agent reports using a provider but credentials are
 * missing or broken. Skipped entirely when either prefetched query failed
 * (integration_health table may not exist yet).
 */
export function buildIntegrationMismatchSignals(connections: Row[] | null, health: Row[] | null): Signal[] {
  const signals: Signal[] = [];
  if (!connections || !health) return signals;
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
  return signals;
}

/**
 * Sessions in 'running' status with no activity for 2+ hours, ONE signal per
 * agent. Rows arrive pre-aggregated (agent_id, stalled_count, oldest_activity,
 * sample_session_id) — see the agent_sessions query for why per-session rows
 * were a dead end. Severity and the reported age both come from the OLDEST
 * stalled session, so a growing backlog can only escalate, never soften.
 */
export function buildStalledSessionSignals(stalledSessions: Row[] | null): Signal[] {
  const signals: Signal[] = [];
  for (const row of stalledSessions || []) {
    const count = Math.max(1, parseInt(row.stalled_count, 10) || 1);
    const oldest = row.oldest_activity;
    const hoursStalled = Math.round((Date.now() - new Date(oldest).getTime()) / 3600000);
    const sessionId = row.sample_session_id;
    signals.push({
      type: 'session_stalled',
      severity: hoursStalled >= 4 ? 'red' : 'amber',
      label: count === 1
        ? `Session stalled (${hoursStalled}h): ${row.agent_id}`
        : `${count} sessions stalled (oldest ${hoursStalled}h): ${row.agent_id}`,
      detail: count === 1
        ? `Session ${sessionId} has been running with no tool activity for ${hoursStalled} hours`
        : `${count} sessions for ${row.agent_id} are running with no tool activity. The oldest (${sessionId}) has been idle for ${hoursStalled} hours.`,
      help: 'Consider restarting the agent session or checking for blockers',
      agent_id: row.agent_id,
      session_id: sessionId,
      detected_at: oldest || null,
    });
  }
  return signals;
}

/** Stale branch detection from recent guard decisions with intel. */
export function buildBranchStaleSignals(recentDecisions: Row[] | null): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

/**
 * Observe-mode agents from recent guard decisions. The hook stamps its
 * enforcement posture (enforcement_mode) on every guard call; an agent whose
 * LATEST decision in the window says 'observe' has hooks that log blocks
 * without stopping anything — the operator must see that standing state, not
 * discover it during an incident. Rows are ordered newest-first, so the first
 * decision seen per agent IS its latest; agents that flipped to enforce clear
 * immediately. Decisions without the field (SDKs, MCP, older hooks) are
 * "unreported", never counted as observe.
 */
export function buildObserveModeSignals(recentDecisions: Row[] | null): Signal[] {
  const signals: Signal[] = [];
  const seenAgents = new Set();
  for (const dec of recentDecisions || []) {
    if (!dec.agent_id || seenAgents.has(dec.agent_id)) continue;
    seenAgents.add(dec.agent_id);
    try {
      const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
      if (ctx?.enforcement_mode === 'observe') {
        // Red, not amber (F0, governance gap audit 2026-08-05): observe mode
        // is a standing "nothing is enforced" posture, not a degradation.
        // Amber let 153 unenforced blocks read as a healthy ledger.
        signals.push({
          type: 'observe_mode',
          severity: 'red',
          label: `Hooks in observe mode: ${dec.agent_id}`,
          detail: `This agent's governance hooks are reporting decisions in OBSERVE mode — a "block" is logged but the tool call proceeds anyway.`,
          help: 'Set DASHCLAW_HOOK_MODE=enforce in the agent\'s hook env (see `dashclaw doctor`) when you are ready for blocks and approval gates to physically stop tool calls.',
          agent_id: dec.agent_id,
          detected_at: dec.created_at || null,
        });
      }
    } catch (e) {
      console.warn(`[signals] observe_mode: failed to parse context for decision ${dec.id}:`, (e as Error)?.message || e);
    }
  }
  return signals;
}

// An operator does not think in tool-classifier categories. Naming the thing
// that is actually unwatched is the difference between a signal they can act on
// and a string they have to go look up.
const CATEGORY_IN_PLAIN_ENGLISH: Record<string, string> = {
  execution: 'shell commands',
  file_io: 'file reads and writes',
  orchestration: 'subagent and task spawns',
  mcp: 'MCP tool calls',
  interactive: 'prompts to the user',
  search: 'searches',
  system: 'system queries',
  unknown: 'unrecognized tools',
};

/**
 * Governance SCOPE narrowed below the default (adversarial review 2026-08-11).
 *
 * DASHCLAW_GOVERNED_CATEGORIES lets the agent's own machine decide which tool
 * categories call the guard at all, and the hook exits before the network call
 * for a category it excludes. So unlike observe mode — which is visible on
 * every decision through enforcement_mode — narrowing produced NO row, no
 * witness and no signal. The dashboard read green while shell commands and file
 * writes ran ungoverned. The hook now declares the gap on the calls it does
 * make; this turns that declaration into something the operator sees.
 *
 * Red, on the same reasoning as observe_mode: an ungoverned category is a
 * standing "this is not watched" posture, not a transient degradation.
 *
 * Rides the same 1h recent-decisions batch as branch_stale/observe_mode, so it
 * costs no extra query.
 */
export function buildUngovernedScopeSignals(recentDecisions: Row[] | null): Signal[] {
  const signals: Signal[] = [];
  const seenAgents = new Set();
  for (const dec of recentDecisions || []) {
    if (!dec.agent_id || seenAgents.has(dec.agent_id)) continue;
    try {
      const ctx = typeof dec.context === 'string' ? JSON.parse(dec.context) : dec.context;
      const raw = (ctx as { ungoverned_categories?: unknown } | null)?.ungoverned_categories;
      if (!Array.isArray(raw) || raw.length === 0) continue;
      const cats = raw.filter((c): c is string => typeof c === 'string' && c.length > 0);
      if (!cats.length) continue;
      // Only mark the agent seen once we know it HAS a gap — otherwise the
      // first clean decision would suppress a later narrowed one for the
      // same agent within the window.
      seenAgents.add(dec.agent_id);
      const plain = cats.map((c) => CATEGORY_IN_PLAIN_ENGLISH[c] || c);
      signals.push({
        type: 'ungoverned_scope',
        severity: 'red',
        label: `Governance scope narrowed: ${dec.agent_id}`,
        detail: `This agent is not governing ${plain.join(', ')}. Those tool calls never reach the guard, so they are absent from /decisions entirely — the ledger looks clean because nothing was recorded, not because nothing happened.`,
        help: `Remove DASHCLAW_GOVERNED_CATEGORIES from this agent's hook env to restore the default scope, or set it to "all". A typo in that variable silently drops a real category — check it for misspellings.`,
        agent_id: dec.agent_id as string,
        detected_at: (dec.created_at as string) || null,
      });
    } catch (e) {
      console.warn(`[signals] ungoverned_scope: failed to parse context for decision ${dec.id}:`, (e as Error)?.message || e);
    }
  }
  return signals;
}

/**
 * Executed-despite witnesses (F0, governance gap audit 2026-08-05): action
 * rows where PostToolUse recorded that a block / require_approval verdict did
 * not stop execution. Each row is a concrete enforcement failure — the exact
 * evidence class whose absence let an unenforced ledger read as healthy.
 */
export function buildExecutedDespiteSignals(executedDespiteRows: Row[] | null): Signal[] {
  const signals: Signal[] = [];
  for (const row of executedDespiteRows || []) {
    signals.push({
      type: 'executed_despite_block',
      severity: 'red',
      label: `Executed despite ${row.executed_despite === 'require_approval' ? 'approval gate' : 'block'}: ${row.agent_id}`,
      detail: `"${String(row.declared_goal || 'unknown action').slice(0, 200)}" was ${row.executed_despite === 'require_approval' ? 'gated on approval' : 'blocked'} but the tool call executed anyway — enforcement did not stop it (observe mode, or a bypass).`,
      help: 'Set DASHCLAW_HOOK_MODE=enforce and restart the agent session. Review the action in /decisions to assess what ran.',
      agent_id: row.agent_id,
      action_id: row.action_id,
      detected_at: row.timestamp_start || null,
    });
  }
  return signals;
}

/** MCP server health from recent guard decisions with intel. */
export function buildMcpDegradedSignals(recentMcpDecisions: Row[] | null): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

/** Green contract insufficiency from recent guard decisions. */
export function buildGreenInsufficientSignals(greenDecisions: Row[] | null): Signal[] {
  const signals: Signal[] = [];
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
  return signals;
}

/**
 * Compute all 17 risk signal types for an org.
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
  // Optional sink. Signals suppressed by a dismissal are pushed here instead of
  // vanishing silently, so /api/signals can tell the operator WHAT is muted and
  // offer a one-click restore. Every existing caller passes three args and is
  // unaffected.
  mutedOut?: Signal[],
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

  const [autonomySpikes, highImpact, repeatedFailures, assumptionDrift, staleAssumptions, staleRunning, stalePresence, staleApprovals, connections, health, stalledSessions, recentDecisions, recentMcpDecisions, greenDecisions, executedDespiteRows] = (await Promise.all([
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
    // Grouped by assumption text: the same assumption re-recorded across many
    // sessions used to emit one signal PER ROW — 6 identical "Migration
    // add-indexes is idempotent" criticals. One signal per distinct assumption,
    // oldest occurrence's id/timestamp as the stable dismiss identity.
    sql`
      SELECT MIN(a.assumption_id) AS assumption_id, a.assumption,
             MIN(a.created_at) AS created_at, COUNT(*) AS occurrence_count,
             MIN(ar.agent_id) AS agent_id, MIN(ar.agent_name) AS agent_name
      FROM assumptions a
      LEFT JOIN action_records ar ON a.action_id = ar.action_id
      WHERE a.validated = 0
        AND a.org_id = ${orgId}
        AND a.invalidated = 0
        AND a.created_at < NOW() - INTERVAL '14 days'
      GROUP BY a.assumption
      ORDER BY MIN(a.created_at) ASC
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
    // Stalled sessions — best-effort, silent on failure. The 48h UPPER bound
    // mirrors the agent_presence query above and is equally load-bearing:
    // nothing used to reap a session left in 'running', so week-old dead
    // sessions fired "stalled (850h)" criticals forever and buried real
    // incidents. Past 48h the outcome-sweep cron closes the session instead.
    // Aggregated PER AGENT, not per session. The old query was `LIMIT 10` with
    // no ORDER BY over a pool that reached 266 stalled sessions in production:
    // Postgres could hand back a different arbitrary 10 on every sweep, so
    // dismissing the visible rows just surfaced ten more and the operator could
    // never drain the queue. One row per agent makes the signal countable,
    // dismissible, and deterministic.
    sql`
      SELECT agent_id,
             COUNT(*)::int AS stalled_count,
             MIN(last_activity) AS oldest_activity,
             (ARRAY_AGG(id ORDER BY last_activity ASC))[1] AS sample_session_id
      FROM agent_sessions
      WHERE org_id = ${orgId}
        AND status = 'running'
        AND last_activity < NOW() - INTERVAL '2 hours'
        AND last_activity > NOW() - INTERVAL '48 hours'
        ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
      GROUP BY agent_id
      ORDER BY COUNT(*) DESC, MIN(last_activity) ASC
      LIMIT 20
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
    // Executed-despite witnesses (F0, drizzle/0066) — column may predate this
    // schema on an un-migrated instance; skip silently (null).
    sql`
      SELECT action_id, agent_id, agent_name, declared_goal, executed_despite, timestamp_start
      FROM action_records
      WHERE org_id = ${orgId}
        AND executed_despite IS NOT NULL
        AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      ${filterAgentId ? sql`AND agent_id = ${filterAgentId}` : sql``}
      ORDER BY timestamp_start DESC LIMIT 10
    `.catch(warnNull('executed_despite_block')),
    // Tuple cast: each Promise.all result is a non-empty Row[] (or null for a
    // failed best-effort query); a plain array type makes destructured
    // positions possibly-undefined under noUncheckedIndexedAccess.
  ])) as [Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[] | null, Row[] | null, Row[] | null, Row[] | null, Row[] | null, Row[] | null, Row[] | null];

  const signals: Signal[] = [];

  signals.push(...buildStalePresenceSignals(stalePresence));
  signals.push(...buildAutonomySpikeSignals(autonomySpikes, spikeThreshold));
  signals.push(...buildHighImpactSignals(highImpact));
  signals.push(...buildRepeatedFailureSignals(repeatedFailures));
  signals.push(...buildAssumptionDriftSignals(assumptionDrift));
  signals.push(...buildStaleAssumptionSignals(staleAssumptions));
  signals.push(...buildStaleRunningSignals(staleRunning));
  signals.push(...buildStaleApprovalSignals(staleApprovals));
  signals.push(...buildIntegrationMismatchSignals(connections, health));

  try {
    signals.push(...buildStalledSessionSignals(stalledSessions));
  } catch (e) { /* signal collection is best-effort */ }

  try {
    signals.push(...buildBranchStaleSignals(recentDecisions));
  } catch (e) {
    console.warn('[signals] branch_stale category failed:', (e as Error)?.message || e);
  }

  // Rides on the same 1h recent-decisions batch as branch_stale — no extra query.
  try {
    signals.push(...buildObserveModeSignals(recentDecisions));
  } catch (e) {
    console.warn('[signals] observe_mode category failed:', (e as Error)?.message || e);
  }

  // Same batch again: the scope half of the enforcement-visibility pair.
  try {
    signals.push(...buildUngovernedScopeSignals(recentDecisions));
  } catch (e) {
    console.warn('[signals] ungoverned_scope category failed:', (e as Error)?.message || e);
  }

  try {
    signals.push(...buildMcpDegradedSignals(recentMcpDecisions));
  } catch (e) {
    console.warn('[signals] mcp_degraded category failed:', (e as Error)?.message || e);
  }

  try {
    signals.push(...buildExecutedDespiteSignals(executedDespiteRows));
  } catch (e) {
    console.warn('[signals] executed_despite_block category failed:', (e as Error)?.message || e);
  }

  try {
    signals.push(...buildGreenInsufficientSignals(greenDecisions));
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

  // ── Server-side dismissals — subtract the org's dismissed occurrence keys
  // here, at the single choke point, so EVERY consumer (status bar, signals
  // panel, widget pulse, guard warnings, signals cron) sees the same set.
  // Fail-open: a dismissal read failure must never hide or break signals.
  let visibleSignals = signals;
  try {
    const { listDismissKeys } = await import('./repositories/signal-dismissals.repository');
    const { signalDismissKey } = await import('./signal-hash');
    const dismissed = new Set(await listDismissKeys(sql as never, orgId));
    if (dismissed.size > 0) {
      visibleSignals = signals.filter((s) => {
        if (!dismissed.has(signalDismissKey(s))) return true;
        mutedOut?.push(s);
        return false;
      });
    }
  } catch (e) { warnNull('signal_dismissals')(e); }

  // Post-filter by agent_id if requested
  const filteredSignals = filterAgentId
    ? visibleSignals.filter((s) => s.agent_id === filterAgentId)
    : visibleSignals;

  // Sort: red first, then amber
  filteredSignals.sort((a, b) => {
    if (a.severity === 'red' && b.severity !== 'red') return -1;
    if (a.severity !== 'red' && b.severity === 'red') return 1;
    return 0;
  });

  return filteredSignals;
}

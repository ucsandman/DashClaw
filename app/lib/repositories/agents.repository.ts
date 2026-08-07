import { baseAgentId } from '../agent-identity-resolve';
import { isSyntheticAgentId } from '../synthetic-agents';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

type AgentRecord = Record<string, unknown> & {
  agent_id: string;
  agent_name?: string;
  action_count?: number;
  last_active?: string | null;
  last_goal?: string | null;
  last_decision?: string | null;
  last_snapshot?: string | null;
  goal_count?: number;
  decision_count?: number;
  presence_state?: string;
  last_seen_at?: string | null;
};

function isMissingTable(err: unknown): boolean {
  return (
    String((err as { code?: string })?.code || '').includes('42P01') ||
    String((err as { message?: string })?.message || '').includes('does not exist')
  );
}

/**
 * Returns true when the agent_id has any trace of belonging to the org:
 * a presence record, an identity record, a pairing, a recorded action, or a
 * message it has sent in this org (so you can reply to a messaging-only agent
 * that has never produced a governed action).
 * Used as a tenant-ownership gate on user-supplied agent_id fields —
 * messages/feedback/etc — to prevent cross-org spoofing.
 */
export async function agentExistsInOrg(
  sql: SqlClient,
  orgId: string,
  agentId: unknown
): Promise<boolean> {
  if (!agentId || typeof agentId !== 'string') return false;
  const exists = await agentIdHasTraceInOrg(sql, orgId, agentId);
  if (exists) return true;
  // Composed sub-agent ids (<parent>:<type>, RFC 2026-06-01) belong to the
  // org whenever their parent does — a fresh sub-agent may be referenced
  // before its first recorded action lands. Exact match above still wins.
  const base = baseAgentId(agentId);
  return base ? agentIdHasTraceInOrg(sql, orgId, base) : false;
}

async function agentIdHasTraceInOrg(
  sql: SqlClient,
  orgId: string,
  agentId: string
): Promise<boolean> {
  try {
    const rows = await sql`
      SELECT 1 FROM agent_presence WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  try {
    const rows = await sql`
      SELECT 1 FROM agent_identities WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  try {
    const rows = await sql`
      SELECT 1 FROM agent_pairings WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  try {
    const rows = await sql`
      SELECT 1 FROM action_records WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  // An agent that has only ever sent a message (no governed action, pairing, or
  // presence row) still legitimately belongs to this org for messaging — without
  // this branch, replying to such an agent 403'd with "to_agent_id not found".
  // Still org-scoped, so it is not a cross-tenant spoofing vector.
  try {
    const rows = await sql`
      SELECT 1 FROM agent_messages WHERE org_id = ${orgId} AND from_agent_id = ${agentId} LIMIT 1
    `;
    if (rows.length > 0) return true;
  } catch (err) { if (!isMissingTable(err)) throw err; }
  return false;
}

function maxIso(a: unknown, b: unknown): string | null {
  if (!a) return (b as string) || null;
  if (!b) return (a as string) || null;
  return String(a) > String(b) ? (a as string) : (b as string);
}

/**
 * Build an agent list for an org without requiring action_records to exist.
 * Intended to support bootstrap/import flows where goals/decisions exist before actions.
 */
export async function listAgentsForOrg(
  sql: SqlClient,
  orgId: string,
  opts: { includeSynthetic?: boolean } = {}
): Promise<AgentRecord[]> {
  const byId = new Map<string, AgentRecord>();

  // Primary signal: action_records (most complete metadata).
  try {
    const rows = await sql.query(
      `
        SELECT agent_id, MAX(agent_name) as agent_name, COUNT(*) as action_count,
          MAX(timestamp_start) as last_active
        FROM action_records
        WHERE org_id = $1
        GROUP BY agent_id
      `,
      [orgId]
    );
    for (const r of rows || []) {
      if (!r.agent_id) continue;
      byId.set(r.agent_id as string, {
        agent_id: r.agent_id as string,
        agent_name: (r.agent_name as string) || (r.agent_id as string),
        action_count: Number(r.action_count || 0),
        last_active: (r.last_active as string) || null,
        last_goal: null,
        last_decision: null,
      });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  const mergeAgent = (agentId: unknown, fields: Record<string, unknown> = {}): void => {
    if (!agentId) return;
    const existing = byId.get(agentId as string) || {
      agent_id: agentId as string,
      agent_name: agentId as string,
      action_count: 0,
      last_active: null,
      last_goal: null,
      last_decision: null,
    };
    byId.set(agentId as string, { ...existing, ...fields });
  };

  // Fallback: goals imported without actions.
  try {
    const rows = await sql.query(
      `
        SELECT agent_id, COUNT(*) as goal_count, MAX(created_at) as last_goal
        FROM goals
        WHERE org_id = $1 AND agent_id IS NOT NULL
        GROUP BY agent_id
      `,
      [orgId]
    );
    for (const r of rows || []) {
      mergeAgent(r.agent_id, { goal_count: Number(r.goal_count || 0), last_goal: r.last_goal || null });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  // Fallback: decisions imported without actions.
  try {
    const rows = await sql.query(
      `
        SELECT agent_id, COUNT(*) as decision_count, MAX(timestamp) as last_decision
        FROM decisions
        WHERE org_id = $1 AND agent_id IS NOT NULL
        GROUP BY agent_id
      `,
      [orgId]
    );
    for (const r of rows || []) {
      mergeAgent(r.agent_id, { decision_count: Number(r.decision_count || 0), last_decision: r.last_decision || null });
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  const agents: AgentRecord[] = [...byId.values()].map((a) => {
    const last_active = maxIso(a.last_active, maxIso(a.last_goal, maxIso(a.last_decision, a.last_snapshot)));
    return {
      agent_id: a.agent_id,
      agent_name: a.agent_name || a.agent_id,
      action_count: Number(a.action_count || 0),
      last_active,
      goal_count: Number(a.goal_count || 0),
      decision_count: Number(a.decision_count || 0),
    };
  });

  // Attach presence data (heartbeats)
  try {
    // Cap presence rows: heartbeats grow with agent count; 1000 is far above any
    // single org's live agent roster and only guards against unbounded scans.
    // ORDER BY freshest-first so the cap (if ever hit) keeps the most relevant
    // heartbeats deterministically rather than an arbitrary subset.
    const presence = await sql.query(
      `SELECT * FROM agent_presence WHERE org_id = $1 ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1000`,
      [orgId]
    );
    const presenceMap: Record<string, Record<string, unknown>> = {};
    for (const p of presence || []) {
      presenceMap[p.agent_id as string] = p;
    }

    const now = Date.now();
    const ONLINE_WINDOW_MS = (parseInt(process.env.AGENT_ONLINE_WINDOW_MS as string) || 10 * 60 * 1000); // Default 10m
    const STALE_WINDOW_MS = ONLINE_WINDOW_MS * 3; // 30m considered stale before offline

    // Helper: compute status from timestamps
    const calculatePresence = (
      lastHeartbeat: unknown,
      lastActive: unknown,
      reportedStatus: unknown
    ): { state: string; seconds: number | null; last_seen: string | null } => {
      if (reportedStatus === 'offline' || reportedStatus === 'error') {
        const lastSeenStr = maxIso(lastHeartbeat, lastActive);
        const seconds = lastSeenStr ? Math.floor((now - new Date(lastSeenStr).getTime()) / 1000) : null;
        return { state: 'offline', seconds, last_seen: lastSeenStr };
      }

      // Prefer heartbeat, then last_active
      const lastSeenStr = maxIso(lastHeartbeat, lastActive);
      if (!lastSeenStr) return { state: 'unknown', seconds: null, last_seen: null };

      const lastSeenMs = new Date(lastSeenStr).getTime();
      const diff = now - lastSeenMs;
      const seconds = Math.floor(diff / 1000);

      let state = 'offline';
      if (diff < ONLINE_WINDOW_MS) state = 'online';
      else if (diff < STALE_WINDOW_MS) state = 'stale';

      return { state, seconds, last_seen: lastSeenStr };
    };

    // First pass: attach presence to agents already in the list
    for (const agent of agents) {
      const p = presenceMap[agent.agent_id];
      let lastHeartbeat: unknown = null;
      let reportedStatus: unknown = 'unknown';

      if (p) {
        agent.reported_status = p.status;
        agent.last_heartbeat_at = p.last_heartbeat_at;
        agent.current_task_id = p.current_task_id;
        try {
          agent.presence_metadata = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
        } catch { agent.presence_metadata = {}; }
        lastHeartbeat = p.last_heartbeat_at;
        reportedStatus = p.status;
      } else {
        agent.reported_status = 'unknown';
      }

      // Calculate derived presence state
      const { state, seconds, last_seen } = calculatePresence(lastHeartbeat, agent.last_active, reportedStatus);
      agent.presence_state = state;
      agent.seconds_since_seen = seconds;
      agent.last_seen_at = last_seen;

      // Legacy compat
      agent.status = (reportedStatus === 'offline' ? 'offline' : state);
    }

    // Second pass: add agents that only exist in agent_presence (heartbeat-only, no actions yet)
    for (const p of presence || []) {
      if (!byId.has(p.agent_id as string)) {
        let presence_metadata: unknown = {};
        try {
          presence_metadata = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
        } catch { presence_metadata = {}; }

        const { state, seconds, last_seen } = calculatePresence(p.last_heartbeat_at, null, p.status);

        agents.push({
          agent_id: p.agent_id as string,
          agent_name: (p.agent_name as string) || (p.agent_id as string),
          action_count: 0,
          last_active: p.last_heartbeat_at as string | null,
          reported_status: p.status,
          status: (p.status === 'offline' ? 'offline' : state), // legacy compat
          presence_state: state,
          seconds_since_seen: seconds,
          last_seen_at: last_seen,
          last_heartbeat_at: p.last_heartbeat_at,
          current_task_id: p.current_task_id,
          presence_metadata,
        });
      }
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  // Test traffic (smoke/loadtest/bench/CI) is hidden from every roster consumer
  // (identities fleet, global agent dropdown, policy picker) unless explicitly
  // requested — the registry lives in app/lib/synthetic-agents.js.
  const visible = opts.includeSynthetic ? agents : agents.filter((a) => !isSyntheticAgentId(a.agent_id));

  visible.sort((a, b) => {
    // Sort online agents to top
    if (a.presence_state === 'online' && b.presence_state !== 'online') return -1;
    if (b.presence_state === 'online' && a.presence_state !== 'online') return 1;

    // Then by recency
    const aTime = a.last_seen_at || '';
    const bTime = b.last_seen_at || '';
    return String(bTime).localeCompare(String(aTime));
  });
  return visible;
}

interface PresencePayload {
  agent_id: string;
  agent_name?: string | null;
  status: string;
  current_task_id?: string | null;
  metadata?: unknown;
  timestamp: string;
  [k: string]: unknown;
}

/**
 * Update or create an agent's presence record (heartbeat).
 *
 * Retained for the Doctor write-canary health check (app/lib/doctor/checks/
 * write-canary.mjs), which exercises the agent_presence write path. The
 * fleet-heartbeat route was removed in the v5 cull; the table is retired in
 * place per the no-destructive-migration rule.
 */
export async function upsertAgentPresence(
  sql: SqlClient,
  orgId: string,
  payload: PresencePayload
): Promise<Record<string, unknown>[]> {
  const { agent_id, agent_name, status, current_task_id, metadata, timestamp } = payload;

  return sql`
    INSERT INTO agent_presence (
      org_id, agent_id, agent_name, status, current_task_id,
      last_heartbeat_at, metadata, updated_at
    ) VALUES (
      ${orgId}, ${agent_id}, ${agent_name || null}, ${status}, ${current_task_id || null},
      ${timestamp}, ${JSON.stringify(metadata || {})}, ${timestamp}
    )
    ON CONFLICT (org_id, agent_id) DO UPDATE SET
      agent_name = EXCLUDED.agent_name,
      status = EXCLUDED.status,
      current_task_id = EXCLUDED.current_task_id,
      last_heartbeat_at = EXCLUDED.last_heartbeat_at,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
}

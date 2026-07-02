// Advocate v2a: assumption-invalidation notifications.
// The agent_messages row IS the notification record; its read state IS the ack.
// Spec: docs/superpowers/specs/2026-07-02-assumption-invalidation-notifications-design.md
import { randomUUID } from 'crypto';
import { createMessage } from './repositories/messagesContext.repository';
import { EVENTS, publishOrgEvent } from './events';
import { baseAgentId } from './agent-identity-resolve';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

export const ASSUMPTION_INVALIDATED_TYPE = 'assumption_invalidated';

export type AssumptionAlert = {
  message_id: string;
  assumption_id: string | null;
  assumption: string | null;
  invalidated_reason: string | null;
  action_id: string | null;
  invalidated_at: string | null;
};

type NotifyInput = {
  agent_id: string | null;
  assumption_id: string;
  assumption: string;
  invalidated_reason: string;
  invalidated_at: string;
  action_id: string | null;
};

const ALERT_CACHE_TTL_MS = 30_000;
// Negative cache only: "agent X had no unread alerts". Positive hits are rare
// and must never be served stale (the hook acks them immediately).
const noAlertCache = new Map<string, number>();

export function __resetAssumptionAlertCache(): void {
  noAlertCache.clear();
}

export async function notifyAssumptionInvalidated(
  sql: SqlClient,
  orgId: string,
  input: NotifyInput,
): Promise<{ message_id: string } | null> {
  if (!input.agent_id) return null; // parent action has no agent — nothing to notify
  const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  const subjectText = input.assumption.length > 80 ? `${input.assumption.slice(0, 80)}…` : input.assumption;
  const body = JSON.stringify({
    directive: ASSUMPTION_INVALIDATED_TYPE,
    assumption_id: input.assumption_id,
    assumption: input.assumption,
    invalidated_reason: input.invalidated_reason,
    action_id: input.action_id,
    invalidated_at: input.invalidated_at,
  });
  const created = await createMessage(sql, {
    id,
    orgId,
    thread_id: null,
    from_agent_id: 'operator',
    to_agent_id: input.agent_id,
    message_type: ASSUMPTION_INVALIDATED_TYPE,
    subject: `Assumption invalidated: ${subjectText}`,
    body,
    urgent: true,
    doc_ref: input.assumption_id,
    now,
  });
  if (!created) return null;
  void publishOrgEvent(EVENTS.MESSAGE_CREATED, { orgId, message: created });
  noAlertCache.clear(); // rare event; cheap full clear beats per-family key math
  return { message_id: id };
}

export async function getAssumptionAlerts(
  sql: SqlClient,
  orgId: string,
  agentId: string | null,
): Promise<AssumptionAlert[] | null> {
  if (!agentId) return null;
  const key = `${orgId}|${agentId}`;
  const expires = noAlertCache.get(key);
  if (expires && expires > Date.now()) return null;
  try {
    const ids = [agentId];
    const base = baseAgentId(agentId);
    if (base && base !== agentId) ids.push(base);
    // Family match both directions: a parent hears about its subagents'
    // assumptions (LIKE 'parent:%') and a subagent hears about its base's.
    // agent_id is client-controlled: escape LIKE metacharacters so '%'/'_'
    // in an id can't widen the match to other agents' alerts.
    const likePrefix = agentId.replace(/([\\%_])/g, '\\$1') + ':%';
    const rows = await sql`
      SELECT id, body, created_at
      FROM agent_messages
      WHERE org_id = ${orgId}
        AND message_type = ${ASSUMPTION_INVALIDATED_TYPE}
        AND status = 'sent'
        AND (to_agent_id = ANY(${ids}) OR to_agent_id LIKE ${likePrefix})
      ORDER BY created_at DESC
      LIMIT 3
    `;
    if (!rows.length) {
      noAlertCache.set(key, Date.now() + ALERT_CACHE_TTL_MS);
      return null;
    }
    return rows.map((r) => {
      let directive: Record<string, unknown> = {};
      try {
        directive = JSON.parse(String(r.body || '{}'));
      } catch { /* malformed body — surface what we have */ }
      return {
        message_id: String(r.id),
        assumption_id: (directive.assumption_id as string) ?? null,
        assumption: (directive.assumption as string) ?? null,
        invalidated_reason: (directive.invalidated_reason as string) ?? null,
        action_id: (directive.action_id as string) ?? null,
        invalidated_at: (directive.invalidated_at as string) ?? null,
      };
    });
  } catch (err) {
    // Advisory lookup must never break the guard decision.
    console.warn('[Guard] assumption alerts lookup failed (advisory skipped):', (err as Error).message);
    return null;
  }
}

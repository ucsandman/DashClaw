type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// The messaging product (threads, attachments, action-message trail, the
// /messages page) was removed in the v5 cull. What remains here is the slim
// agent_messages rail that two governance-core flows depend on:
//   • assumption-invalidation notifications (createMessage +
//     getAssumptionNotificationStates + the read/ack helpers), and
//   • operator-initiated pairing-request delivery (listMessages send/list).
// agent_messages is RETIRED-in-place (kept in schema), read/written only here.

interface ListMessagesFilters {
  agentId?: string;
  direction?: string;
  type?: string;
  unread?: boolean;
  threadId?: string;
  limit?: number | string;
  offset?: number | string;
}

export async function listMessages(sql: SqlClient, orgId: string, filters: ListMessagesFilters = {}): Promise<Record<string, unknown>[]> {
  const {
    agentId,
    direction = 'inbox',
    type,
    unread,
    threadId,
    limit = 50,
    offset = 0,
  } = filters;

  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (agentId) {
    if (direction === 'sent') {
      conditions.push(`from_agent_id = $${idx}`);
      params.push(agentId);
      idx++;
    } else if (direction === 'inbox') {
      conditions.push(`(to_agent_id = $${idx} OR to_agent_id IS NULL)`);
      params.push(agentId);
      idx++;
      conditions.push(`from_agent_id != $${idx}`);
      params.push(agentId);
      idx++;
    } else {
      conditions.push(`(from_agent_id = $${idx} OR to_agent_id = $${idx} OR to_agent_id IS NULL)`);
      params.push(agentId);
      idx++;
    }
  }

  if (direction === 'inbox') {
    conditions.push("status != 'archived'");
  }
  if (type) {
    conditions.push(`message_type = $${idx}`);
    params.push(type);
    idx++;
  }
  if (unread === true) {
    conditions.push("status = 'sent'");
  }
  if (threadId) {
    conditions.push(`thread_id = $${idx}`);
    params.push(threadId);
    idx++;
  }

  const where = conditions.join(' AND ');
  const rows = await sql.query(
    `SELECT * FROM agent_messages WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return rows;
}

export async function getUnreadMessageCount(sql: SqlClient, orgId: string, agentId: string | null = null): Promise<number> {
  const readerId = agentId || 'dashboard';
  // Broadcast read-state uses jsonb element containment (`?`), not text LIKE:
  // the old pattern match treated `_`/`%` in agent ids as wildcards (an
  // 'agent_1' reader matched any '"agentX1"' entry), so ids that pattern-
  // collide produced false read state. read_by is always written as a JSON
  // array by the PATCH handler.
  if (agentId) {
    const countResult = await sql.query(
      `SELECT COUNT(*)::int as count FROM agent_messages
       WHERE org_id = $1
         AND (to_agent_id = $2 OR to_agent_id IS NULL)
         AND from_agent_id != $2
         AND status = 'sent'
         AND (to_agent_id IS NOT NULL OR read_by IS NULL OR NOT (read_by::jsonb ? $3))`,
      [orgId, agentId, readerId]
    );
    return (countResult[0]?.count as number | undefined) || 0;
  }

  const countResult = await sql`
    SELECT COUNT(*)::int as count FROM agent_messages
    WHERE org_id = ${orgId}
      AND status = 'sent'
      AND (to_agent_id IS NOT NULL OR read_by IS NULL OR NOT (read_by::jsonb ? ${readerId}))
  `;
  return (countResult[0]?.count as number | undefined) || 0;
}

interface CreateMessagePayload {
  id: string;
  orgId: string;
  thread_id?: string | null;
  from_agent_id: string;
  to_agent_id?: string | null;
  message_type: string;
  subject?: string | null;
  body: string;
  urgent?: boolean;
  doc_ref?: string | null;
  now: string;
  [k: string]: unknown;
}

export async function createMessage(sql: SqlClient, payload: CreateMessagePayload): Promise<Record<string, unknown> | null> {
  const {
    id,
    orgId,
    thread_id,
    from_agent_id,
    to_agent_id,
    message_type,
    subject,
    body,
    urgent,
    doc_ref,
    now,
  } = payload;

  const rows = await sql`
    INSERT INTO agent_messages (id, org_id, thread_id, from_agent_id, to_agent_id, message_type, subject, body, urgent, status, doc_ref, read_by, created_at)
    VALUES (
      ${id}, ${orgId}, ${thread_id || null}, ${from_agent_id}, ${to_agent_id || null},
      ${message_type}, ${subject || null}, ${body}, ${urgent || false}, 'sent',
      ${doc_ref || null}, ${to_agent_id ? null : '[]'}, ${now}
    )
    RETURNING *
  `;
  return rows[0] || null;
}

// Advocate v2a: delivery state of assumption-invalidation notifications,
// keyed by the assumption id stored in doc_ref. Message read = acknowledged.
export async function getAssumptionNotificationStates(
  sql: SqlClient,
  orgId: string,
  assumptionIds: string[],
): Promise<Map<string, 'unread' | 'acknowledged'>> {
  const map = new Map<string, 'unread' | 'acknowledged'>();
  if (!assumptionIds.length) return map;
  const rows = await sql`
    SELECT doc_ref, status
    FROM agent_messages
    WHERE org_id = ${orgId}
      AND message_type = 'assumption_invalidated'
      AND doc_ref = ANY(${assumptionIds})
  `;
  for (const r of rows) {
    const state = r.status === 'read' || r.status === 'archived' ? 'acknowledged' : 'unread';
    map.set(String(r.doc_ref), state);
  }
  return map;
}

export async function markBroadcastRead(sql: SqlClient, orgId: string, messageId: string, readBy: unknown): Promise<void> {
  await sql`UPDATE agent_messages SET read_by = ${JSON.stringify(readBy)} WHERE id = ${messageId} AND org_id = ${orgId}`;
}

export async function getMessagesForUpdate(sql: SqlClient, orgId: string, messageIds: unknown[]): Promise<Record<string, unknown>[]> {
  if (!messageIds || messageIds.length === 0) return [];
  return sql`SELECT id, to_agent_id, read_by FROM agent_messages WHERE id = ANY(${messageIds}) AND org_id = ${orgId}`;
}

export async function batchMarkMessagesRead(sql: SqlClient, orgId: string, messageIds: unknown[], now: string): Promise<number> {
  if (!messageIds || messageIds.length === 0) return 0;
  const rows = await sql`
    UPDATE agent_messages SET status = 'read', read_at = ${now}
    WHERE id = ANY(${messageIds}) AND org_id = ${orgId} AND status = 'sent'
    RETURNING id
  `;
  return rows.length;
}

// ── Context Threads ──────────────────────────────────────────
// ct_* context threads are a separate concern from the removed mt_* message
// threads; kept here as the historical home of the agent-context-thread reader.

interface ListContextThreadsFilters {
  agentId?: string;
  status?: string;
  limit?: number | string;
}

export async function listContextThreads(sql: SqlClient, orgId: string, filters: ListContextThreadsFilters = {}): Promise<Record<string, unknown>[]> {
  const { agentId, status, limit = 20 } = filters;
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (agentId) {
    conditions.push(`agent_id = $${idx}`);
    params.push(agentId);
    idx++;
  }
  if (status) {
    conditions.push(`status = $${idx}`);
    params.push(status);
    idx++;
  }

  const where = conditions.join(' AND ');
  return sql.query(
    `SELECT * FROM context_threads WHERE ${where} ORDER BY updated_at DESC LIMIT $${idx}`,
    [...params, limit]
  );
}

interface UpsertContextThreadPayload {
  id: string;
  orgId: string;
  agent_id?: string | null;
  name: string;
  summary?: string | null;
  now: string;
}

export async function upsertContextThread(sql: SqlClient, payload: UpsertContextThreadPayload): Promise<Record<string, unknown> | null> {
  const { id, orgId, agent_id, name, summary, now } = payload;
  const rows = await sql`
    INSERT INTO context_threads (id, org_id, agent_id, name, summary, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${agent_id || null}, ${name}, ${summary || null}, 'active', ${now}, ${now})
    ON CONFLICT (org_id, COALESCE(agent_id, ''), name)
    DO UPDATE SET summary = COALESCE(EXCLUDED.summary, context_threads.summary), status = 'active', updated_at = ${now}
    RETURNING *
  `;
  return rows[0] || null;
}

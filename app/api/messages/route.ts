export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../lib/org';
import { enforceFieldLimits } from '../../lib/validate.js';
import { getSql } from '../../lib/db';
import { scanSensitiveData } from '../../lib/security';
import {
  batchMarkMessagesRead,
  createMessage,
  getMessagesForUpdate,
  getUnreadMessageCount,
  listMessages,
  markBroadcastRead,
} from '../../lib/repositories/messagesContext.repository';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { agentExistsInOrg } from '../../lib/repositories/agents.repository';
import { randomUUID } from 'node:crypto';

// The agent_messages rail survives the v5 cull as internal infrastructure for
// two governance-core flows, NOT as an agent-to-agent messaging product:
//   1. assumption-invalidation notifications (guard surfaces them; the hook
//      acks them via PATCH — see app/lib/assumption-notify.ts + policy-smoke N).
//   2. operator-initiated pairing requests (app/identities/page.tsx POSTs a
//      pairing directive to the target agent and lists sent requests via GET).
// Threads, attachments, the action-message trail, handoffs, and open loops were
// removed with the messaging product; this route keeps only send / list / ack.
const VALID_TYPES = ['action', 'info', 'lesson', 'question', 'status'];
// Reserved sender ids for the human operator / workspace itself. These are not
// agents, so they never appear in agent_presence/identities/etc., but they are
// legitimate same-org senders — the request is already scoped to the caller's
// own org via x-org-id (getOrgId), so allowing them is not a cross-tenant
// spoofing vector.
const HUMAN_SENDER_IDS = new Set(['dashboard']);

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const direction = searchParams.get('direction') || 'inbox';
    const type = searchParams.get('type');
    const unread = searchParams.get('unread');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 1000);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const rows = await listMessages(sql, orgId, {
      agentId: agentId ?? undefined,
      direction,
      type: type ?? undefined,
      unread: unread === 'true',
      limit,
      offset,
    });

    const unreadCount = await getUnreadMessageCount(sql, orgId, agentId || null);

    const readerId = agentId || 'dashboard';
    const messages = rows.map((m: any) => {
      let isRead = m.status === 'read' || m.status === 'archived';
      if (!isRead && m.to_agent_id === null && m.read_by) {
        try {
          const readBy = typeof m.read_by === 'string' ? JSON.parse(m.read_by) : m.read_by;
          isRead = Array.isArray(readBy) && readBy.includes(readerId);
        } catch { /* best-effort: malformed read_by JSON — treated as unread */ }
      }
      return { ...m, is_read: isRead };
    });

    return NextResponse.json({ messages, total: rows.length, unread_count: unreadCount });
  } catch (error) {
    console.error('Messages GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching messages' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { subject: 200, body: 2000 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { from_agent_id, to_agent_id, message_type, subject, body: msgBodyRaw, urgent, doc_ref } = body;

    if (!msgBodyRaw) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }

    const { redacted } = scanSensitiveData(msgBodyRaw);
    const msgBody = redacted;

    if (!from_agent_id) {
      return NextResponse.json({ error: 'from_agent_id is required' }, { status: 400 });
    }

    // SECURITY: verify the claimed from_agent_id actually belongs to this
    // org before accepting the message. Without this gate a caller with a
    // valid API key could spoof a message as originating from an agent in
    // a different org, corrupting the ledger's attribution trail.
    const fromOk = HUMAN_SENDER_IDS.has(from_agent_id) || await agentExistsInOrg(sql, orgId, from_agent_id);
    if (!fromOk) {
      return NextResponse.json({ error: 'from_agent_id not found in this org' }, { status: 403 });
    }
    if (to_agent_id) {
      const toOk = await agentExistsInOrg(sql, orgId, to_agent_id);
      if (!toOk) {
        return NextResponse.json({ error: 'to_agent_id not found in this org' }, { status: 403 });
      }
    }

    const msgType = message_type || 'info';
    if (!VALID_TYPES.includes(msgType)) {
      return NextResponse.json({ error: `message_type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();

    const created = await createMessage(sql, {
      id,
      orgId,
      thread_id: null,
      from_agent_id,
      to_agent_id,
      message_type: msgType,
      subject,
      body: msgBody,
      urgent,
      doc_ref,
      now,
    });

    // Emit real-time event
    void publishOrgEvent(EVENTS.MESSAGE_CREATED, {
      orgId,
      message: created,
    });

    return NextResponse.json({ message: created, message_id: id }, { status: 201 });
  } catch (error) {
    console.error('Messages POST error:', error);
    return NextResponse.json({ error: 'An error occurred while sending message' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { message_ids, action, agent_id } = body;

    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
      return NextResponse.json({ error: 'message_ids array is required' }, { status: 400 });
    }
    if (action !== 'read') {
      return NextResponse.json({ error: 'action must be "read"' }, { status: 400 });
    }

    const now = new Date().toISOString();
    let updated = 0;

    const readerId = agent_id || 'dashboard';
    // Batch-fetch all messages in one query instead of N sequential queries
    const messages = await getMessagesForUpdate(sql, orgId, message_ids);

    // Separate broadcasts (to_agent_id IS NULL) from targeted messages
    const directReadIds = [];
    const broadcastUpdates: { id: string; readBy: any[] }[] = [];

    for (const msg of messages) {
      if (msg.to_agent_id === null) {
        let readBy = [];
        try {
          const parsed = typeof msg.read_by === 'string' ? JSON.parse(msg.read_by || '[]') : (msg.read_by || []);
          readBy = Array.isArray(parsed) ? parsed : [];
        } catch {
          readBy = [];
        }
        if (!readBy.includes(readerId)) {
          readBy.push(readerId);
          broadcastUpdates.push({ id: msg.id as string, readBy });
        }
      } else if (readerId === 'dashboard' || msg.to_agent_id === readerId) {
        directReadIds.push(msg.id);
      }
    }

    // Batch update targeted messages in one query
    const directCount = await batchMarkMessagesRead(sql, orgId, directReadIds, now);
    updated += directCount;

    // Broadcast read_by updates must remain per-message (each has unique read_by array),
    // but the writes are independent — run them in parallel
    await Promise.all(
      broadcastUpdates.map(({ id, readBy }) => markBroadcastRead(sql, orgId, id, readBy))
    );
    updated += broadcastUpdates.length;

    return NextResponse.json({ updated });
  } catch (error) {
    console.error('Messages PATCH error:', error);
    return NextResponse.json({ error: 'An error occurred while updating messages' }, { status: 500 });
  }
}

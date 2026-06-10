export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';
import { getSql } from '../../../lib/db';
import { scanSensitiveData } from '../../../lib/security';
import {
  archiveMessage,
  batchArchiveMessages,
  batchMarkMessagesRead,
  createAttachment,
  createMessage,
  getAttachmentsForMessages,
  getMessageForUpdate,
  getMessagesForUpdate,
  getMessageThread,
  getUnreadMessageCount,
  listMessages,
  markBroadcastRead,
  markMessageRead,
  touchMessageThread,
  updateMessageReadBy,
} from '../../../lib/repositories/messagesContext.repository';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { randomUUID } from 'node:crypto';

const VALID_TYPES = ['action', 'info', 'lesson', 'question', 'status'];
const ALLOWED_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
];
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ATTACHMENTS_PER_MESSAGE = 3;

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const direction = searchParams.get('direction') || 'inbox';
    const type = searchParams.get('type');
    const unread = searchParams.get('unread');
    const threadId = searchParams.get('thread_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 1000);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const rows = await listMessages(sql, orgId, {
      agentId,
      direction,
      type,
      unread: unread === 'true',
      threadId,
      limit,
      offset,
    });

    const unreadCount = await getUnreadMessageCount(sql, orgId, agentId || null);

    // Batch-fetch attachment metadata for returned messages
    const messageIds = rows.map(m => m.id);
    let attachments = [];
    try {
      attachments = await getAttachmentsForMessages(sql, orgId, messageIds);
    } catch {
      // Table may not exist yet — gracefully degrade
    }
    const attachmentsByMsg = {};
    for (const att of attachments) {
      if (!attachmentsByMsg[att.message_id]) attachmentsByMsg[att.message_id] = [];
      attachmentsByMsg[att.message_id].push(att);
    }
    const readerId = agentId || 'dashboard';
    const messagesWithAttachments = rows.map(m => {
      let isRead = m.status === 'read' || m.status === 'archived';
      if (!isRead && m.to_agent_id === null && m.read_by) {
        try {
          const readBy = typeof m.read_by === 'string' ? JSON.parse(m.read_by) : m.read_by;
          isRead = Array.isArray(readBy) && readBy.includes(readerId);
        } catch { /* ignore */ }
      }
      return { ...m, attachments: attachmentsByMsg[m.id] || [], is_read: isRead };
    });

    return NextResponse.json({ messages: messagesWithAttachments, total: rows.length, unread_count: unreadCount });
  } catch (error) {
    console.error('Messages GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching messages' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { subject: 200, body: 2000 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { from_agent_id, to_agent_id, message_type, subject, body: msgBodyRaw, thread_id, urgent, doc_ref, attachments: rawAttachments } = body;

    if (!msgBodyRaw) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }

    const { redacted } = scanSensitiveData(msgBodyRaw);
    const msgBody = redacted;

    if (!from_agent_id) {
      return NextResponse.json({ error: 'from_agent_id is required' }, { status: 400 });
    }

    const msgType = message_type || 'info';
    if (!VALID_TYPES.includes(msgType)) {
      return NextResponse.json({ error: `message_type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    if (thread_id) {
      if (thread_id.startsWith('ct_')) {
        return NextResponse.json({
          error: 'Invalid thread type: context threads (ct_*) cannot be used for messaging. Use createMessageThread() to create a message thread (mt_*).',
        }, { status: 400 });
      }
      const thread = await getMessageThread(sql, orgId, thread_id);
      if (!thread) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }
      if (thread.status !== 'open') {
        return NextResponse.json({ error: 'Thread is not open' }, { status: 400 });
      }
    }

    // Validate attachments
    const attachmentInputs = Array.isArray(rawAttachments) ? rawAttachments : [];
    if (attachmentInputs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      return NextResponse.json({ error: `Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message` }, { status: 400 });
    }
    for (const att of attachmentInputs) {
      if (!att.filename || !att.mime_type || !att.data) {
        return NextResponse.json({ error: 'Each attachment requires filename, mime_type, and data' }, { status: 400 });
      }
      if (!ALLOWED_MIME_TYPES.includes(att.mime_type)) {
        return NextResponse.json({ error: `Unsupported MIME type: ${att.mime_type}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` }, { status: 400 });
      }
      const sizeBytes = Math.ceil((att.data.length * 3) / 4);
      if (sizeBytes > MAX_ATTACHMENT_SIZE) {
        return NextResponse.json({ error: `Attachment "${att.filename}" exceeds 5MB limit` }, { status: 400 });
      }
    }

    const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();

    const created = await createMessage(sql, {
      id,
      orgId,
      thread_id,
      from_agent_id,
      to_agent_id,
      message_type: msgType,
      subject,
      body: msgBody,
      urgent,
      doc_ref,
      now,
    });

    // Create attachments
    const createdAttachments = [];
    for (const att of attachmentInputs) {
      const attId = `att_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const sizeBytes = Math.ceil((att.data.length * 3) / 4);
      const result = await createAttachment(sql, {
        id: attId,
        orgId,
        messageId: id,
        filename: att.filename,
        mimeType: att.mime_type,
        sizeBytes,
        data: att.data,
        now,
      });
      if (result) createdAttachments.push(result);
    }

    if (thread_id) {
      await touchMessageThread(sql, orgId, thread_id, now);
    }

    const messageWithAttachments = { ...created, attachments: createdAttachments };

    // Emit real-time event
    void publishOrgEvent(EVENTS.MESSAGE_CREATED, {
      orgId,
      message: messageWithAttachments,
    });

    return NextResponse.json({ message: messageWithAttachments, message_id: id }, { status: 201 });
  } catch (error) {
    console.error('Messages POST error:', error);
    return NextResponse.json({ error: 'An error occurred while sending message' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { message_ids, action, agent_id } = body;

    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
      return NextResponse.json({ error: 'message_ids array is required' }, { status: 400 });
    }
    if (!action || !['read', 'archive'].includes(action)) {
      return NextResponse.json({ error: 'action must be "read" or "archive"' }, { status: 400 });
    }

    const now = new Date().toISOString();
    let updated = 0;

    if (action === 'read') {
      const readerId = agent_id || 'dashboard';
      // Batch-fetch all messages in one query instead of N sequential queries
      const messages = await getMessagesForUpdate(sql, orgId, message_ids);

      // Separate broadcasts (to_agent_id IS NULL) from targeted messages
      const directReadIds = [];
      const broadcastUpdates = []; // { id, readBy }

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
            broadcastUpdates.push({ id: msg.id, readBy });
          }
        } else if (readerId === 'dashboard' || msg.to_agent_id === readerId) {
          directReadIds.push(msg.id);
        }
      }

      // Batch update targeted messages in one query
      const directCount = await batchMarkMessagesRead(sql, orgId, directReadIds, now);
      updated += directCount;

      // Broadcast read_by updates must remain per-message (each has unique read_by array)
      for (const { id, readBy } of broadcastUpdates) {
        await markBroadcastRead(sql, orgId, id, readBy);
        updated++;
      }
    } else {
      // Batch archive in one query instead of N sequential queries
      updated = await batchArchiveMessages(sql, orgId, message_ids, now);
    }

    return NextResponse.json({ updated });
  } catch (error) {
    console.error('Messages PATCH error:', error);
    return NextResponse.json({ error: 'An error occurred while updating messages' }, { status: 500 });
  }
}

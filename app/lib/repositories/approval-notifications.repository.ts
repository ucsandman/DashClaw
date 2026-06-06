import crypto from 'node:crypto';
import type { SqlTag } from '../types/db';

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export interface ApprovalNotificationRow {
  id: string;
  org_id: string;
  action_id: string;
  channel: string;
  message_id: string;
  channel_ref: string | null;
  created_at: string;
  cleared_at: string | null;
}

/** Record that an approval message was sent to an external channel for an action. */
export async function recordApprovalNotification(
  sql: SqlTag,
  input: { orgId: string; actionId: string; channel: string; messageId: string; channelRef?: string | null },
): Promise<void> {
  await sql`
    INSERT INTO approval_notifications (id, org_id, action_id, channel, message_id, channel_ref)
    VALUES (${genId('apn')}, ${input.orgId}, ${input.actionId}, ${input.channel}, ${input.messageId}, ${input.channelRef ?? null})
  `;
}

/** All not-yet-cleared notifications for an action (the messages still showing a live approval). */
export async function listOpenApprovalNotifications(
  sql: SqlTag,
  orgId: string,
  actionId: string,
): Promise<ApprovalNotificationRow[]> {
  const rows = await sql`
    SELECT id, org_id, action_id, channel, message_id, channel_ref, created_at, cleared_at
    FROM approval_notifications
    WHERE org_id = ${orgId} AND action_id = ${actionId} AND cleared_at IS NULL
  `;
  return rows as unknown as ApprovalNotificationRow[];
}

/** Stamp every open notification for an action as cleared (after a resolution fan-out). */
export async function markApprovalNotificationsCleared(
  sql: SqlTag,
  orgId: string,
  actionId: string,
): Promise<void> {
  await sql`
    UPDATE approval_notifications
    SET cleared_at = NOW()
    WHERE org_id = ${orgId} AND action_id = ${actionId} AND cleared_at IS NULL
  `;
}

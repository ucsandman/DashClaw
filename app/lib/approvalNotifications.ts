/**
 * Approval notification fan-out — "approve once → clears everywhere".
 *
 * When an approval message is sent to an external channel (Discord/Telegram) we
 * record its provider message id. When the action is later resolved through ANY
 * surface (dashboard, widget, Discord button, Telegram button), we edit the
 * message in every OTHER channel to a resolved state and stamp it cleared, so a
 * stale "approve me" message never lingers in a channel you didn't act in.
 *
 * Uses the same process.env bot tokens as the senders. Always best-effort —
 * never throws (callers are fire-and-forget / after()).
 */
import {
  recordApprovalNotification,
  listOpenApprovalNotifications,
  markApprovalNotificationsCleared,
} from './repositories/approval-notifications.repository';
import type { SqlTag } from './types/db';

const DISCORD_API = 'https://discord.com/api/v10';
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const FETCH_TIMEOUT_MS = 1500;

export type ApprovalChannel = 'discord' | 'telegram';
// 'expiry' = the approvals lifecycle flipped the row to expired (roadmap
// v2.3); it is not a channel, so every open message gets the resolved edit.
export type ResolvedVia = ApprovalChannel | 'dashboard' | 'expiry';

/** Persist a sent approval message so it can be cleared later. Never throws. */
export async function recordSentApprovalNotification(
  sql: SqlTag,
  input: { orgId: string; actionId: string; channel: ApprovalChannel; messageId: string; channelRef?: string | null },
): Promise<void> {
  try {
    await recordApprovalNotification(sql, input);
  } catch (err) {
    console.warn('[approvalNotifications] record failed:', (err as Error)?.message);
  }
}

function resolvedText(decision: string, resolvedBy: string): string {
  if (decision === 'expire') {
    return '⌛ Expired — the requesting agent stopped waiting for this decision. No action needed here.';
  }
  const verb = decision === 'allow' ? 'approved' : 'denied';
  const icon = decision === 'allow' ? '✅' : '❌';
  const who = (resolvedBy || 'an operator').slice(0, 80);
  return `${icon} Resolved — ${verb} by ${who}. Handled elsewhere; no action needed here.`;
}

async function editDiscordMessage(channelId: string, messageId: string, content: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(
      `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
        body: JSON.stringify({ content, embeds: [], components: [] }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  } catch (err) {
    console.warn('[approvalNotifications] discord edit failed:', (err as Error)?.message);
  }
}

async function editTelegramMessage(chatId: string, messageId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: Number(messageId),
        text,
        reply_markup: { inline_keyboard: [] },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[approvalNotifications] telegram edit failed:', (err as Error)?.message);
  }
}

/**
 * Clear an action's approval messages across every channel except the one that
 * resolved it (which already edited its own message inline), then stamp them
 * cleared. Never throws.
 */
export async function clearApprovalNotifications(
  sql: SqlTag,
  input: { orgId: string; actionId: string; decision: string; resolvedBy: string; resolvedVia?: ResolvedVia },
): Promise<void> {
  try {
    const open = await listOpenApprovalNotifications(sql, input.orgId, input.actionId);
    if (open.length === 0) return;
    const text = resolvedText(input.decision, input.resolvedBy);
    for (const n of open) {
      if (n.channel === input.resolvedVia) continue; // originating channel already edited inline
      if (!n.channel_ref) continue;
      if (n.channel === 'discord') {
        await editDiscordMessage(n.channel_ref, n.message_id, text);
      } else if (n.channel === 'telegram') {
        await editTelegramMessage(n.channel_ref, n.message_id, text);
      }
    }
    await markApprovalNotificationsCleared(sql, input.orgId, input.actionId);
  } catch (err) {
    console.warn('[approvalNotifications] clear failed:', (err as Error)?.message);
  }
}

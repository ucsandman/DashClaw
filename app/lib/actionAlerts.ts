/**
 * Real-time action alerts — fires Discord (and future adapters) immediately
 * when a high-risk, blocked, or approval-required action is recorded.
 * Always fire-and-forget; never throws.
 */

import type { SqlTag } from './types/db';

type AlertType = 'blocked' | 'pending_approval' | 'high_risk';

interface AlertAction {
  agent_id?: string | null;
  action_id?: string | null;
  action_type?: string | null;
  declared_goal?: string | null;
  risk_score?: number | null;
  [key: string]: unknown;
}

interface DiscordEmbed {
  title: string;
  color: number | undefined;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  timestamp: string;
}

const RISK_ALERT_THRESHOLD = 75;

const STATUS_EMOJI: Record<AlertType, string> = {
  blocked: '🚫',
  pending_approval: '⏳',
  high_risk: '⚠️',
};

const STATUS_COLOR: Record<AlertType, number> = {
  blocked: 0xff3333,
  pending_approval: 0xffaa00,
  high_risk: 0xff6600,
};

function buildEmbed(action: AlertAction, alertType: AlertType): DiscordEmbed {
  const emoji = STATUS_EMOJI[alertType];
  const color = STATUS_COLOR[alertType];
  const label =
    alertType === 'blocked' ? 'BLOCKED by policy' :
    alertType === 'pending_approval' ? 'Requires approval' :
    `High risk (score: ${action.risk_score ?? '?'})`;

  return {
    title: `${emoji} DashClaw: ${label}`,
    color,
    fields: [
      { name: 'Agent', value: action.agent_id || 'unknown', inline: true },
      { name: 'Type', value: action.action_type || 'unknown', inline: true },
      { name: 'Risk Score', value: String(action.risk_score ?? 0), inline: true },
      { name: 'Goal', value: (action.declared_goal || '—').slice(0, 200), inline: false },
      ...(action.action_id ? [{ name: 'Action ID', value: action.action_id, inline: false }] : []),
    ],
    timestamp: new Date().toISOString(),
  };
}

async function getDiscordWebhookUrl(sql: SqlTag, orgId: string): Promise<string | null> {
  try {
    const { getSettings } = await import('./repositories/settings.repository');
    const { decrypt } = await import('./encryption');

    // Check alerts are not explicitly disabled
    const toggleRows = await getSettings(sql, orgId, { key: 'DASHCLAW_ALERTS_DISCORD' });
    if (toggleRows?.[0]?.value === 'false') return null;

    const rows = await getSettings(sql, orgId, { key: 'DISCORD_WEBHOOK_URL' });
    const row = rows?.[0];
    if (!row?.value) return null;

    // row.value is a stored URL string at runtime; getSettings types it unknown.
    const url: string | null = row.encrypted
      ? decrypt(row.value, `${orgId}:DISCORD_WEBHOOK_URL`)
      : (row.value as string);

    if (!url || !url.startsWith('https://discord.com/api/webhooks/')) return null;
    return url;
  } catch {
    return null;
  }
}

async function postToDiscord(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok && res.status !== 204) {
    console.warn(`[ActionAlerts] Discord returned ${res.status}`);
  }
}

/**
 * Fire a real-time alert for a notable action event.
 * Returns a promise so callers can hand it to after() or await it — never
 * rejects (errors are logged and swallowed).
 * @param alertType
 * @param action - the action record
 * @param sql - db handle
 * @param orgId
 */
export async function fireActionAlert(
  alertType: AlertType,
  action: AlertAction,
  sql: SqlTag,
  orgId: string,
): Promise<void> {
  // Only alert high_risk if above threshold
  if (alertType === 'high_risk' && (action.risk_score ?? 0) < RISK_ALERT_THRESHOLD) return;

  try {
    const webhookUrl = await getDiscordWebhookUrl(sql, orgId);
    if (!webhookUrl) return;
    const embed = buildEmbed(action, alertType);
    await postToDiscord(webhookUrl, embed);
  } catch (err) {
    console.warn('[ActionAlerts] Failed to send alert:', (err as Error).message);
  }
}

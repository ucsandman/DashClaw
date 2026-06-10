import { safeUrlWithIps, buildPinnedDispatcher } from '../webhooks';
import type {
  AdapterCreds,
  AdapterResult,
  GovernanceSignal,
  NotificationAdapter,
} from './index';

// `dispatcher` is an undici extension to the fetch init that the DOM lib
// types don't model; widen the init locally to pass it through unchanged.
type FetchInitWithDispatcher = RequestInit & { dispatcher?: unknown };

// Brand orange (#f97316). The ONE hex permitted in-code per .impeccable.md
// because Discord's embed color field requires a 24-bit integer, not a CSS
// token. Mirrors app/lib/discordApprovals.js:19.
const BRAND_ORANGE = 0xf97316;
const FETCH_TIMEOUT_MS = 2000;

/**
 * Mask an org_id to first 8 chars + "..." for privacy in launch-window
 * alert channels. Operator still recognizes which org; raw id is not
 * preserved in chat history (T-03-02-03 mitigation).
 */
export function maskOrgId(orgId: unknown): string {
  if (!orgId || typeof orgId !== 'string') return 'unknown';
  if (orgId.length <= 8) return orgId;
  return `${orgId.slice(0, 8)}...`;
}

export interface NewConnectAlertContext {
  orgId?: string;
  agentId?: string;
}

/**
 * Fire a lightweight Discord alert when a new org completes its first
 * action_record (launch-window telemetry per DOG-04 Claude's Discretion).
 * Fire-and-forget — NEVER throws. Returns void on all paths.
 *
 * Env vars:
 *   DASHCLAW_NEW_CONNECT_WEBHOOK — Discord webhook URL to POST to.
 *     Distinct from DASHCLAW_ALERTS_DISCORD (which is a kill-switch bool
 *     for the approval bridge, not a URL). Separate name avoids
 *     semantic-overload on the existing var.
 *
 * Payload contains ONLY: masked org_id, agent_id, ISO timestamp. NEVER
 * includes API keys, bot tokens, user emails, or full org_id (T-03-02-03).
 */
export async function fireNewConnectAlert(context: NewConnectAlertContext): Promise<void> {
  try {
    const webhookUrl = process.env.DASHCLAW_NEW_CONNECT_WEBHOOK;
    if (!webhookUrl) return; // Opt-in: no env var, no alert.

    const orgId = context?.orgId;
    const agentId = context?.agentId || 'unknown';
    if (!orgId) return;

    const embed = {
      color: BRAND_ORANGE,
      title: 'New /connect completion',
      fields: [
        { name: 'org_id', value: maskOrgId(orgId), inline: true },
        { name: 'agent_id', value: String(agentId).slice(0, 64), inline: true },
        { name: 'timestamp', value: new Date().toISOString(), inline: false },
      ],
    };

    // SSRF protection: pin DNS resolution to a pre-validated IP. Same
    // pattern the discordAdapter.send path uses.
    let validatedIps: string[] = [];
    try {
      validatedIps = await safeUrlWithIps(webhookUrl);
    } catch (err) {
      console.warn('[NewConnectAlert] webhook URL rejected:', (err as Error)?.message);
      return;
    }
    const dispatcher = buildPinnedDispatcher(validatedIps);

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      dispatcher,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    } as FetchInitWithDispatcher);
  } catch (err) {
    // Fire-and-forget — NEVER propagate. Webhook failure must not break
    // action creation (T-03-02-04 availability mitigation).
    console.warn('[NewConnectAlert] fire failed:', (err as Error)?.message || err);
  }
}

export const discordAdapter: NotificationAdapter = {
  name: 'discord',
  requiredKeys: ['DISCORD_WEBHOOK_URL'],

  async send(signals: GovernanceSignal[], creds: AdapterCreds): Promise<AdapterResult> {
    const redCount = signals.filter((s) => s.severity === 'red').length;
    const amberCount = signals.filter((s) => s.severity === 'amber').length;

    const fields = signals.slice(0, 10).map((s) => ({
      name: `${s.severity === 'red' ? '🔴' : '🟡'} ${s.label}`,
      value: s.detail.slice(0, 200) + (s.agent_id ? `\n*Agent:* ${s.agent_id}` : ''),
      inline: false,
    }));

    const embed = {
      title: `DashClaw: ${signals.length} governance signal${signals.length > 1 ? 's' : ''}`,
      description: `**${redCount} critical** · ${amberCount} amber`,
      color: redCount > 0 ? 0xff4444 : 0xffaa00,
      fields,
      timestamp: new Date().toISOString(),
    };

    const webhookUrl = creds.DISCORD_WEBHOOK_URL as string;
    const validatedIps = await safeUrlWithIps(webhookUrl);
    const dispatcher = buildPinnedDispatcher(validatedIps);
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      dispatcher,
    } as FetchInitWithDispatcher);

    if (res.status === 204 || res.ok) return { success: true, message: 'Posted to Discord' };
    return { success: false, message: `Discord returned ${res.status}` };
  },
};

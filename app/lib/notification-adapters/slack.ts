import { safeUrlWithIps, buildPinnedDispatcher } from '../webhooks';
import type {
  AdapterCreds,
  AdapterResult,
  GovernanceSignal,
  NotificationAdapter,
} from './index';

// Use undici's fetch rather than the Node global. The global fetch is backed by
// Node's *internal* undici, a different instance than the standalone `undici`
// package that buildPinnedDispatcher's Agent comes from. Handing that Agent to
// the global fetch as `dispatcher` throws a bare "TypeError: fetch failed" with
// no .cause. Mirrors the fix already applied in webhooks.ts (a52d4478).
import { fetch } from 'undici';

// `dispatcher` is an undici extension to the fetch init that the DOM lib
// types don't model; widen the init locally to pass it through unchanged.
type FetchInitWithDispatcher = Parameters<typeof fetch>[1];

export const slackAdapter: NotificationAdapter = {
  name: 'slack',
  requiredKeys: ['SLACK_BOT_TOKEN', 'SLACK_WEBHOOK_URL'],

  async send(signals: GovernanceSignal[], creds: AdapterCreds): Promise<AdapterResult> {
    const redCount = signals.filter((s) => s.severity === 'red').length;
    const amberCount = signals.filter((s) => s.severity === 'amber').length;

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `DashClaw: ${signals.length} governance signal${signals.length > 1 ? 's' : ''}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${redCount} critical* · ${amberCount} amber` },
      },
      { type: 'divider' },
      ...signals.slice(0, 5).map((s) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${s.severity === 'red' ? ':red_circle:' : ':large_yellow_circle:'} *${s.label}*\n${s.detail}${s.agent_id ? `\n_Agent: ${s.agent_id}_` : ''}`,
        },
      })),
      ...(signals.length > 5 ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `_...and ${signals.length - 5} more_` },
      }] : []),
    ];

    // Prefer webhook URL (simpler), fall back to bot token + channel
    if (creds.SLACK_WEBHOOK_URL) {
      const validatedIps = await safeUrlWithIps(creds.SLACK_WEBHOOK_URL);
      const dispatcher = buildPinnedDispatcher(validatedIps);
      const res = await fetch(creds.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
        dispatcher,
      } as FetchInitWithDispatcher);
      if (!res.ok) return { success: false, message: `Slack webhook returned ${res.status}` };
      return { success: true, message: 'Posted via webhook' };
    }

    const channel = creds.SLACK_CHANNEL_ID;
    if (!channel) return { success: false, message: 'No channel configured' };

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, blocks }),
    });
    // undici's fetch types response.json() as Promise<unknown> (the DOM global
    // typed it any); annotate so the .ok/.error access below still type-checks.
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) return { success: false, message: data.error || 'Slack API error' };
    return { success: true, message: `Posted to #${channel}` };
  },
};

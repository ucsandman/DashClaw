import { describe, expect, it } from 'vitest';
import { detectWebhookDestination, formatWebhookPayload } from '../../app/lib/webhooks';

// Per-destination formatting: Slack/Discord/Teams/PagerDuty reject DashClaw's
// generic JSON. The formatter is keyed by URL host; the generic path must stay
// BYTE-IDENTICAL (production dispatch regression guard).

const SIGNAL_PAYLOAD = {
  event: 'signal.detected',
  signal_type: 'autonomy_spike',
  agent_id: 'clawdbot',
  message: 'Autonomy spike detected for clawdbot',
};

describe('detectWebhookDestination', () => {
  it.each([
    ['https://hooks.slack.com/services/T123/B456/xyz', 'slack'],
    ['https://discord.com/api/webhooks/123/abc', 'discord'],
    ['https://discordapp.com/api/webhooks/123/abc', 'discord'],
    ['https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke', 'teams'],
    ['https://events.pagerduty.com/v2/enqueue', 'pagerduty'],
    ['https://my-api.example.com/hooks', 'generic'],
    ['not a url', 'generic'],
  ])('%s → %s', (url, expected) => {
    expect(detectWebhookDestination(url)).toBe(expected);
  });
});

describe('formatWebhookPayload', () => {
  it('Slack gets {text} with the event summary', () => {
    const { body } = formatWebhookPayload('https://hooks.slack.com/services/T/B/x', 'autonomy_spike', SIGNAL_PAYLOAD);
    expect(JSON.parse(body)).toEqual({ text: '[DashClaw] autonomy_spike — Autonomy spike detected for clawdbot' });
  });

  it('Discord gets {content}', () => {
    const { body } = formatWebhookPayload('https://discord.com/api/webhooks/1/a', 'autonomy_spike', SIGNAL_PAYLOAD);
    expect(JSON.parse(body)).toEqual({ content: '[DashClaw] autonomy_spike — Autonomy spike detected for clawdbot' });
  });

  it('Teams gets the Workflows message + Adaptive Card envelope', () => {
    const { body } = formatWebhookPayload('https://prod-00.westus.logic.azure.com/workflows/x', 'approval_pending', { message: 'Deploy awaits approval' });
    const parsed = JSON.parse(body);
    expect(parsed.type).toBe('message');
    expect(parsed.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(parsed.attachments[0].content.type).toBe('AdaptiveCard');
    expect(parsed.attachments[0].content.body[1].text).toContain('Deploy awaits approval');
  });

  it('PagerDuty lifts routing_key from the URL into an Events v2 body', () => {
    const { url, body } = formatWebhookPayload(
      'https://events.pagerduty.com/v2/enqueue?routing_key=RKEY123',
      'repeated_failures',
      SIGNAL_PAYLOAD,
    );
    expect(url).not.toContain('routing_key');
    const parsed = JSON.parse(body);
    expect(parsed.routing_key).toBe('RKEY123');
    expect(parsed.event_action).toBe('trigger');
    expect(parsed.payload.source).toBe('dashclaw');
    expect(parsed.payload.severity).toBe('error'); // *_failures → error
  });

  it('PagerDuty without a routing_key stays generic (honest failure path)', () => {
    const result = formatWebhookPayload('https://events.pagerduty.com/v2/enqueue', 'autonomy_spike', SIGNAL_PAYLOAD);
    expect(result.destination).toBe('generic');
    expect(JSON.parse(result.body)).toEqual(SIGNAL_PAYLOAD);
  });

  it('generic webhooks are BYTE-IDENTICAL to the pre-formatter serialization', () => {
    const objBody = formatWebhookPayload('https://my-api.example.com/hook', 'autonomy_spike', SIGNAL_PAYLOAD);
    expect(objBody.url).toBe('https://my-api.example.com/hook');
    expect(objBody.body).toBe(JSON.stringify(SIGNAL_PAYLOAD));

    // String payloads (the test-fire path) pass through untouched too.
    const strBody = formatWebhookPayload('https://my-api.example.com/hook', 'test', '{"already":"serialized"}');
    expect(strBody.body).toBe('{"already":"serialized"}');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashClaw } from '../../sdk/dashclaw.js';

afterEach(() => vi.restoreAllMocks());

describe('recorded guard retry identity', () => {
  it('matches action creation, survives retries, and leaves caller input untouched', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(7200000);
    const claw = new DashClaw({ baseUrl: 'https://example.test', apiKey: 'test', agentId: 'agent-1' });
    const post = vi.spyOn(claw, '_post').mockResolvedValue({});
    const input = { action_type: 'test', declared_goal: 'retry recording' };
    await claw.guard(input, { record: true });
    await claw.guard(input, { record: true });
    await claw.createAction(input);
    const keys = post.mock.calls.map(([, body]) => body.idempotency_key);
    expect(keys[0]).toBeTruthy();
    expect(new Set(keys).size).toBe(1);
    expect(input).not.toHaveProperty('idempotency_key');
  });

  it('preserves explicit keys and keeps evaluation-only guards unchanged', async () => {
    const claw = new DashClaw({ baseUrl: 'https://example.test', apiKey: 'test', agentId: 'agent-1' });
    const post = vi.spyOn(claw, '_post').mockResolvedValue({});
    await claw.guard({ idempotency_key: 'caller-key' }, { record: true });
    await claw.guard({ action_type: 'test', declared_goal: 'evaluate only' });
    expect(post.mock.calls[0][1].idempotency_key).toBe('caller-key');
    expect(post.mock.calls[1][1]).not.toHaveProperty('idempotency_key');
  });
});

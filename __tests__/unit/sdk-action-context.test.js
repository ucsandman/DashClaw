import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
const { DashClaw } = await import('../../sdk/dashclaw.js');

describe('DashClaw.actionContext()', () => {
  let claw;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    claw = new DashClaw({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      agentId: 'agent-1',
    });
  });

  it('returns a context object with recordAssumption, updateOutcome', () => {
    const ctx = claw.actionContext('act_123');
    expect(typeof ctx.recordAssumption).toBe('function');
    expect(typeof ctx.updateOutcome).toBe('function');
  });

  it('recordAssumption auto-injects action_id', async () => {
    const ctx = claw.actionContext('act_123');
    await ctx.recordAssumption({ assumption: 'Staging is clear' });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action_id).toBe('act_123');
    expect(body.assumption).toBe('Staging is clear');
  });

  it('updateOutcome calls with the correct action_id in URL', async () => {
    const ctx = claw.actionContext('act_123');
    await ctx.updateOutcome({ status: 'completed', output_summary: 'Done' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/actions/act_123');
    const opts = mockFetch.mock.calls[0][1];
    const body = JSON.parse(opts.body);
    expect(body.status).toBe('completed');
  });
});

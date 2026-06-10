import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers };
}

describe('DashClaw — managed secrets delivery (getAgentEnv)', () => {
  let claw;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ env: { API_TOKEN: 'live-value' }, count: 1, delivered: ['API_TOKEN'] }),
    });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });

  it('GETs /api/secrets/env with the constructor agentId by default', async () => {
    await claw.getAgentEnv();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/secrets/env?agent_id=agent-1');
    expect(c.body).toBeUndefined();
    expect(c.headers['x-api-key']).toBe('k');
  });

  it('passes an explicit agentId override as agent_id', async () => {
    await claw.getAgentEnv({ agentId: 'agent-9' });
    const c = lastCall();
    expect(c.url).toBe('http://localhost:3000/api/secrets/env?agent_id=agent-9');
  });

  it('returns the env map + count + delivered names untouched', async () => {
    const res = await claw.getAgentEnv();
    expect(res).toEqual({ env: { API_TOKEN: 'live-value' }, count: 1, delivered: ['API_TOKEN'] });
  });

  it('throws a status-bearing error on failure (fail-closed, no values in message)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'delivery disabled' }) });
    await expect(claw.getAgentEnv()).rejects.toMatchObject({ message: 'delivery disabled', status: 403 });
  });
});

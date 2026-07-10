import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashClaw } from '../../sdk/dashclaw.js';

describe('SDK team task methods', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sdk = () => new DashClaw({ baseUrl: 'http://dashclaw.test', apiKey: 'oc_live_x', agentId: 'claude-code' });

  it('createTeamTask posts the task body', async () => {
    await sdk().createTeamTask({ id: 't1', instruction: 'i', origin: 'telegram', lead_agent: 'openclaw' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/team-tasks');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).id).toBe('t1');
  });

  it('appendTeamTaskEvent posts to the events path', async () => {
    await sdk().appendTeamTaskEvent('t1', { from_agent: 'claude', to_agent: 'wes', type: 'done', summary: 's' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/team-tasks/t1/events');
    expect(JSON.parse(opts.body).type).toBe('done');
  });

  it('updateTeamTask patches the task', async () => {
    await sdk().updateTeamTask('t1', { status: 'done' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/team-tasks/t1');
    expect(opts.method).toBe('PATCH');
  });
});

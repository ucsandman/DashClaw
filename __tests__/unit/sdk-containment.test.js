import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashClaw } from '../../sdk/dashclaw.js';

describe('SDK containment methods', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sdk = () => new DashClaw({ baseUrl: 'http://dashclaw.test', apiKey: 'oc_live_x', agentId: 'claude-code' });

  it('resolveContainment posts { verdict } to /api/actions/:id/containment', async () => {
    await sdk().resolveContainment('act_1', 'promote');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/actions/act_1/containment');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ verdict: 'promote' });
  });

  it('resolveContainment accepts discard', async () => {
    await sdk().resolveContainment('act_2', 'discard');
    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ verdict: 'discard' });
  });

  it('resolveContainment rejects an invalid verdict before making any HTTP call', async () => {
    await expect(sdk().resolveContainment('act_1', 'approve')).rejects.toThrow(/promote.*discard|discard.*promote/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolveContainment does not send client_capabilities (bare SDK callers have no staging machinery)', async () => {
    await sdk().resolveContainment('act_1', 'promote');
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.client_capabilities).toBeUndefined();
  });

  it('listContained defaults to containment_status=awaiting_promotion', async () => {
    await sdk().listContained();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/actions');
    expect(String(url)).toContain('containment_status=awaiting_promotion');
  });

  it('listContained honors an explicit status and limit', async () => {
    await sdk().listContained({ status: 'contained', limit: 10 });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('containment_status=contained');
    expect(String(url)).toContain('limit=10');
  });
});

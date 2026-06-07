import { beforeEach, describe, expect, it, vi } from 'vitest';
// DEPRECATED SURFACE UNDER TEST: `dashclaw/legacy` (dashclaw-v1.js) is deprecated
// and scheduled for removal in v5.0.0. These tests prove the deprecated-but-live
// legacy surface still functions — do not extend the legacy SDK; build new work
// against the canonical client.
import { DashClaw } from '../../sdk/legacy/dashclaw-v1.js';

function mockFetch(data = {}, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
  });
}

describe('DashClaw legacy SDK capability compatibility', () => {
  let claw;

  beforeEach(() => {
    claw = new DashClaw({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      agentId: 'legacy-agent',
    });
    global.fetch = mockFetch({ ok: true });
  });

  it('listCapabilities GETs the registry route', async () => {
    await claw.listCapabilities({ search: 'slack', risk_level: 'medium' });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain('http://localhost:3000/api/capabilities');
    expect(url).toContain('search=slack');
    expect(url).toContain('risk_level=medium');
    expect(opts.method).toBe('GET');
  });

  it('createCapability POSTs to the registry route', async () => {
    await claw.createCapability({ name: 'Slack Notify', source_type: 'http_api' });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/capabilities');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      name: 'Slack Notify',
      source_type: 'http_api',
    });
  });

  it('getCapability GETs the detail route', async () => {
    await claw.getCapability('cap_123');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/capabilities/cap_123');
    expect(opts.method).toBe('GET');
  });

  it('updateCapability PATCHes the detail route', async () => {
    await claw.updateCapability('cap_123', { risk_level: 'high' });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/capabilities/cap_123');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ risk_level: 'high' });
  });

  it('invokeCapability POSTs with the default agent_id', async () => {
    await claw.invokeCapability('cap_123', { query: 'What is x402?' });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/capabilities/cap_123/invoke');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      query: 'What is x402?',
      agent_id: 'legacy-agent',
    });
  });

  it('testCapability POSTs to the test route', async () => {
    await claw.testCapability('cap_123', { query: 'ping' });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/capabilities/cap_123/test');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      query: 'ping',
      agent_id: 'legacy-agent',
    });
  });

  it('getCapabilityHealth GETs the per-capability health route', async () => {
    await claw.getCapabilityHealth('cap_123');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/capabilities/cap_123/health');
    expect(opts.method).toBe('GET');
  });

  it('listCapabilityHealth GETs the collection health route', async () => {
    await claw.listCapabilityHealth({ limit: 5 });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain('http://localhost:3000/api/capabilities/health');
    expect(url).toContain('limit=5');
    expect(opts.method).toBe('GET');
  });
});

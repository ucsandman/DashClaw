import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
// Mocked below via vi.mock (hoisted); imported here to assert constructor args.
import { DashClawClient } from '../../mcp-server/lib/client.js';

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('../../mcp-server/lib/client.js', () => ({
  DashClawClient: vi.fn(function () {
    this.post = mockPost;
    this.get = mockGet;
    this.patch = mockPatch;
    this.agentId = '';
  }),
}));

const { POST } = await import('../../app/api/mcp/route.js');

describe('POST /api/mcp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('handles initialize request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test', 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(1);
    expect(data.result.serverInfo.name).toBe('@dashclaw/mcp-server');
    expect(data.result.capabilities.tools).toBeDefined();
    expect(data.result.capabilities.resources).toBeDefined();
  });

  it('handles notifications/initialized request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: null, method: 'notifications/initialized', params: {} },
    });

    const res = await POST(request);

    // JSON-RPC 2.0: notifications must not receive a response body.
    expect(res.status).toBe(204);
  });

  it('handles tools/list request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.tools).toHaveLength(17);
    expect(data.result.tools.map(t => t.name)).toContain('dashclaw_guard');
    expect(data.result.tools.map(t => t.name)).toContain('dashclaw_assumption_record');
    expect(data.result.tools[0].inputSchema).toBeDefined();
  });

  it('handles tools/call for dashclaw_guard', async () => {
    mockPost.mockResolvedValue({ decision: 'allow', reason: 'low risk' });

    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'dashclaw_guard',
          arguments: { action_type: 'deploy', declared_goal: 'test', risk_score: 20 },
        },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.content[0].type).toBe('text');
    expect(JSON.parse(data.result.content[0].text).decision).toBe('allow');
  });

  it('returns error for unknown tool in tools/call', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 99, method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.error.code).toBe(-32602);
  });

  it('handles resources/list request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.resources.length).toBeGreaterThanOrEqual(2);
    expect(data.result.resourceTemplates).toBeDefined();
  });

  it('handles resources/read for dashclaw://policies', async () => {
    mockGet.mockResolvedValue({ policies: [{ id: 'gp_1' }] });

    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'dashclaw://policies' } },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.contents[0].uri).toBe('dashclaw://policies');
    expect(JSON.parse(data.result.contents[0].text).policies).toHaveLength(1);
  });

  it('handles resources/read for agent history template', async () => {
    mockGet.mockResolvedValue({ actions: [{ id: 'act_1' }] });

    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 6, method: 'resources/read',
        params: { uri: 'dashclaw://agent/agent_abc/history' },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result.contents[0].uri).toBe('dashclaw://agent/agent_abc/history');
    expect(mockGet).toHaveBeenCalledWith('/api/actions', { agent_id: 'agent_abc', limit: '50' }, expect.any(Object));
  });

  it('returns error for unknown resource in resources/read', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: {
        jsonrpc: '2.0', id: 7, method: 'resources/read',
        params: { uri: 'dashclaw://unknown' },
      },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.error.code).toBe(-32602);
  });

  it('handles ping request', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 8, method: 'ping', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.result).toEqual({});
  });

  it('returns method not found for unknown methods', async () => {
    const request = makeRequest('http://localhost:3000/api/mcp', {
      headers: { 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 6, method: 'unknown/method', params: {} },
    });

    const res = await POST(request);
    const data = await res.json();

    expect(data.error.code).toBe(-32601);
  });

  it('prefers the trusted Vercel production domain over a spoofed Host (SSRF/cred-leak defense)', async () => {
    // The route forwards the caller credential to this origin, so it must come from
    // a trusted server-set source — never an attacker-controllable Host header.
    vi.stubEnv('DASHCLAW_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'my-dashclaw.vercel.app');
    const request = makeRequest('https://my-dashclaw.vercel.app/api/mcp', {
      headers: { host: 'evil.example', authorization: 'Bearer oat_secret' },
      body: { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
    });
    await POST(request);
    expect(DashClawClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://my-dashclaw.vercel.app', authHeader: 'Bearer oat_secret' }),
    );
    vi.unstubAllEnvs();
  });

  it('never targets the protection-walled VERCEL_URL; falls back to Host only when no trusted origin is set', async () => {
    // VERCEL_URL is the per-deployment URL behind Vercel deployment protection;
    // using it makes tool calls get back an HTML SSO page instead of JSON.
    vi.stubEnv('DASHCLAW_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    vi.stubEnv('VERCEL_URL', 'my-dashclaw-deadbeef-ucsandmans-projects.vercel.app');
    const request = makeRequest('https://my-dashclaw.vercel.app/api/mcp', {
      headers: { host: 'my-dashclaw.vercel.app', authorization: 'Bearer oat_x' },
      body: { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
    });
    await POST(request);
    expect(DashClawClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://my-dashclaw.vercel.app', authHeader: 'Bearer oat_x' }),
    );
    vi.unstubAllEnvs();
  });

  it('pins the claude-desktop server-level identity for OAuth Bearer (connector) callers', async () => {
    // Identity is a governance primitive: without a server-level agentId the
    // write-identity fallback lets the LLM pick its own agent_id per call.
    const request = makeRequest('https://my-dashclaw.vercel.app/api/mcp', {
      headers: { host: 'my-dashclaw.vercel.app', authorization: 'Bearer oat_x' },
      body: { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
    });
    await POST(request);
    expect(DashClawClient).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'claude-desktop' }),
    );
  });

  it('does NOT inject an agent identity for x-api-key callers (Managed Agents keep their behavior)', async () => {
    const request = makeRequest('https://my-dashclaw.vercel.app/api/mcp', {
      headers: { host: 'my-dashclaw.vercel.app', 'x-api-key': 'oc_live_test' },
      body: { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
    });
    await POST(request);
    const call = DashClawClient.mock.calls.at(-1)[0];
    expect(call.agentId).toBeUndefined();
  });

  it('pins the identity on dual-header requests: the Bearer credential is what the client forwards', async () => {
    // DashClawClient._authHeaders prefers Authorization over x-api-key, so the
    // identity decision must follow the credential that is actually used.
    const request = makeRequest('https://my-dashclaw.vercel.app/api/mcp', {
      headers: {
        host: 'my-dashclaw.vercel.app',
        'x-api-key': 'oc_live_test',
        authorization: 'Bearer oat_x',
      },
      body: { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
    });
    await POST(request);
    expect(DashClawClient).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'claude-desktop' }),
    );
  });
});

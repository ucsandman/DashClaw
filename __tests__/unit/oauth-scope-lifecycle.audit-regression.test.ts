// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_DEFINITIONS } from '../../mcp-server/lib/tools.js';
import { rotateRefreshToken } from '../../app/lib/repositories/oauth.repository.js';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware } = await import('../../middleware.js');
const originalEnv = { ...process.env };
let requestCounter = 0;

function oauthRequest(
  pathname: string,
  { method = 'GET', token = `oat_scope_${++requestCounter}`, body }: {
    method?: string;
    token?: string;
    body?: Record<string, unknown>;
  } = {},
) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers({
      host: 'localhost:3000',
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    }),
    cookies: { get: () => undefined },
    ip: `127.0.0.${(requestCounter % 200) + 1}`,
    clone: () => ({ json: async () => body }),
  };
}

function row(scope: string, overrides: Record<string, unknown> = {}) {
  return {
    org_id: 'org_oauth',
    client_id: 'ocl_1',
    user_id: 'usr_1',
    scope,
    agent_id: 'claude-desktop',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.DATABASE_URL = 'postgres://ep-oauth.neon.tech/db';
  process.env.DASHCLAW_API_KEY = 'configured-operator-key-fixture';
  sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = Array.from(strings).join(' ');
    return text.includes('SELECT org_id') ? [row('governance:read')] : [];
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
});

describe('F03: OAuth scopes constrain effective authority', () => {
  it('attests canonical OAuth scope and auth kind on an allowed read', async () => {
    const response = await middleware(oauthRequest('/api/actions'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-auth-kind')).toBe('oauth');
    expect(response.headers.get('x-middleware-request-x-oauth-scope')).toBe('governance:read');
    expect(response.headers.get('x-middleware-request-x-user-id')).toBe('oauth:client:ocl_1:user:usr_1');
  });

  it('replaces a forged human id with a stable OAuth client principal when no user is persisted', async () => {
    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = Array.from(strings).join(' ');
      return text.includes('SELECT org_id') ? [row('governance:read', { user_id: null })] : [];
    });
    const request = oauthRequest('/api/actions');
    request.headers.set('x-user-id', 'usr_forged_admin');
    const response = await middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-auth-kind')).toBe('oauth');
    expect(response.headers.get('x-middleware-request-x-user-id')).toBe('oauth:client:ocl_1');
  });

  it('blocks an HTTP write made with governance:read', async () => {
    const response = await middleware(oauthRequest('/api/actions', { method: 'POST' }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('insufficient_scope');
  });

  it('allows HTTP reads and writes with governance:write', async () => {
    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = Array.from(strings).join(' ');
      return text.includes('SELECT org_id') ? [row('governance:write')] : [];
    });
    expect((await middleware(oauthRequest('/api/actions'))).status).toBe(200);
    expect((await middleware(oauthRequest('/api/actions', { method: 'POST' }))).status).toBe(200);
  });

  it('default-denies absent, malformed, and unknown persisted scopes', async () => {
    for (const scope of ['', 'governance:read unknown:scope', 'unknown:scope']) {
      sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
        const text = Array.from(strings).join(' ');
        return text.includes('SELECT org_id') ? [row(scope)] : [];
      });
      const response = await middleware(oauthRequest('/api/actions'));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('insufficient_scope');
    }
  });

  it('strips caller-supplied OAuth attestation headers from non-OAuth principals', async () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/dashclaw';
    process.env.DASHCLAW_MODE = 'self_host';
    const url = 'http://localhost:3000/api/actions';
    const request = {
      url,
      method: 'GET',
      nextUrl: new URL(url),
      headers: new Headers({
        'x-api-key': 'configured-operator-key-fixture',
        'x-auth-kind': 'oauth',
        'x-oauth-scope': 'governance:write',
      }),
      cookies: { get: () => undefined },
      ip: '127.0.0.250',
    };
    const response = await middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-auth-kind')).toBe('operator-key');
    expect(response.headers.get('x-middleware-request-x-oauth-scope')).toBeNull();
  });

  it('classifies every registered MCP tool and lets read scope invoke only read operations', async () => {
    const readTools = new Set([
      'dashclaw_capabilities_list',
      'dashclaw_policies_list',
      'dashclaw_wait_for_approval',
      'dashclaw_session_retro',
      'dashclaw_decisions_recent',
      'dashclaw_plan_status',
    ]);
    const registered = TOOL_DEFINITIONS.map((tool: { name: string }) => tool.name);
    expect(new Set(registered)).toEqual(new Set([
      'dashclaw_guard',
      'dashclaw_record',
      'dashclaw_invoke',
      'dashclaw_capabilities_list',
      'dashclaw_policies_list',
      'dashclaw_wait_for_approval',
      'dashclaw_session_start',
      'dashclaw_session_end',
      'dashclaw_session_retro',
      'dashclaw_task_create',
      'dashclaw_task_event',
      'dashclaw_task_update',
      'dashclaw_assumption_record',
      'dashclaw_decisions_recent',
      'dashclaw_pair',
      'dashclaw_plan_submit',
      'dashclaw_plan_status',
    ]));

    for (const name of registered) {
      const response = await middleware(oauthRequest('/api/mcp', {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } },
      }));
      expect(response.status, name).toBe(readTools.has(name) ? 200 : 403);
    }
  });

  it('allows every registered MCP tool with write scope and default-denies unknown tools', async () => {
    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = Array.from(strings).join(' ');
      return text.includes('SELECT org_id') ? [row('governance:write')] : [];
    });

    for (const { name } of TOOL_DEFINITIONS as Array<{ name: string }>) {
      const response = await middleware(oauthRequest('/api/mcp', {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } },
      }));
      expect(response.status, name).toBe(200);
    }

    const unknown = await middleware(oauthRequest('/api/mcp', {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'future_unclassified_tool' } },
    }));
    expect(unknown.status).toBe(403);
  });

  it('allows protocol reads with read scope and default-denies unknown MCP methods', async () => {
    for (const method of ['initialize', 'notifications/initialized', 'tools/list', 'resources/list', 'resources/read', 'ping']) {
      const response = await middleware(oauthRequest('/api/mcp', {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method, params: {} },
      }));
      expect(response.status, method).toBe(200);
    }
    const unknown = await middleware(oauthRequest('/api/mcp', {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'future/method', params: {} },
    }));
    expect(unknown.status).toBe(403);
  });
});

describe('F28: OAuth cache and refresh lifecycle', () => {
  it('never serves a positive cache entry beyond the access token expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    let tokenRow = row('governance:read', {
      expires_at: new Date(Date.now() + 1000).toISOString(),
    });
    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = Array.from(strings).join(' ');
      return text.includes('SELECT org_id') ? [tokenRow] : [];
    });
    const token = 'oat_short_lived_cache_case';
    expect((await middleware(oauthRequest('/api/actions', { token }))).status).toBe(200);

    vi.advanceTimersByTime(1001);
    tokenRow = row('governance:read', { expires_at: '2026-09-05T12:00:01.000Z' });
    expect((await middleware(oauthRequest('/api/actions', { token }))).status).toBe(401);
  });

  it('rechecks a cached token within the documented ten-second revocation bound', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    let revokedAt: string | null = null;
    sqlMock.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = Array.from(strings).join(' ');
      return text.includes('SELECT org_id') ? [row('governance:read', { revoked_at: revokedAt })] : [];
    });
    const token = 'oat_revocation_bound_case';
    expect((await middleware(oauthRequest('/api/actions', { token }))).status).toBe(200);

    revokedAt = '2026-09-05T12:00:01.000Z';
    vi.advanceTimersByTime(10_001);
    expect((await middleware(oauthRequest('/api/actions', { token }))).status).toBe(401);
  });

  it('atomically consumes a refresh token with one conditional UPDATE RETURNING', async () => {
    const sql = vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [{
      client_id: 'ocl_1',
      org_id: 'org_1',
      user_id: 'usr_1',
      scope: 'governance:read',
      agent_id: 'claude-desktop',
    }]);
    const result = await rotateRefreshToken(sql as never, 'refresh-hash');
    expect(result?.clientId).toBe('ocl_1');
    expect(sql).toHaveBeenCalledTimes(1);
    const statement = (sql.mock.calls[0]?.[0] as unknown as string[]).join(' ');
    expect(statement).toContain('UPDATE oauth_access_tokens');
    expect(statement).toContain('revoked_at IS NULL');
    expect(statement).toContain('RETURNING client_id');
  });
});

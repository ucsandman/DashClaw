import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch, mockSafeUrlWithIps, mockBuildPinnedDispatcher } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockSafeUrlWithIps: vi.fn(),
  mockBuildPinnedDispatcher: vi.fn(),
}));
// The adapter calls undici's `fetch`, NOT the Node global — the pinned Agent it
// passes as `dispatcher` comes from the standalone undici package, and handing
// that to the global fetch throws a causeless "TypeError: fetch failed"
// (commit a52d4478). So the mock has to intercept the module, not the global;
// stubGlobal('fetch') silently misses and every call assertion reads zero.
vi.mock('undici', () => ({ fetch: mockFetch, Agent: vi.fn() }));

vi.mock('@/lib/webhooks.js', async () => {
  const actual = await vi.importActual('@/lib/webhooks.js');
  return {
    ...actual,
    safeUrlWithIps: mockSafeUrlWithIps,
    buildPinnedDispatcher: mockBuildPinnedDispatcher,
  };
});

// Re-import the module fresh each test so env-var changes are picked up.
async function loadModule() {
  vi.resetModules();
  return import('../../app/lib/notification-adapters/discord.js');
}

const ORIGINAL_ENV = { ...process.env };

describe('fireNewConnectAlert — opt-in + privacy gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSafeUrlWithIps.mockResolvedValue(['1.2.3.4']);
    mockBuildPinnedDispatcher.mockReturnValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    delete process.env.DASHCLAW_NEW_CONNECT_WEBHOOK;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('Case 3: env var unset → no fetch (opt-in)', async () => {
    const { fireNewConnectAlert } = await loadModule();
    await fireNewConnectAlert({ orgId: 'org_longvalue_here', agentId: 'claude-code' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('env var set + orgId missing → no fetch (defensive)', async () => {
    process.env.DASHCLAW_NEW_CONNECT_WEBHOOK = 'https://discord.com/api/webhooks/1/abc';
    const { fireNewConnectAlert } = await loadModule();
    await fireNewConnectAlert({ orgId: null, agentId: 'claude-code' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('Case 1: env var set + first action → fetch called with embed payload', async () => {
    process.env.DASHCLAW_NEW_CONNECT_WEBHOOK = 'https://discord.com/api/webhooks/1/abc';
    const { fireNewConnectAlert } = await loadModule();
    await fireNewConnectAlert({ orgId: 'org_longvalue_here', agentId: 'claude-code' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://discord.com/api/webhooks/1/abc');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toHaveProperty('embeds');
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toMatch(/new.*connect/i);
  });

  it('Case 5a: payload contains masked org_id (first 8 chars + "...") — not raw id', async () => {
    process.env.DASHCLAW_NEW_CONNECT_WEBHOOK = 'https://discord.com/api/webhooks/1/abc';
    const { fireNewConnectAlert } = await loadModule();
    await fireNewConnectAlert({
      orgId: 'org_super_long_id_that_must_be_masked',
      agentId: 'claude-code',
    });
    const rawBody = mockFetch.mock.calls[0][1].body;
    const body = JSON.parse(rawBody);
    const orgField = body.embeds[0].fields.find((f) => f.name === 'org_id');
    expect(orgField.value).toBe('org_supe...');
    // Negative: raw id must NOT appear anywhere in the serialized body
    expect(rawBody).not.toContain('org_super_long_id_that_must_be_masked');
  });

  it('Case 5b: payload contains NO API keys, bot tokens, or env var values', async () => {
    process.env.DASHCLAW_NEW_CONNECT_WEBHOOK = 'https://discord.com/api/webhooks/1/abc';
    process.env.DASHCLAW_API_KEY = 'dck_fake_key_must_not_leak_abcdef123';
    process.env.DISCORD_BOT_TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkw';
    const { fireNewConnectAlert } = await loadModule();
    await fireNewConnectAlert({ orgId: 'org_longvalue_here', agentId: 'claude-code' });
    const raw = mockFetch.mock.calls[0][1].body;
    expect(raw).not.toContain('dck_fake_key_must_not_leak_abcdef123');
    expect(raw).not.toContain('MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkw');
    expect(raw).not.toMatch(/DASHCLAW_API_KEY|DISCORD_BOT_TOKEN/);
  });

  it('Case 4: fetch throwing does NOT propagate (fire-and-forget)', async () => {
    process.env.DASHCLAW_NEW_CONNECT_WEBHOOK = 'https://discord.com/api/webhooks/1/abc';
    mockFetch.mockRejectedValue(new Error('network down'));
    const { fireNewConnectAlert } = await loadModule();
    // Must not throw
    await expect(
      fireNewConnectAlert({ orgId: 'org_longvalue_here', agentId: 'claude-code' }),
    ).resolves.toBeUndefined();
  });

  it('safeUrlWithIps rejection (SSRF or bad URL) does NOT propagate', async () => {
    process.env.DASHCLAW_NEW_CONNECT_WEBHOOK = 'https://discord.com/api/webhooks/1/abc';
    mockSafeUrlWithIps.mockRejectedValue(new Error('resolves to private IP'));
    const { fireNewConnectAlert } = await loadModule();
    await expect(
      fireNewConnectAlert({ orgId: 'org_longvalue_here', agentId: 'claude-code' }),
    ).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('maskOrgId helper', () => {
  it('returns "unknown" for null/undefined', async () => {
    const { maskOrgId } = await loadModule();
    expect(maskOrgId(null)).toBe('unknown');
    expect(maskOrgId(undefined)).toBe('unknown');
    expect(maskOrgId('')).toBe('unknown');
  });

  it('returns value unchanged for short ids (≤8 chars)', async () => {
    const { maskOrgId } = await loadModule();
    expect(maskOrgId('short')).toBe('short');
    expect(maskOrgId('abc12345')).toBe('abc12345');
  });

  it('masks long ids to first 8 chars + "..."', async () => {
    const { maskOrgId } = await loadModule();
    expect(maskOrgId('org_longvalue_here')).toBe('org_long...');
  });
});

// Case 2: Second action for same org → webhook NOT called. This is
// enforced by the caller (isFirstActionForOrg check in
// app/api/actions/route.js), not by fireNewConnectAlert itself. The
// isFirstActionForOrg repository helper is tested below against the
// SELECT 1 ... LIMIT 1 contract.
describe('isFirstActionForOrg repository helper', () => {
  it('returns true when no other action_records exist for the org', async () => {
    const sqlRows = [];
    const sql = (strings, ...values) => {
      // Tagged template path only — helper uses template literal, not .query().
      return Promise.resolve(sqlRows);
    };
    const { isFirstActionForOrg } = await import('../../app/lib/repositories/actions.repository.js');
    const result = await isFirstActionForOrg(sql, 'org_1', 'act_new');
    expect(result).toBe(true);
  });

  it('returns false when a prior action_record exists', async () => {
    const sql = () => Promise.resolve([{ '?column?': 1 }]);
    const { isFirstActionForOrg } = await import('../../app/lib/repositories/actions.repository.js');
    const result = await isFirstActionForOrg(sql, 'org_1', 'act_new');
    expect(result).toBe(false);
  });
});

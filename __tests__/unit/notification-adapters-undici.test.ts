// Regression test for a52d4478 ("use undici fetch so the pinned Agent
// dispatcher works") not being mirrored into the discord/slack adapters.
//
// buildPinnedDispatcher (app/lib/webhooks.ts) hands out an Agent from the
// standalone `undici` package. Node's *global* fetch is backed by Node's
// internal undici, a different instance — passing that Agent to the global
// fetch as `dispatcher` throws a causeless "TypeError: fetch failed". The
// fix is to call undici's own `fetch` export instead of the global. This
// test mocks the `undici` module's `fetch` and asserts the adapters call
// it (with the dispatcher in the init) rather than the global fetch — if
// an adapter used the global fetch, the mock would never be hit and the
// assertions below would fail.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUndiciFetch, SENTINEL_DISPATCHER } = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
  SENTINEL_DISPATCHER: { __sentinel: 'pinned-agent' },
}));

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: mockUndiciFetch,
  };
});

vi.mock('@/lib/webhooks', () => ({
  safeUrlWithIps: vi.fn().mockResolvedValue(['203.0.113.10']),
  buildPinnedDispatcher: vi.fn().mockReturnValue(SENTINEL_DISPATCHER),
}));

import { discordAdapter, fireNewConnectAlert } from '@/lib/notification-adapters/discord';
import { slackAdapter } from '@/lib/notification-adapters/slack';

const signals = [
  { severity: 'red', label: 'Runaway loop', detail: 'agent looped 40x', agent_id: 'agt_1' },
];

// A real global-fetch spy: if an adapter regressed to calling the global
// fetch (bypassing the undici import), this catches the call the undici
// mock above would otherwise miss.
let globalFetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUndiciFetch.mockResolvedValue({ ok: true, status: 204, json: async () => ({ ok: true }) });
  globalFetchSpy = vi.fn(async () => {
    throw new Error('global fetch was called — dispatcher mismatch would throw "fetch failed" here');
  });
  vi.stubGlobal('fetch', globalFetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discordAdapter.send uses undici fetch', () => {
  it('posts through the undici fetch, not the global fetch, with the pinned dispatcher in init', async () => {
    const result = await discordAdapter.send(signals, { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x/y' });

    expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();

    const [, init] = mockUndiciFetch.mock.calls[0]!;
    expect(init.dispatcher).toBe(SENTINEL_DISPATCHER);
    expect(result.success).toBe(true);
  });
});

describe('fireNewConnectAlert uses undici fetch', () => {
  it('posts through the undici fetch with the pinned dispatcher in init', async () => {
    vi.stubEnv('DASHCLAW_NEW_CONNECT_WEBHOOK', 'https://discord.com/api/webhooks/x/y');
    await fireNewConnectAlert({ orgId: 'org_12345678abcd', agentId: 'agt_1' });

    expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();

    const [, init] = mockUndiciFetch.mock.calls[0]!;
    expect(init.dispatcher).toBe(SENTINEL_DISPATCHER);
  });
});

describe('slackAdapter.send uses undici fetch (webhook path)', () => {
  it('posts through the undici fetch, not the global fetch, with the pinned dispatcher in init', async () => {
    const result = await slackAdapter.send(signals, { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/x/y/z' });

    expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();

    const [, init] = mockUndiciFetch.mock.calls[0]!;
    expect(init.dispatcher).toBe(SENTINEL_DISPATCHER);
    expect(result.success).toBe(true);
  });
});

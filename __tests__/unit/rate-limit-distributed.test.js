// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The distributed limiter runs on EVERY /api/* request. It must be one
// bounded round trip (a Lua INCR+PEXPIRE script), never the old two
// sequential unbounded calls: a stalled Upstash endpoint used to pend every
// request indefinitely because the fail-open catch only fires on a throw.

async function loadWithUpstash(env = {}) {
  vi.resetModules();
  process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.example.test/';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import('../../middleware.shared.js');
}

function upstashResponse(result) {
  return { ok: true, json: async () => ({ result }) };
}

describe('checkRateLimit — distributed (Upstash) path', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('makes exactly ONE bounded EVAL call on the first hit of a window (no separate PEXPIRE)', async () => {
    fetchMock.mockResolvedValueOnce(upstashResponse(1));
    const { checkRateLimit } = await loadWithUpstash();

    await expect(checkRateLimit('203.0.113.7')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://upstash.example.test');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body[0]).toBe('EVAL');
    expect(body[1]).toMatch(/INCR/);
    expect(body[1]).toMatch(/PEXPIRE/);
    expect(body[2]).toBe(1);
    expect(body[3]).toBe('dashclaw:rl:203.0.113.7');
    expect(Number(body[4])).toBeGreaterThan(0);
  });

  it('denies once the counter passes the window max', async () => {
    fetchMock.mockResolvedValueOnce(upstashResponse(6));
    const { checkRateLimit } = await loadWithUpstash({ DASHCLAW_RATE_LIMIT_MAX: '5' });
    await expect(checkRateLimit('203.0.113.8')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the local limiter when the round trip times out', async () => {
    const abort = new Error('The operation was aborted due to timeout');
    abort.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(abort);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { checkRateLimit } = await loadWithUpstash();

    await expect(checkRateLimit('203.0.113.9')).resolves.toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to local limiter'));
    warn.mockRestore();
  });

  it('honours DASHCLAW_RATE_LIMIT_UPSTASH_TIMEOUT_MS by aborting a stalled call', async () => {
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { checkRateLimit } = await loadWithUpstash({ DASHCLAW_RATE_LIMIT_UPSTASH_TIMEOUT_MS: '20' });

    const started = Date.now();
    await expect(checkRateLimit('203.0.113.10')).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    warn.mockRestore();
  });
});

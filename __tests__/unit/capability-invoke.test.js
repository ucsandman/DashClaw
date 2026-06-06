import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stub the SSRF guard for capability fetches. Production calls real
// safeUrlWithIps + buildPinnedDispatcher to defend against private-IP
// targets and DNS rebinding (see capability-invoke.js fix). The unit
// tests here use fixture URLs (http://localhost, http://example.com)
// and mock global.fetch — they're not exercising the network or the
// SSRF guard, so we substitute a no-op resolver.
vi.mock('../../app/lib/webhooks.js', () => ({
  safeUrlWithIps: vi.fn(async () => ['93.184.216.34']),
  buildPinnedDispatcher: vi.fn(() => undefined),
}));

// capability-invoke.js now imports fetch from undici (so the pinned undici Agent
// dispatcher is honored — Node's built-in fetch is a different undici instance
// that rejects a standalone Agent). Route that import to global.fetch, which
// these tests stub per-case, so the existing assertions keep working.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetch: (...args) => global.fetch(...args) };
});

import {
  invokeCapability,
  resolveAuth,
  RISK_SCORE_MAP,
  calculateBackoffDelay,
  isRetryableResult,
  sleep,
} from '../../app/lib/capability-invoke.js';

describe('RISK_SCORE_MAP', () => {
  it('maps risk levels to scores', () => {
    expect(RISK_SCORE_MAP.low).toBe(20);
    expect(RISK_SCORE_MAP.medium).toBe(50);
    expect(RISK_SCORE_MAP.high).toBe(75);
    expect(RISK_SCORE_MAP.critical).toBe(95);
  });
});

describe('resolveAuth', () => {
  it('returns bearer header when auth type is bearer', () => {
    const auth = { type: 'bearer', token_setting: 'MY_TOKEN' };
    const settings = { MY_TOKEN: 'secret123' };
    expect(resolveAuth(auth, settings)).toEqual({
      Authorization: 'Bearer secret123',
    });
  });

  it('returns api_key header when auth type is api_key', () => {
    const auth = { type: 'api_key', token_setting: 'MY_KEY' };
    const settings = { MY_KEY: 'key123' };
    expect(resolveAuth(auth, settings)).toEqual({
      'x-api-key': 'key123',
    });
  });

  it('returns empty object when auth type is none', () => {
    expect(resolveAuth({ type: 'none' }, {})).toEqual({});
    expect(resolveAuth(null, {})).toEqual({});
  });

  it('throws when token setting not found', () => {
    const auth = { type: 'bearer', token_setting: 'MISSING' };
    expect(() => resolveAuth(auth, {})).toThrow('auth_not_configured');
  });
});

describe('invokeCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('calls endpoint with mapped request and returns mapped response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ answer: 'result', elapsedMs: 100 }),
    });

    const result = await invokeCapability({
      endpoint: 'http://localhost:3849/v1/research',
      method: 'POST',
      authHeaders: { Authorization: 'Bearer token' },
      body: { query: 'test' },
      requestMapping: { query: '$.query' },
      responseMapping: { answer: '$.answer', elapsed_ms: '$.elapsedMs' },
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.data.answer).toBe('result');
    expect(result.data.elapsed_ms).toBe(100);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3849/v1/research',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('returns failure on downstream error', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      requestMapping: null,
      responseMapping: null,
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('capability_error');
    expect(result.status).toBe(500);
  });

  it('omits body and Content-Type when method is GET', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, title: 'Y Combinator' }),
    });

    const result = await invokeCapability({
      endpoint: 'https://hacker-news.firebaseio.com/v0/item/1.json',
      method: 'GET',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init).not.toHaveProperty('body');
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('omits body and Content-Type when method is HEAD', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await invokeCapability({
      endpoint: 'http://example.com/ping',
      method: 'HEAD',
      authHeaders: {},
      body: { ignored: 'field' },
      timeoutMs: 5000,
    });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('HEAD');
    expect(init).not.toHaveProperty('body');
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('normalizes lowercase method to uppercase and treats "get" as bodyless', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'get',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
    });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init).not.toHaveProperty('body');
  });

  it('preserves auth headers on bodyless GET', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'GET',
      authHeaders: { Authorization: 'Bearer token' },
      body: {},
      timeoutMs: 5000,
    });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('still sends body and Content-Type on POST (regression guard)', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: { query: 'test' },
      timeoutMs: 5000,
    });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ query: 'test' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('returns failure on timeout', async () => {
    global.fetch.mockImplementationOnce(() => {
      return new Promise((_, reject) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      requestMapping: null,
      responseMapping: null,
      timeoutMs: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('capability_timeout');
  });

  it('does not include retry_metadata when retryPolicy is absent', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.retry_metadata).toBeUndefined();
  });

  it('retries on timeout and succeeds on second attempt', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    global.fetch
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 2, backoff: 'none' },
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.retry_metadata.total_attempts).toBe(2);
    expect(result.retry_metadata.retried).toBe(true);
  });

  it('retries on network error and succeeds', async () => {
    global.fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 1, backoff: 'none' },
    });

    expect(result.success).toBe(true);
    expect(result.retry_metadata.total_attempts).toBe(2);
  });

  it('retries on 503 status code', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 2, backoff: 'none' },
    });

    expect(result.success).toBe(true);
    expect(result.retry_metadata.total_attempts).toBe(2);
  });

  it('does NOT retry on 400 bad request', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad Request' });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 3, backoff: 'none' },
    });

    expect(result.success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.retry_metadata.total_attempts).toBe(1);
    expect(result.retry_metadata.retried).toBe(false);
  });

  it('does NOT retry on 401 auth error', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 3, backoff: 'none' },
    });

    expect(result.success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('exhausts all retries and returns last failure', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'Down' });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 2, backoff: 'none' },
    });

    expect(result.success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result.retry_metadata.total_attempts).toBe(3);
    expect(result.retry_metadata.attempts).toHaveLength(3);
  });

  it('honors custom retryable_status_codes', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'Bad Gateway' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 2, backoff: 'none', retryable_status_codes: [502] },
    });

    expect(result.success).toBe(true);
    expect(result.retry_metadata.total_attempts).toBe(2);
  });

  it('does NOT retry status code not in custom retryable list', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Down' });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 2, backoff: 'none', retryable_status_codes: [502] },
    });

    expect(result.success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retry_metadata.attempts has correct shape', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    global.fetch
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const result = await invokeCapability({
      endpoint: 'http://example.com/api',
      method: 'POST',
      authHeaders: {},
      body: {},
      timeoutMs: 5000,
      retryPolicy: { max_retries: 2, backoff: 'none' },
    });

    expect(result.retry_metadata.attempts[0]).toMatchObject({
      attempt: 1,
      error: 'capability_timeout',
    });
    expect(result.retry_metadata.attempts[0].elapsed_ms).toBeTypeOf('number');
    expect(result.retry_metadata.attempts[1]).toMatchObject({
      attempt: 2,
      success: true,
    });
  });
});

describe('calculateBackoffDelay', () => {
  it('returns 0 for backoff "none"', () => {
    expect(calculateBackoffDelay(0, 'none', 1000, 30000)).toBe(0);
  });

  it('returns base_delay_ms for backoff "fixed"', () => {
    expect(calculateBackoffDelay(0, 'fixed', 1000, 30000)).toBe(1000);
    expect(calculateBackoffDelay(3, 'fixed', 2000, 30000)).toBe(2000);
  });

  it('doubles delay for exponential backoff', () => {
    const d0 = calculateBackoffDelay(0, 'exponential', 1000, 100000);
    const d1 = calculateBackoffDelay(1, 'exponential', 1000, 100000);
    // With 10% jitter, d1 should be roughly 2x d0
    expect(d1).toBeGreaterThanOrEqual(1800);
    expect(d1).toBeLessThanOrEqual(2200);
  });

  it('caps at max_delay_ms for exponential', () => {
    const delay = calculateBackoffDelay(10, 'exponential', 1000, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});

describe('isRetryableResult', () => {
  const codes = new Set([429, 500, 502, 503, 504]);

  it('returns true for capability_timeout', () => {
    expect(isRetryableResult({ success: false, error: 'capability_timeout' }, codes)).toBe(true);
  });

  it('returns true for capability_network_error', () => {
    expect(isRetryableResult({ success: false, error: 'capability_network_error' }, codes)).toBe(true);
  });

  it('returns true for retryable status code', () => {
    expect(isRetryableResult({ success: false, error: 'capability_error', status: 503 }, codes)).toBe(true);
  });

  it('returns false for non-retryable status code', () => {
    expect(isRetryableResult({ success: false, error: 'capability_error', status: 400 }, codes)).toBe(false);
  });

  it('returns false for success', () => {
    expect(isRetryableResult({ success: true }, codes)).toBe(false);
  });
});

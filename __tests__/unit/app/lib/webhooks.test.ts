import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { createSqlMock } from '../../../helpers.js';

const { mockDnsLookup, mockFetch, mockScanSensitiveData } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
  mockFetch: vi.fn(),
  mockScanSensitiveData: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup, resolve4: vi.fn() },
  lookup: mockDnsLookup,
}));
vi.mock('@/lib/security.js', () => ({
  scanSensitiveData: (...args: unknown[]) => mockScanSensitiveData(...args),
}));
vi.stubGlobal('fetch', mockFetch);
// webhooks.ts imports fetch from undici (so its pinned undici Agent dispatcher
// is honored); route that import to the same mock while keeping the real Agent
// so buildPinnedDispatcher still works.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: (...args: unknown[]) => mockFetch(...args) };
});

import { Agent as UndiciAgent } from 'undici';
import {
  buildPinnedDispatcher,
  deliverGuardWebhook,
  deliverWebhook,
  fireWebhooksForApproval,
  fireWebhooksForOrg,
  safeUrlWithIps,
  signPayload,
} from '@/lib/webhooks.js';

type Sql = Parameters<typeof deliverWebhook>[0]['sql'];

type LoggedSql = Sql & { taggedCalls: { text: string; values: unknown[] }[] };

type FetchCall = [string, { method: string; redirect: string; headers: Record<string, string>; body: string }];

function lastFetchCall(): FetchCall {
  return mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as FetchCall;
}

function firstTaggedCall(sql: LoggedSql): { text: string; values: unknown[] } {
  const call = sql.taggedCalls[0];
  if (!call) throw new Error('expected at least one tagged sql call');
  return call;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mockScanSensitiveData.mockImplementation((v: unknown) => ({ clean: true, redacted: v, findings: [] }));
});

afterEach(() => {
  delete process.env.GUARD_WEBHOOK_SECRET;
});

describe('signPayload', () => {
  it('produces the known HMAC-SHA256 hex digest for a fixed payload and secret', () => {
    expect(signPayload('{"a":1}', 'sec123')).toBe(
      '25571afe4276268139d369f9cafdff235dc3c41a5edc397dd95d7f0cea600eb7'
    );
  });
});

describe('buildPinnedDispatcher', () => {
  it('returns undefined for empty or non-array input', () => {
    expect(buildPinnedDispatcher([])).toBeUndefined();
    expect(buildPinnedDispatcher(undefined as unknown as string[])).toBeUndefined();
  });

  it('returns an undici Agent when validated IPs are provided', async () => {
    const dispatcher = buildPinnedDispatcher(['93.184.216.34']);
    expect(dispatcher).toBeInstanceOf(UndiciAgent);
    await dispatcher?.close();
  });
});

describe('safeUrlWithIps URL validation', () => {
  it('rejects non-https URLs', async () => {
    await expect(safeUrlWithIps('http://example.com/hook')).rejects.toThrow('Webhook URL must use https');
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(safeUrlWithIps('https://user:pass@example.com/hook')).rejects.toThrow(
      'Webhook URL must not include credentials'
    );
  });

  const PRIVATE_V4 = [
    '0.0.0.0',
    '0.255.1.2',
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
  ];
  it.each(PRIVATE_V4)('rejects private/loopback IPv4 literal %s without a DNS lookup', async (ip) => {
    await expect(safeUrlWithIps(`https://${ip}/hook`)).rejects.toThrow(
      'Webhook URL cannot target private or loopback IPs'
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  const PUBLIC_V4 = [
    '1.0.0.1',
    '8.8.8.8',
    '11.0.0.1',
    '93.184.216.34',
    '126.0.0.1',
    '128.0.0.1',
    '169.253.0.1',
    '169.255.0.1',
    '172.15.0.1',
    '172.32.0.1',
    '192.167.0.1',
    '192.169.0.1',
  ];
  it.each(PUBLIC_V4)('accepts public IPv4 literal %s without a DNS lookup', async (ip) => {
    await expect(safeUrlWithIps(`https://${ip}/hook`)).resolves.toEqual([ip]);
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  const PRIVATE_V6 = [
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    // Hex-mapped IPv4 form is treated conservatively as private.
    '::ffff:7f00:1',
  ];
  it.each(PRIVATE_V6)('rejects hostnames resolving to private/loopback IPv6 %s', async (ip) => {
    mockDnsLookup.mockResolvedValue([{ address: ip, family: 6 }]);
    await expect(safeUrlWithIps('https://example.com/hook')).rejects.toThrow(
      'Webhook hostname resolves to a private or loopback IP'
    );
  });

  const PUBLIC_V6 = ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'];
  it.each(PUBLIC_V6)('accepts hostnames resolving to public IPv6 %s', async (ip) => {
    mockDnsLookup.mockResolvedValue([{ address: ip, family: 6 }]);
    await expect(safeUrlWithIps('https://example.com/hook')).resolves.toEqual([ip]);
  });

  it('rejects hostnames that do not resolve', async () => {
    mockDnsLookup.mockResolvedValue([]);
    await expect(safeUrlWithIps('https://example.com/hook')).rejects.toThrow('Webhook hostname did not resolve');
  });

  it('rejects hostnames where any resolved address is private', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(safeUrlWithIps('https://example.com/hook')).rejects.toThrow(
      'Webhook hostname resolves to a private or loopback IP'
    );
  });

  it('returns every resolved public address in order', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ]);
    await expect(safeUrlWithIps('https://example.com/hook')).resolves.toEqual(['8.8.8.8', '1.1.1.1']);
  });
});

describe('deliverWebhook', () => {
  const baseArgs = {
    webhookId: 'wh_1',
    orgId: 'org_1',
    url: 'https://example.com/hook',
    secret: 'sec123',
    eventType: 'signals.detected',
  };

  it('signs the payload, sends DashClaw headers, and logs a success row', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const result = await deliverWebhook({ ...baseArgs, payload: { a: 1 }, sql });

    expect(result).toEqual({ success: true, status: 200, delivery_logged: true });

    const [fetchUrl, opts] = lastFetchCall();
    expect(fetchUrl).toBe('https://example.com/hook');
    expect(opts.method).toBe('POST');
    expect(opts.redirect).toBe('manual');
    expect(opts.body).toBe('{"a":1}');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-DashClaw-Event']).toBe('signals.detected');
    expect(opts.headers['X-DashClaw-Delivery']).toMatch(/^wd_/);
    expect(opts.headers['User-Agent']).toBe('DashClaw-Webhooks/1.0');
    // Signature is HMAC-SHA256(secret, payloadStr) — the known vector.
    expect(opts.headers['X-DashClaw-Signature']).toBe(
      '25571afe4276268139d369f9cafdff235dc3c41a5edc397dd95d7f0cea600eb7'
    );

    const insert = firstTaggedCall(sql);
    expect(insert.text).toContain('INSERT INTO webhook_deliveries');
    expect(insert.values[1]).toBe('wh_1');
    expect(insert.values[2]).toBe('org_1');
    expect(insert.values[3]).toBe('signals.detected');
    expect(insert.values[4]).toBe('{"a":1}');
    expect(insert.values[5]).toBe('success');
    expect(insert.values[6]).toBe(200);
    expect(insert.values[7]).toBe('ok');
  });

  it('passes a string payload through unchanged', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await deliverWebhook({ ...baseArgs, payload: 'raw-string', sql });

    const [, opts] = lastFetchCall();
    expect(opts.body).toBe('raw-string');
    expect(opts.headers['X-DashClaw-Signature']).toBe(
      crypto.createHmac('sha256', 'sec123').update('raw-string').digest('hex')
    );
  });

  it('treats redirects as failed without reading the body', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    const text = vi.fn(async () => 'should not be read');
    mockFetch.mockResolvedValue({ ok: false, status: 302, text });

    const result = await deliverWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: false, status: 302, delivery_logged: true });
    expect(text).not.toHaveBeenCalled();
    expect(firstTaggedCall(sql).values[5]).toBe('failed');
    expect(firstTaggedCall(sql).values[7]).toBe('Redirect blocked');
  });

  it('marks non-2xx responses as failed', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as Sql;
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });

    const result = await deliverWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: false, status: 500, delivery_logged: true });
  });

  it('truncates response bodies to 2000 characters before logging', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'x'.repeat(2500) });

    await deliverWebhook({ ...baseArgs, payload: {}, sql });

    expect((firstTaggedCall(sql).values[7] as string).length).toBe(2000);
  });

  it('records the error message when fetch rejects', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    mockFetch.mockRejectedValue(new Error('boom'));

    const result = await deliverWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: false, status: null, delivery_logged: true });
    expect(firstTaggedCall(sql).values[5]).toBe('failed');
    expect(firstTaggedCall(sql).values[7]).toBe('boom');
  });

  it('reports delivery_logged false when the audit INSERT fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sql = (() => Promise.reject(new Error('db down'))) as unknown as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const result = await deliverWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: true, status: 200, delivery_logged: false });
    expect(errorSpy).toHaveBeenCalledWith('[WEBHOOK] Failed to log delivery:', 'db down');
    errorSpy.mockRestore();
  });

  it('stores redacted payload and response body', async () => {
    mockScanSensitiveData.mockImplementation((v: string) => ({ clean: false, redacted: `[r]${v}`, findings: [] }));
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await deliverWebhook({ ...baseArgs, payload: { a: 1 }, sql });

    expect(firstTaggedCall(sql).values[4]).toBe('[r]{"a":1}');
    expect(firstTaggedCall(sql).values[7]).toBe('[r]ok');
  });
});

describe('deliverGuardWebhook', () => {
  const baseArgs = {
    url: 'https://example.com/guard',
    policyId: 'pol_1',
    orgId: 'org_1',
  };

  it('parses a JSON response, sends guard headers, and logs under the policy id', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{"decision":"allow"}' });

    const result = await deliverGuardWebhook({ ...baseArgs, payload: { a: 1 }, sql });

    expect(result).toEqual({
      success: true,
      response: { decision: 'allow' },
      status: 200,
      delivery_logged: true,
    });

    const [, opts] = lastFetchCall();
    expect(opts.method).toBe('POST');
    expect(opts.redirect).toBe('manual');
    expect(opts.headers['X-DashClaw-Event']).toBe('guard.evaluation');
    expect(opts.headers['User-Agent']).toBe('DashClaw-Guard/1.0');
    // No global secret configured — no timestamp/signature headers.
    expect(opts.headers['X-DashClaw-Timestamp']).toBeUndefined();
    expect(opts.headers['X-DashClaw-Signature']).toBeUndefined();

    const insert = firstTaggedCall(sql);
    expect(insert.text).toContain('INSERT INTO webhook_deliveries');
    expect(insert.values[1]).toBe('pol_1');
    expect(insert.values[3]).toBe('guard.evaluation');
    expect(insert.values[5]).toBe('success');
  });

  it('signs with the global guard secret as v1=HMAC(timestamp.payload)', async () => {
    process.env.GUARD_WEBHOOK_SECRET = 'gsec';
    const sql = createSqlMock({ taggedResponses: [[]] }) as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await deliverGuardWebhook({ ...baseArgs, payload: { a: 1 }, sql });

    const [, opts] = lastFetchCall();
    const ts = opts.headers['X-DashClaw-Timestamp'];
    expect(ts).toMatch(/^\d+$/);
    const expected = crypto.createHmac('sha256', 'gsec').update(`${ts}.{"a":1}`).digest('hex');
    expect(opts.headers['X-DashClaw-Signature']).toBe(`v1=${expected}`);
  });

  it('treats a non-JSON success body as a no-op response', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'plain text' });

    const result = await deliverGuardWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: true, response: null, status: 200, delivery_logged: true });
  });

  it('does not parse the body of failed responses', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as Sql;
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => '{"decision":"allow"}' });

    const result = await deliverGuardWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: false, response: null, status: 500, delivery_logged: true });
  });

  it('treats redirects as failed without parsing', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    mockFetch.mockResolvedValue({ ok: false, status: 301, text: async () => '' });

    const result = await deliverGuardWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: false, response: null, status: 301, delivery_logged: true });
    expect(firstTaggedCall(sql).values[7]).toBe('Redirect blocked');
  });

  it('logs "Request timed out" for AbortError rejections', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] }) as LoggedSql;
    mockFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const result = await deliverGuardWebhook({ ...baseArgs, payload: {}, sql });

    expect(result).toEqual({ success: false, response: null, status: null, delivery_logged: true });
    expect(firstTaggedCall(sql).values[7]).toBe('Request timed out');
  });
});

describe('fireWebhooksForOrg payload shaping', () => {
  it('filters signals to the subscribed event types and reports signalCount', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 's', events: '["stale_loop"]', failure_count: 0 }],
        [],
        [],
      ],
    }) as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const results = await fireWebhooksForOrg('org_1', [{ type: 'stale_loop' }, { type: 'other' }], sql);

    expect(results).toEqual([{ webhookId: 'wh_1', success: true, signalCount: 1 }]);
    const body = JSON.parse(lastFetchCall()[1].body);
    expect(body.event).toBe('signals.detected');
    expect(body.org_id).toBe('org_1');
    expect(body.signals).toEqual([{ type: 'stale_loop' }]);
  });

  it('falls back to "all" when the events column is malformed JSON', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 's', events: 'not-json', failure_count: 0 }],
        [],
        [],
      ],
    }) as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const results = await fireWebhooksForOrg('org_1', [{ type: 'a' }, { type: 'b' }], sql);

    expect(results).toEqual([{ webhookId: 'wh_1', success: true, signalCount: 2 }]);
  });
});

describe('fireWebhooksForApproval events parsing', () => {
  it('falls back to "all" when the events column is malformed JSON', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 's', events: 'oops' }],
        [],
      ],
    }) as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await fireWebhooksForApproval('org_1', 'approval_pending', { action_id: 'act_1' }, sql);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('treats a null events column as subscribed to all', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 's', events: null }],
        [],
      ],
    }) as Sql;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await fireWebhooksForApproval('org_1', 'approval_pending', { action_id: 'act_2' }, sql);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

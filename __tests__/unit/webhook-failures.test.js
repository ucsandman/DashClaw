import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';

const { mockDnsLookup, mockFetch } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup, resolve4: vi.fn() },
  lookup: mockDnsLookup,
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: (v) => ({ clean: true, redacted: v, findings: [] }) }));
vi.stubGlobal('fetch', mockFetch);
// webhooks.js now imports fetch from undici (so its pinned undici Agent
// dispatcher is honored); route that import to the same mock while keeping the
// real Agent so buildPinnedDispatcher still works.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetch: (...args) => mockFetch(...args) };
});

import { fireWebhooksForOrg } from '@/lib/webhooks.js';

describe('fireWebhooksForOrg failure count handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // DNS lookup returns public IP (passes SSRF check)
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  // Tagged template call order:
  //   [0] SELECT webhooks
  //   [1] INSERT INTO webhook_deliveries (from deliverWebhook)
  //   [2] UPDATE webhooks failure_count/active

  it('resets failure_count to 0 on successful delivery', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'abc', events: '["all"]', failure_count: 3 }],
        [], // delivery INSERT
        [], // failure_count UPDATE
      ],
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const results = await fireWebhooksForOrg('org_1', [{ type: 'test', severity: 'amber' }], sql);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(sql.taggedCalls.length).toBeGreaterThanOrEqual(3);
    const updateCall = sql.taggedCalls[2];
    // failure_count = 0 is a literal in the template (reset to zero)
    expect(updateCall.text).toContain('failure_count = 0');
  });

  it('increments failure_count on delivery failure', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'abc', events: '["all"]', failure_count: 2 }],
        [],
        [],
      ],
    });
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });

    const results = await fireWebhooksForOrg('org_1', [{ type: 'test', severity: 'red' }], sql);

    expect(results[0].success).toBe(false);
    const updateCall = sql.taggedCalls[2];
    expect(updateCall.text).toContain('failure_count = ?');
    expect(updateCall.values[0]).toBe(3);
  });

  it('disables webhook after 10 consecutive failures', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'abc', events: '["all"]', failure_count: 9 }],
        [],
        [],
      ],
    });
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });

    await fireWebhooksForOrg('org_1', [{ type: 'test', severity: 'red' }], sql);

    const updateCall = sql.taggedCalls[2];
    expect(updateCall.text).toContain('failure_count = ?');
    // active = 0 is a literal in the template, not a placeholder
    expect(updateCall.text).toContain('active = 0');
    expect(updateCall.values[0]).toBe(10);
  });

  it('returns empty array when no signals provided', async () => {
    const sql = createSqlMock();
    const results = await fireWebhooksForOrg('org_1', [], sql);
    expect(results).toEqual([]);
  });

  it('skips webhooks not subscribed to signal type', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'abc', events: '["autonomy_spike"]', failure_count: 0 }],
      ],
    });

    const results = await fireWebhooksForOrg('org_1', [{ type: 'stale_loop', severity: 'amber' }], sql);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

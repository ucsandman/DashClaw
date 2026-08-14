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
  //   [2] DELETE FROM webhook_deliveries (retention ride-along)
  //   [3] UPDATE webhooks failure_count/active
  // Tests locate the UPDATE by content, not position, so retention/log
  // statements can move without breaking them.
  const findUpdateCall = (sql) =>
    sql.taggedCalls.find((c) => c.text.includes('UPDATE webhooks'));

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
    const updateCall = findUpdateCall(sql);
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
    const updateCall = findUpdateCall(sql);
    // Atomic: the increment is computed from the row Postgres holds, not from
    // the caller's earlier SELECT. Three overlapping failures used to all read
    // 0 and all write 1, so the disable-at-10 breaker never tripped.
    expect(updateCall.text).toContain('failure_count = COALESCE(failure_count, 0) + 1');
    // No count is bound as a parameter any more — that WAS the bug. The
    // disable threshold is decided in the same statement and read back.
    expect(updateCall.values).not.toContain(3);
    expect(updateCall.text).toContain('RETURNING failure_count, active');
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

    const updateCall = findUpdateCall(sql);
    // Atomic: the increment is computed from the row Postgres holds, not from
    // the caller's earlier SELECT. Three overlapping failures used to all read
    // 0 and all write 1, so the disable-at-10 breaker never tripped.
    expect(updateCall.text).toContain('failure_count = COALESCE(failure_count, 0) + 1');
    // The disable decision moved INTO the statement: it is now a CASE over the
    // freshly-incremented count, so it can no longer be defeated by a stale
    // read. Both the threshold and the deactivation are literals in the
    // template, never placeholders.
    expect(updateCall.text.replace(/\s+/g, ' ')).toMatch(
      /active = CASE WHEN COALESCE\(failure_count, 0\) \+ 1 >= 10 THEN 0 ELSE active END/,
    );
    expect(updateCall.values).not.toContain(10);
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

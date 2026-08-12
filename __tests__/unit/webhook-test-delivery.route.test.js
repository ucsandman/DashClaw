import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock, makeRequest } from '../helpers.js';

const { mockDnsLookup, mockFetch, mockLogActivity, mockGetSql } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
  mockFetch: vi.fn(),
  mockLogActivity: vi.fn(),
  mockGetSql: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup, resolve4: vi.fn() },
  lookup: mockDnsLookup,
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: (v) => ({ clean: true, redacted: v, findings: [] }) }));
vi.mock('@/lib/db.js', () => ({ getSql: mockGetSql }));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.stubGlobal('fetch', mockFetch);
// webhooks.ts imports fetch from undici (pinned dispatcher); route that import
// to the same mock while keeping the real Agent so buildPinnedDispatcher works.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetch: (...args) => mockFetch(...args) };
});

import { POST } from '@/api/webhooks/[webhookId]/test/route.js';

function makeTestRequest() {
  return makeRequest('http://localhost/api/webhooks/wh_1/test', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
  });
}

describe('POST /api/webhooks/[webhookId]/test failure state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockLogActivity.mockResolvedValue(undefined);
  });

  // Tagged template call order:
  //   [0] SELECT webhook (findWebhookForDelivery)
  //   [1] INSERT INTO webhook_deliveries (from deliverWebhook)
  //   [2] UPDATE webhooks failure_count / last_triggered_at

  it('stamps last_triggered_at and resets failure_count on a successful test delivery', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', failure_count: 2 }],
        [], // delivery INSERT
        [], // failure state UPDATE
      ],
    });
    mockGetSql.mockReturnValue(sql);
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const res = await POST(makeTestRequest(), { params: Promise.resolve({ webhookId: 'wh_1' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const updateCall = sql.taggedCalls.find((c) => c.text.includes('UPDATE webhooks'));
    expect(updateCall).toBeDefined();
    expect(updateCall.text).toContain('failure_count = 0');
    expect(updateCall.text).toContain('last_triggered_at');
  });

  it('increments failure_count on a failed test delivery', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', failure_count: 4 }],
        [], // delivery INSERT
        [], // failure state UPDATE
      ],
    });
    mockGetSql.mockReturnValue(sql);
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });

    const res = await POST(makeTestRequest(), { params: Promise.resolve({ webhookId: 'wh_1' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(false);

    const updateCall = sql.taggedCalls.find((c) => c.text.includes('UPDATE webhooks'));
    expect(updateCall).toBeDefined();
    // The count is computed in the statement, so none is bound as a parameter.
    expect(updateCall.text).toContain('failure_count = COALESCE(failure_count, 0) + 1');
    expect(updateCall.values).not.toContain(5);
  });
});

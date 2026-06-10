/**
 * GET /api/webhooks/[webhookId]/deliveries must expose the stored payload +
 * response_body (both redacted at write time by redactForStorage) so users
 * can debug deliveries without external tooling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetOrgId } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));

import { GET } from '@/api/webhooks/[webhookId]/deliveries/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
});

describe('GET /api/webhooks/[webhookId]/deliveries', () => {
  it('returns payload and response_body columns for each delivery', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'wh_1' }]) // ownership check
      .mockResolvedValueOnce([
        {
          id: 'wd_1',
          event_type: 'autonomy_spike',
          status: 'success',
          response_status: 200,
          attempted_at: '2026-06-10T12:00:00Z',
          duration_ms: 120,
          payload: '{"event":"signal.detected","api_key":"[REDACTED]"}',
          response_body: 'ok',
        },
      ]);

    const res = await GET(
      makeRequest('http://test/api/webhooks/wh_1/deliveries'),
      { params: Promise.resolve({ webhookId: 'wh_1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.deliveries[0].payload).toContain('[REDACTED]');
    expect(data.deliveries[0].response_body).toBe('ok');

    // The deliveries SELECT carries both columns (and write-time redaction is
    // pinned separately in the webhooks lib tests).
    const deliveriesCall = mockSql.mock.calls[1][0].join('?');
    expect(deliveriesCall).toMatch(/payload, response_body/);
  });

  it('still 404s for a foreign-org webhook', async () => {
    mockSql.mockResolvedValueOnce([]); // ownership check finds nothing
    const res = await GET(
      makeRequest('http://test/api/webhooks/wh_other/deliveries'),
      { params: Promise.resolve({ webhookId: 'wh_other' }) },
    );
    expect(res.status).toBe(404);
  });
});

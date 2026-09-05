import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockIsValidWebhookUrl, mockLogActivity } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockIsValidWebhookUrl: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate.js', () => ({ isValidWebhookUrl: mockIsValidWebhookUrl }));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET, POST, DELETE } from '@/api/webhooks/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  vi.stubEnv('ENCRYPTION_KEY', 'unit-test-custody-key-32-bytes!!');
  mockSql.mockImplementation(async () => []);
  mockSql.query.mockImplementation(async () => []);
  mockIsValidWebhookUrl.mockReturnValue(null); // null = valid
  mockLogActivity.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('/api/webhooks GET', () => {
  it('returns masked webhooks for the org', async () => {
    const rawWebhooks = [
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'webhook_test_secret_5678zz',
        events: ['all'],
        active: 1,
        failure_count: 0,
        last_triggered_at: null,
        created_at: '2026-01-01T00:00:00Z',
        created_by: 'user_1',
      },
    ];
    mockSql.mockResolvedValueOnce(rawWebhooks);

    const res = await GET(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhooks).toHaveLength(1);
    // Secret should be masked — only last 4 chars visible
    expect(data.webhooks[0].secret).not.toBe(rawWebhooks[0].secret);
    expect(data.webhooks[0].secret).toContain('5678');
    expect(data.webhooks[0].secret).toContain('•');
  });

  it('handles webhooks with null secret gracefully', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'wh_2', url: 'https://example.com', secret: null, events: ['all'], active: 1,
      failure_count: 0, last_triggered_at: null, created_at: '2026-01-01T00:00:00Z', created_by: 'u1',
    }]);

    const res = await GET(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhooks[0].secret).toBeNull();
  });

  it('returns 500 on db error', async () => {
    mockSql.mockRejectedValueOnce(new Error('db fail'));

    const res = await GET(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(500);
  });
});

describe('/api/webhooks POST', () => {
  it('creates a webhook for admin with valid URL', async () => {
    mockSql.mockResolvedValue([]);

    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: { url: 'https://hooks.example.com/dc', events: ['all'] },
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.webhook.id).toMatch(/^wh_/);
    expect(data.webhook.url).toBe('https://hooks.example.com/dc');
    expect(data.storageWarning).toBeDefined();
    // Raw secret is returned on creation only
    expect(data.webhook.secret).toBeDefined();
    expect(data.webhook.secret.length).toBeGreaterThan(20);
  });

  it('returns 403 for non-admin', async () => {
    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
      body: { url: 'https://example.com', events: ['all'] },
    }));

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid URL', async () => {
    mockIsValidWebhookUrl.mockReturnValue('URL must use HTTPS');

    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { url: 'http://insecure.com', events: ['all'] },
    }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('HTTPS');
  });

  it('returns 400 for empty events array', async () => {
    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { url: 'https://example.com', events: [] },
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid event type', async () => {
    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { url: 'https://example.com', events: ['invalid_event'] },
    }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid event type');
  });

  it('defaults to ["all"] events when none provided', async () => {
    mockSql.mockResolvedValue([]);

    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: { url: 'https://hooks.example.com' },
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.webhook.events).toEqual(['all']);
  });

  it('accepts all valid signal event types', async () => {
    mockSql.mockResolvedValue([]);

    const validEvents = ['autonomy_spike', 'high_impact_low_oversight', 'repeated_failures'];
    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: { url: 'https://hooks.example.com', events: validEvents },
    }));

    expect(res.status).toBe(201);
  });

  it('returns 500 on db error', async () => {
    mockSql.mockRejectedValue(new Error('insert failed'));

    const res = await POST(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { url: 'https://example.com', events: ['all'] },
    }));

    expect(res.status).toBe(500);
  });
});

describe('/api/webhooks DELETE', () => {
  it('deletes an existing webhook', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'wh_abc' }]) // SELECT check
      .mockResolvedValueOnce([]); // DELETE

    const res = await DELETE(makeRequest('http://localhost/api/webhooks?id=wh_abc', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.deleted).toBe('wh_abc');
  });

  it('returns 403 for non-admin', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/webhooks?id=wh_abc', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
    }));

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing id', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/webhooks', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 for id without wh_ prefix', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/webhooks?id=invalid_id', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(400);
  });

  it('returns 404 when webhook not found', async () => {
    mockSql.mockResolvedValueOnce([]);

    const res = await DELETE(makeRequest('http://localhost/api/webhooks?id=wh_missing', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(404);
  });

  it('returns 500 on db error', async () => {
    mockSql.mockRejectedValue(new Error('db error'));

    const res = await DELETE(makeRequest('http://localhost/api/webhooks?id=wh_abc', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(500);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/compliance/exporter.js', () => ({
  getComplianceTrends: vi.fn(async () => [
    { framework: 'soc2', coverage_percentage: 83, risk_level: 'LOW', created_at: new Date().toISOString() },
  ]),
}));

import { GET } from '@/api/compliance/trends/route.js';

describe('/api/compliance/trends GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns trends data', async () => {
    const res = await GET(makeRequest('http://localhost/api/compliance/trends', { headers: { 'x-org-id': 'org_test' } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trends).toBeDefined();
    expect(data.trends.length).toBeGreaterThan(0);
  });
});

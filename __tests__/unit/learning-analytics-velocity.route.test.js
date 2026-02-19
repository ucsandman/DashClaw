import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockComputeVelocity, mockGetVelocityData } = vi.hoisted(() => ({
  mockComputeVelocity: vi.fn(),
  mockGetVelocityData: vi.fn(),
}));

vi.mock('@/lib/learningAnalytics.js', () => ({
  computeVelocity: mockComputeVelocity,
  getVelocityData: mockGetVelocityData,
}));

import { GET, POST } from '@/api/learning/analytics/velocity/route.js';

describe('/api/learning/analytics/velocity', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns velocity data', async () => {
      mockGetVelocityData.mockResolvedValue([
        { agent_id: 'bot1', velocity: 1.5, maturity_level: 'competent' },
      ]);
      const res = await GET(makeRequest('http://localhost/api/learning/analytics/velocity', { headers: { 'x-org-id': 'org_test' } }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.velocity).toHaveLength(1);
      expect(data.velocity[0].velocity).toBe(1.5);
    });
  });

  describe('POST', () => {
    it('computes velocity and returns 201', async () => {
      mockComputeVelocity.mockResolvedValue({ agents_computed: 3, results: [] });
      const res = await POST(makeRequest('http://localhost/api/learning/analytics/velocity', {
        headers: { 'x-org-id': 'org_test' },
        body: { lookback_days: 30 },
      }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.agents_computed).toBe(3);
    });
  });
});

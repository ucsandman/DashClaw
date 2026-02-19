import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockGetAnalyticsSummary } = vi.hoisted(() => ({
  mockGetAnalyticsSummary: vi.fn(),
}));

vi.mock('@/lib/learningAnalytics.js', () => ({
  getAnalyticsSummary: mockGetAnalyticsSummary,
}));

import { GET } from '@/api/learning/analytics/summary/route.js';

describe('/api/learning/analytics/summary GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns comprehensive analytics summary', async () => {
    mockGetAnalyticsSummary.mockResolvedValue({
      overall: { total_episodes: 500, avg_score: 65, success_rate: 0.78 },
      by_agent: [{ agent_id: 'bot1', episode_count: 250 }],
      by_action_type: [{ action_type: 'deploy', episode_count: 100 }],
      recommendations: { total_recommendations: 10 },
      velocity: [],
    });
    const res = await GET(makeRequest('http://localhost/api/learning/analytics/summary', { headers: { 'x-org-id': 'org_test' } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.overall.total_episodes).toBe(500);
    expect(data.by_agent).toHaveLength(1);
    expect(data.by_action_type).toHaveLength(1);
    expect(data.recommendations.total_recommendations).toBe(10);
  });

  it('passes agent_id filter', async () => {
    mockGetAnalyticsSummary.mockResolvedValue({ overall: {}, by_agent: [], by_action_type: [], recommendations: {}, velocity: [] });
    await GET(makeRequest('http://localhost/api/learning/analytics/summary?agent_id=bot1', { headers: { 'x-org-id': 'org_test' } }));
    expect(mockGetAnalyticsSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agent_id: 'bot1' })
    );
  });
});

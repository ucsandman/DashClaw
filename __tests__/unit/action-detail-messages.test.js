import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock, makeRequest } from '../helpers.js';

let mockSql;

const { mockGetOrgId } = vi.hoisted(() => ({
  mockGetOrgId: vi.fn(() => 'org_test'),
}));

vi.mock('@/lib/db.js', () => ({
  getSql: () => mockSql,
}));
vi.mock('@/lib/org.js', () => ({
  getOrgId: mockGetOrgId,
}));

import { GET } from '@/api/actions/[actionId]/route.js';

function req() {
  return makeRequest('http://localhost/api/actions/act_1', {
    headers: { 'x-org-id': 'org_test' },
  });
}

describe('GET /api/actions/[actionId] — message_summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes message_summary in the response', async () => {
    const actionRow = {
      action_id: 'act_1', agent_id: 'agent-1', agent_name: 'Agent One',
      action_type: 'deploy', declared_goal: 'Deploy config', status: 'completed',
      risk_score: 45, confidence: 82, timestamp_start: '2026-01-01T00:00:00Z',
    };
    const assumptions = [];
    const messageSummary = { total: 2, participants: 'agent-1,agent-2', first_message_at: '2026-01-01T00:00:00Z', last_message_at: '2026-01-01T00:01:00Z' };

    // getActionWithRelations does 3 parallel queries: action, assumptions, message summary
    mockSql = createSqlMock({
      taggedResponses: [[actionRow], assumptions, [messageSummary]],
    });

    const ctx = { params: Promise.resolve({ actionId: 'act_1' }) };
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message_summary).toBeDefined();
    expect(data.message_summary.total).toBe(2);
    expect(data.message_summary.participants).toEqual(['agent-1', 'agent-2']);
  });

  it('returns message_summary with zero total when no messages', async () => {
    const actionRow = {
      action_id: 'act_1', agent_id: 'agent-1', status: 'completed',
      action_type: 'deploy', declared_goal: 'Deploy',
    };
    const emptyMessageSummary = { total: 0, participants: '', first_message_at: null, last_message_at: null };

    mockSql = createSqlMock({
      taggedResponses: [[actionRow], [], [emptyMessageSummary]],
    });

    const ctx = { params: Promise.resolve({ actionId: 'act_1' }) };
    const res = await GET(req(), ctx);
    const data = await res.json();
    expect(data.message_summary.total).toBe(0);
    expect(data.message_summary.participants).toEqual([]);
  });
});

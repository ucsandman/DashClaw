/**
 * v4.2 coverage truth — GET /api/agents merges per-agent coverage.
 *
 * Contract: each agent carries `coverage: { record_pct, outcome_pct, expected,
 * recorded, window_hours: 24 } | null` (null = no evidence at all), fetched in
 * ONE extra aggregate query (getAgentCoverage), never per-agent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockListAgentsForOrg, mockAttachAgentConnections, mockGetAgentCoverage } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockListAgentsForOrg: vi.fn(),
  mockAttachAgentConnections: vi.fn(),
  mockGetAgentCoverage: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/agents.repository.js', () => ({
  listAgentsForOrg: mockListAgentsForOrg,
  attachAgentConnections: mockAttachAgentConnections,
  upsertAgentPresence: vi.fn(async () => undefined),
  ensureAgentPresenceTable: vi.fn(async () => undefined),
}));
vi.mock('@/lib/repositories/coverage.repository.js', () => ({
  getAgentCoverage: mockGetAgentCoverage,
}));

import { GET } from '@/api/agents/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockListAgentsForOrg.mockResolvedValue([]);
  mockAttachAgentConnections.mockResolvedValue(undefined);
  mockGetAgentCoverage.mockResolvedValue([]);
});

describe('/api/agents coverage merge', () => {
  it('attaches the coverage contract for agents with evidence and null otherwise', async () => {
    mockListAgentsForOrg.mockResolvedValue([
      { agent_id: 'a1', agent_name: 'Builder' },
      { agent_id: 'a2', agent_name: 'Idle' },
    ]);
    mockGetAgentCoverage.mockResolvedValue([
      { agentId: 'a1', expected: 100, recorded: 80, recordPct: 80, outcomePct: 90, outcomeSample: 40 },
    ]);

    const res = await GET(makeRequest('http://localhost/api/agents', { headers: { 'x-org-id': 'org_1' } }));
    const body = await res.json();

    const a1 = body.agents.find((a) => a.agent_id === 'a1');
    const a2 = body.agents.find((a) => a.agent_id === 'a2');
    expect(a1.coverage).toEqual({ record_pct: 80, outcome_pct: 90, expected: 100, recorded: 80, window_hours: 24 });
    expect(a2.coverage).toBeNull();
  });

  it('fetches coverage in exactly one aggregate call (no per-agent queries)', async () => {
    mockListAgentsForOrg.mockResolvedValue([
      { agent_id: 'a1' }, { agent_id: 'a2' }, { agent_id: 'a3' },
    ]);
    await GET(makeRequest('http://localhost/api/agents', { headers: { 'x-org-id': 'org_1' } }));
    expect(mockGetAgentCoverage).toHaveBeenCalledTimes(1);
    expect(mockGetAgentCoverage).toHaveBeenCalledWith(mockSql, 'org_1', 24);
  });

  it('carries a null percent through when only one coverage dimension has evidence', async () => {
    mockListAgentsForOrg.mockResolvedValue([{ agent_id: 'a1' }]);
    mockGetAgentCoverage.mockResolvedValue([
      { agentId: 'a1', expected: 0, recorded: 0, recordPct: null, outcomePct: 100, outcomeSample: 5 },
    ]);
    const res = await GET(makeRequest('http://localhost/api/agents', { headers: { 'x-org-id': 'org_1' } }));
    const body = await res.json();
    expect(body.agents[0].coverage.record_pct).toBeNull();
    expect(body.agents[0].coverage.outcome_pct).toBe(100);
  });
});

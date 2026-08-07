import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  listAgentsForOrg,
  deleteSyntheticAgentTraces,
  deleteAgentTracesByIds,
} from '../../app/lib/repositories/agents.repository.js';

// Mock the SQL client
const mockSql = {
  query: vi.fn(),
};

// fakeSql: captures the exact SQL text + params passed to sql.query, so the
// trace-deletion tests can assert on statement shape (mirrors the pattern in
// __tests__/unit/actions-delete-filter.test.js).
function fakeSql(responses = []) {
  const calls = [];
  let i = 0;
  const fn = { query: vi.fn((text, params) => {
    calls.push({ text, params });
    const r = responses[i++];
    return Promise.resolve(r || []);
  }) };
  return { sql: fn, calls };
}

describe('agents.repository.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_ONLINE_WINDOW_MS = ''; // Reset env var
  });

  describe('listAgentsForOrg', () => {
    it('calculates presence_state correctly based on heartbeat', async () => {
      const orgId = 'org_1';
      const now = new Date();
      const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
      const twoHoursAgo = new Date(now.getTime() - 120 * 60 * 1000).toISOString();

      mockSql.query
        .mockResolvedValueOnce([]) // action_records
        .mockResolvedValueOnce([]) // goals
        .mockResolvedValueOnce([]) // decisions
        .mockResolvedValueOnce([   // agent_presence
          { agent_id: 'agent_online', last_heartbeat_at: fiveMinsAgo, status: 'online' },
          { agent_id: 'agent_stale', last_heartbeat_at: twentyMinsAgo, status: 'online' },
          { agent_id: 'agent_offline', last_heartbeat_at: twoHoursAgo, status: 'online' },
          { agent_id: 'agent_explicit_offline', last_heartbeat_at: fiveMinsAgo, status: 'offline' },
        ]);

      const agents = await listAgentsForOrg(mockSql, orgId);

      const online = agents.find(a => a.agent_id === 'agent_online');
      const stale = agents.find(a => a.agent_id === 'agent_stale');
      const offline = agents.find(a => a.agent_id === 'agent_offline');
      const explicitOffline = agents.find(a => a.agent_id === 'agent_explicit_offline');

      expect(online.presence_state).toBe('online');
      expect(stale.presence_state).toBe('stale');
      expect(offline.presence_state).toBe('offline');
      expect(explicitOffline.presence_state).toBe('offline');
    });

    it('respects configured online window', async () => {
      const orgId = 'org_1';
      process.env.AGENT_ONLINE_WINDOW_MS = '60000'; // 1 minute

      const now = new Date();
      const twoMinsAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

      mockSql.query
        .mockResolvedValueOnce([]) // action_records
        .mockResolvedValueOnce([]) // goals
        .mockResolvedValueOnce([]) // decisions
        .mockResolvedValueOnce([   // agent_presence
          { agent_id: 'agent_fast_stale', last_heartbeat_at: twoMinsAgo, status: 'online' },
        ]);

      const agents = await listAgentsForOrg(mockSql, orgId);
      const agent = agents.find(a => a.agent_id === 'agent_fast_stale');

      expect(agent.presence_state).toBe('stale'); // > 1 min but < 3 mins
    });

    it('derives last_seen_at from last_active if heartbeat missing', async () => {
      const orgId = 'org_1';
      const now = new Date();
      // Ensure we use a slightly older time so diff is positive, but within 10m
      const recent = new Date(now.getTime() - 1000).toISOString();

      mockSql.query
        .mockResolvedValueOnce([{ agent_id: 'agent_action_only', last_active: recent }]) // action_records returns aliased last_active
        .mockResolvedValueOnce([]) // goals
        .mockResolvedValueOnce([]) // decisions
        .mockResolvedValueOnce([]); // agent_presence returns nothing

      const agents = await listAgentsForOrg(mockSql, orgId);
      const agent = agents.find(a => a.agent_id === 'agent_action_only');

      expect(agent.presence_state).toBe('online');
      expect(agent.last_seen_at).toBe(recent);
    });

    it('correctly handles heartbeat-only agents', async () => {
      const orgId = 'org_1';
      const now = new Date();
      const recent = new Date(now.getTime() - 1000).toISOString();

      mockSql.query
        .mockResolvedValueOnce([]) // action_records
        .mockResolvedValueOnce([]) // goals
        .mockResolvedValueOnce([]) // decisions
        .mockResolvedValueOnce([   // agent_presence
          { agent_id: 'heartbeat_only', last_heartbeat_at: recent, status: 'online' }
        ]);

      const agents = await listAgentsForOrg(mockSql, orgId);
      const agent = agents.find(a => a.agent_id === 'heartbeat_only');

      expect(agent).toBeDefined();
      expect(agent.presence_state).toBe('online');
    });
  });

  describe('deleteSyntheticAgentTraces', () => {
    it('deletes from agent_presence, goals, decisions by LIKE ANY pattern, in order, and sums RETURNING counts', async () => {
      const { sql, calls } = fakeSql([
        [{ agent_id: 'smoke-1' }, { agent_id: 'smoke-2' }], // agent_presence
        [{ id: 1 }],                                        // goals
        [],                                                  // decisions
      ]);

      const result = await deleteSyntheticAgentTraces(sql, 'org_1');

      expect(calls).toHaveLength(3);
      expect(calls[0].text).toMatch(/DELETE FROM agent_presence WHERE org_id = \$1 AND agent_id LIKE ANY\(\$2\)/);
      expect(calls[0].params[0]).toBe('org_1');
      expect(calls[1].text).toMatch(/DELETE FROM goals WHERE org_id = \$1 AND agent_id LIKE ANY\(\$2\)/);
      expect(calls[2].text).toMatch(/DELETE FROM decisions WHERE org_id = \$1 AND agent_id LIKE ANY\(\$2\)/);
      expect(result).toEqual({ presence: 2, goals: 1, decisions: 0 });
    });

    it('adds a before cutoff on each table\'s own timestamp column', async () => {
      const { sql, calls } = fakeSql([[], [], []]);

      await deleteSyntheticAgentTraces(sql, 'org_1', { before: '2026-08-01T00:00:00.000Z' });

      expect(calls[0].text).toMatch(/last_heartbeat_at::timestamptz < \$3::timestamptz/);
      expect(calls[0].params).toEqual(['org_1', expect.any(Array), '2026-08-01T00:00:00.000Z']);
      expect(calls[1].text).toMatch(/created_at::timestamptz < \$3::timestamptz/);
      expect(calls[2].text).toMatch(/timestamp::timestamptz < \$3::timestamptz/);
    });

    it('omits before clause when not given', async () => {
      const { sql, calls } = fakeSql([[], [], []]);

      await deleteSyntheticAgentTraces(sql, 'org_1');

      for (const c of calls) {
        expect(c.text).not.toMatch(/timestamptz/);
        expect(c.params).toHaveLength(2);
      }
    });

    it('tolerates a missing table (fresh schema) without throwing, and skips its count', async () => {
      const sql = { query: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('relation "agent_presence" does not exist'), { code: '42P01' }))
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([]) };

      const result = await deleteSyntheticAgentTraces(sql, 'org_1');

      expect(result).toEqual({ presence: 0, goals: 1, decisions: 0 });
    });

    it('rethrows a non-missing-table error', async () => {
      const sql = { query: vi.fn().mockRejectedValueOnce(new Error('connection reset')) };

      await expect(deleteSyntheticAgentTraces(sql, 'org_1')).rejects.toThrow('connection reset');
    });
  });

  describe('deleteAgentTracesByIds', () => {
    it('deletes from agent_presence, goals, decisions by agent_id = ANY, no time filter', async () => {
      const { sql, calls } = fakeSql([
        [{ agent_id: 'smoke-a' }],
        [{ id: 1 }, { id: 2 }],
        [{ id: 3 }],
      ]);

      const result = await deleteAgentTracesByIds(sql, 'org_1', ['smoke-a', 'smoke-b']);

      expect(calls).toHaveLength(3);
      expect(calls[0].text).toMatch(/DELETE FROM agent_presence WHERE org_id = \$1 AND agent_id = ANY\(\$2\)/);
      expect(calls[0].params).toEqual(['org_1', ['smoke-a', 'smoke-b']]);
      expect(calls[1].text).toMatch(/DELETE FROM goals WHERE org_id = \$1 AND agent_id = ANY\(\$2\)/);
      expect(calls[2].text).toMatch(/DELETE FROM decisions WHERE org_id = \$1 AND agent_id = ANY\(\$2\)/);
      expect(result).toEqual({ presence: 1, goals: 2, decisions: 1 });
    });

    it('tolerates a missing table without throwing', async () => {
      const sql = { query: vi.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(Object.assign(new Error('relation "goals" does not exist'), { code: '42P01' }))
        .mockResolvedValueOnce([]) };

      const result = await deleteAgentTracesByIds(sql, 'org_1', ['a']);

      expect(result).toEqual({ presence: 0, goals: 0, decisions: 0 });
    });
  });
});

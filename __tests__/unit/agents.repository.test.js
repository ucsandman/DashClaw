import { describe, expect, it, vi, beforeEach } from 'vitest';
import { listAgentsForOrg } from '../../app/lib/repositories/agents.repository.js';

// Mock the SQL client
const mockSql = {
  query: vi.fn(),
};

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
});

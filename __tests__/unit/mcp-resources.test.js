// __tests__/unit/mcp-resources.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();

vi.mock('../../mcp-server/lib/client.js', () => ({
  DashClawClient: vi.fn().mockImplementation(function () {
    this.get = mockGet;
    this.agentId = 'default-agent';
  }),
}));

const { createResourceHandlers, RESOURCE_DEFINITIONS } = await import('../../mcp-server/lib/resources.js');
import { DashClawClient } from '../../mcp-server/lib/client.js';

describe('Resource Definitions', () => {
  it('exports exactly 4 resource definitions', () => {
    expect(RESOURCE_DEFINITIONS).toHaveLength(4);
  });

  it('every definition has uri, name, and description', () => {
    for (const def of RESOURCE_DEFINITIONS) {
      expect(def.uri).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });
});

describe('Resource Handlers', () => {
  let handlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const client = new DashClawClient();
    handlers = createResourceHandlers(client);
  });

  describe('dashclaw://policies', () => {
    it('returns policies as JSON text', async () => {
      mockGet.mockResolvedValue({ policies: [{ id: 'gp_1', name: 'Block deploys' }] });

      const result = await handlers['dashclaw://policies']();

      expect(mockGet).toHaveBeenCalledWith('/api/policies', {}, { timeout: 10000 });
      expect(JSON.parse(result)).toEqual({ policies: [{ id: 'gp_1', name: 'Block deploys' }] });
    });
  });

  describe('dashclaw://capabilities', () => {
    it('returns capabilities as JSON text', async () => {
      mockGet.mockResolvedValue({ capabilities: [{ id: 'cap_1', name: 'Slack' }] });

      const result = await handlers['dashclaw://capabilities']();

      expect(mockGet).toHaveBeenCalledWith('/api/capabilities', {}, { timeout: 10000 });
      expect(JSON.parse(result)).toEqual({ capabilities: [{ id: 'cap_1', name: 'Slack' }] });
    });
  });

  describe('dashclaw://agent/{agent_id}/history', () => {
    it('returns action history for a specific agent', async () => {
      mockGet.mockResolvedValue({ actions: [{ id: 'act_1' }] });

      const result = await handlers['dashclaw://agent/{agent_id}/history']({ agent_id: 'bot1' });

      expect(mockGet).toHaveBeenCalledWith('/api/actions', { agent_id: 'bot1', limit: '50' }, { timeout: 10000 });
      expect(JSON.parse(result)).toEqual({ actions: [{ id: 'act_1' }] });
    });
  });

  describe('dashclaw://status', () => {
    it('combines health and operations summary', async () => {
      mockGet
        .mockResolvedValueOnce({ status: 'healthy', version: '2.11.0' })
        .mockResolvedValueOnce({ throughput: { last_24h: 150 } });

      const result = await handlers['dashclaw://status']();
      const parsed = JSON.parse(result);

      expect(parsed.health).toEqual({ status: 'healthy', version: '2.11.0' });
      expect(parsed.operations).toEqual({ throughput: { last_24h: 150 } });
    });
  });
});

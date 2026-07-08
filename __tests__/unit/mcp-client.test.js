import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { DashClawClient } = await import('../../mcp-server/lib/client.js');

describe('DashClawClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DashClawClient({
      url: 'http://localhost:3000',
      apiKey: 'oc_live_test123',
    });
  });

  describe('constructor', () => {
    it('strips trailing slash from URL', () => {
      const c = new DashClawClient({ url: 'http://localhost:3000/', apiKey: 'k' });
      expect(c.baseUrl).toBe('http://localhost:3000');
    });

    it('uses defaults when no args provided', () => {
      const c = new DashClawClient({});
      expect(c.baseUrl).toBe('http://localhost:3000');
      expect(c.apiKey).toBe('');
    });
  });

  describe('post()', () => {
    it('sends POST with JSON body and x-api-key header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ decision: 'allow' }),
      });

      const result = await client.post('/api/guard', { action_type: 'deploy' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/guard',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'oc_live_test123',
          },
          body: JSON.stringify({ action_type: 'deploy' }),
        }),
      );
      expect(result).toEqual({ decision: 'allow' });
    });

    it('returns error object on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: 'Forbidden' }),
      });

      const result = await client.post('/api/guard', {});
      expect(result).toEqual({ error: 'Forbidden', _status: 403 });
    });

    it('returns error object on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await client.post('/api/guard', {});
      expect(result).toEqual({ error: 'Network error calling DashClaw: Connection refused', _status: 0 });
    });
  });

  describe('get()', () => {
    it('sends GET with query params and x-api-key header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ policies: [] }),
      });

      const result = await client.get('/api/policies', { agent_id: 'bot1' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/policies?agent_id=bot1',
        expect.objectContaining({
          method: 'GET',
          headers: { 'x-api-key': 'oc_live_test123' },
        }),
      );
      expect(result).toEqual({ policies: [] });
    });

    it('omits query string when params are empty', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ capabilities: [] }),
      });

      await client.get('/api/capabilities', {});
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/capabilities',
        expect.anything(),
      );
    });
  });

  describe('patch()', () => {
    it('sends PATCH with JSON body and x-api-key header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ updated: true }),
      });

      const result = await client.patch('/api/policies/pol_123', { status: 'inactive' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/policies/pol_123',
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'oc_live_test123',
          },
          body: JSON.stringify({ status: 'inactive' }),
        }),
      );
      expect(result).toEqual({ updated: true });
    });

    it('returns error object on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'Not Found' }),
      });

      const result = await client.patch('/api/policies/pol_missing', {});
      expect(result).toEqual({ error: 'Not Found', _status: 404 });
    });

    it('returns error object on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await client.patch('/api/policies/pol_123', {});
      expect(result).toEqual({ error: 'Network error calling DashClaw: Connection refused', _status: 0 });
    });
  });
});

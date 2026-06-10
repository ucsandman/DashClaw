import { describe, it, expect, vi, beforeEach } from 'vitest';

// No creds configured → every checker returns not_configured without touching
// the network, so these tests exercise the cache mechanics only.
const mockGetSettings = vi.fn(async () => []);
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: (...a) => mockGetSettings(...a),
  shouldAutoEncrypt: () => false,
}));

import {
  checkAllIntegrations,
  getCachedIntegrationHealth,
  __resetIntegrationHealthCache,
} from '@/lib/integration-health.js';

const sql = () => Promise.resolve([]);

beforeEach(() => {
  __resetIntegrationHealthCache();
  mockGetSettings.mockClear();
});

describe('integration-health cache', () => {
  it('checkAllIntegrations returns a result per provider with unchanged status values', async () => {
    const results = await checkAllIntegrations('org_1', sql);
    expect(Object.keys(results)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'slack', 'discord', 'linear', 'github', 'neon', 'resend', 'stripe']),
    );
    for (const r of Object.values(results)) {
      expect(r.status).toBe('not_configured');
      expect(r.checked_at).toBeTruthy();
    }
  });

  it('getCachedIntegrationHealth returns {} immediately on a cold cache, then refreshes in the background', async () => {
    const cold = await getCachedIntegrationHealth('org_1', sql);
    expect(cold).toEqual({});
    await vi.waitFor(async () => {
      const warm = await getCachedIntegrationHealth('org_1', sql);
      expect(Object.keys(warm).length).toBeGreaterThan(0);
    });
  });

  it('serves from cache within the TTL without re-probing', async () => {
    await checkAllIntegrations('org_1', sql);
    mockGetSettings.mockClear();
    const cached = await getCachedIntegrationHealth('org_1', sql);
    expect(Object.keys(cached).length).toBeGreaterThan(0);
    expect(mockGetSettings).not.toHaveBeenCalled();
  });

  it('caches per org — a different org starts cold', async () => {
    await checkAllIntegrations('org_1', sql);
    const other = await getCachedIntegrationHealth('org_2', sql);
    expect(other).toEqual({});
  });
});

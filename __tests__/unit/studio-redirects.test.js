import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.js';

// Studio consolidation (4 pages -> 2): the retired page paths must permanently
// redirect (Next emits 308 for permanent redirects) to their new homes under
// /workflows. API routes (/api/model-strategies/*) are intentionally untouched.
describe('studio consolidation redirects', () => {
  it('permanently redirects every retired page path to its new home', async () => {
    const redirects = await nextConfig.redirects();

    const expected = [
      { source: '/model-strategies', destination: '/workflows/strategies' },
      { source: '/model-strategies/new', destination: '/workflows/strategies/new' },
      { source: '/model-strategies/:strategyId', destination: '/workflows/strategies/:strategyId' },
      { source: '/labs/branch-finish', destination: '/decisions' },
    ];

    for (const { source, destination } of expected) {
      const entry = redirects.find((r) => r.source === source);
      expect(entry, `missing redirect for ${source}`).toBeTruthy();
      expect(entry.destination).toBe(destination);
      expect(entry.permanent).toBe(true);
    }
  });

  it('keeps /model-strategies/new ahead of the :strategyId pattern', async () => {
    const redirects = await nextConfig.redirects();
    const newIdx = redirects.findIndex((r) => r.source === '/model-strategies/new');
    const paramIdx = redirects.findIndex((r) => r.source === '/model-strategies/:strategyId');
    expect(newIdx).toBeGreaterThan(-1);
    expect(paramIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(paramIdx);
  });

  it('does not redirect the API surface', async () => {
    const redirects = await nextConfig.redirects();
    expect(redirects.some((r) => r.source.startsWith('/api/model-strategies'))).toBe(false);
  });
});

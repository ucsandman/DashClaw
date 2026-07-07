import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.js';

// The retired /labs/branch-finish operator page permanently redirects (Next
// emits 308 for permanent redirects) to the decisions ledger. The
// model-strategies pages and their redirects were removed with the v5 cull.
describe('retired page redirects', () => {
  it('permanently redirects /labs/branch-finish to the decisions ledger', async () => {
    const redirects = await nextConfig.redirects();
    const entry = redirects.find((r) => r.source === '/labs/branch-finish');
    expect(entry, 'missing redirect for /labs/branch-finish').toBeTruthy();
    expect(entry.destination).toBe('/decisions');
    expect(entry.permanent).toBe(true);
  });

  it('does not redirect the model-strategies surface (removed in the v5 cull)', async () => {
    const redirects = await nextConfig.redirects();
    expect(redirects.some((r) => r.source.startsWith('/model-strategies'))).toBe(false);
    expect(redirects.some((r) => r.source.startsWith('/api/model-strategies'))).toBe(false);
  });
});

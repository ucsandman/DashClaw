import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  findPolicyByName: vi.fn(async () => []),
  insertPolicy: vi.fn(async (_sql, _org, { id, name, policyType }) => ({ id, name, policy_type: policyType, active: 1 })),
}));

import { importPolicies, loadPackPolicies } from '@/lib/guardrails/import-pack.js';

describe('import-pack', () => {
  it('empty policy list → zero imported/skipped/errors (provisioning-safe edge)', async () => {
    const result = await importPolicies(vi.fn(), 'org_edge', []);
    expect(result).toEqual({ imported: [], skipped: [], errors: [] });
  });

  it('loadPackPolicies reads the real claude-code-starter pack (4 policies)', async () => {
    const policies = await loadPackPolicies('claude-code-starter');
    expect(policies).toHaveLength(4);
    expect(policies.map((p) => p.id)).toEqual([
      'block_mass_destructive',
      'require_approval_network_calls',
      'require_approval_package_installs',
      'rate_limit_runaway_safety',
    ]);
  });

  it('loadPackPolicies throws on a missing pack (the route maps this to 404)', async () => {
    await expect(loadPackPolicies('no-such-pack')).rejects.toThrow();
  });
});

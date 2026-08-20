import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindPolicyByName, mockInsertPolicy, mockGetActivePolicies } = vi.hoisted(() => ({
  mockFindPolicyByName: vi.fn(async () => []),
  mockInsertPolicy: vi.fn(async (_sql, _org, { id, name, policyType }) => ({ id, name, policy_type: policyType, active: 1 })),
  mockGetActivePolicies: vi.fn(async () => []),
}));

vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  findPolicyByName: mockFindPolicyByName,
  insertPolicy: mockInsertPolicy,
  getActivePolicies: mockGetActivePolicies,
}));

import { importPolicies, loadPackPolicies } from '@/lib/guardrails/import-pack.js';

/** The (policyType, parsed rules) actually handed to insertPolicy, in order. */
function stored() {
  return mockInsertPolicy.mock.calls.map(([, , data]) => ({
    name: data.name,
    policy_type: data.policyType,
    rules: JSON.parse(data.rules),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindPolicyByName.mockResolvedValue([]);
  mockInsertPolicy.mockImplementation(async (_sql, _org, { id, name, policyType }) => ({
    id, name, policy_type: policyType, active: 1,
  }));
  mockGetActivePolicies.mockResolvedValue([]);
});

describe('import-pack', () => {
  it('empty policy list → zero imported/skipped/errors (provisioning-safe edge)', async () => {
    const result = await importPolicies(vi.fn(), 'org_edge', []);
    expect(result).toEqual({ imported: [], skipped: [], errors: [], watched: 0, dormant: 0 });
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

describe('import-pack — Short List admission', () => {
  it('a block rule in a pack that does not opt in lands as warn', async () => {
    const result = await importPolicies(vi.fn(), 'org_1', [
      { id: 'boom', description: 'Boom', policy_type: 'risk_threshold', rules: { threshold: 100, action: 'block' } },
    ]);
    expect(result.watched).toBe(1);
    expect(stored()).toEqual([
      { name: 'Boom', policy_type: 'risk_threshold', rules: { threshold: 100, action: 'warn' } },
    ]);
  });

  it('a require_approval rule is stored as warn_action_type (its evaluator ignores rules.action)', async () => {
    await importPolicies(vi.fn(), 'org_1', [
      { id: 'net', description: 'Net', policy_type: 'require_approval', rules: { action_types: ['api'] } },
    ]);
    expect(stored()).toEqual([
      { name: 'Net', policy_type: 'warn_action_type', rules: { action_types: ['api'] } },
    ]);
  });

  it('the real claude-code-starter pack installs entirely in Watch', async () => {
    const policies = await loadPackPolicies('claude-code-starter');
    const result = await importPolicies(vi.fn(), 'org_1', policies);
    expect(result.imported).toHaveLength(4);
    // block + two require_approval rules demoted; the rate_limit was already warn.
    expect(result.watched).toBe(3);
    for (const row of stored()) {
      expect(['warn', undefined]).toContain(row.rules.action);
      expect(row.policy_type).not.toBe('require_approval');
      expect(row.policy_type).not.toBe('block_action_type');
    }
  });

  it('a short_list: true line keeps its interrupting action and its flags', async () => {
    const result = await importPolicies(vi.fn(), 'org_1', [
      {
        id: 'catastrophe',
        description: 'Catastrophe',
        policy_type: 'block_action_type',
        rules: { action_types: ['drop'], short_list: true, ungrantable: true },
      },
    ]);
    expect(result.watched).toBe(0);
    expect(stored()).toEqual([
      {
        name: 'Catastrophe',
        policy_type: 'block_action_type',
        rules: { action_types: ['drop'], short_list: true, ungrantable: true },
      },
    ]);
  });

  it('skips the 11th short-list line with a short_list_full reason', async () => {
    const packLine = (n) => ({
      id: `line_${n}`,
      description: `Line ${n}`,
      policy_type: 'block_action_type',
      rules: { action_types: [`t${n}`], short_list: true },
    });
    const result = await importPolicies(vi.fn(), 'org_1', Array.from({ length: 11 }, (_, i) => packLine(i)));
    expect(result.imported).toHaveLength(10);
    expect(result.skipped).toEqual(['Line 10 (short_list_full)']);
  });

  it('counts the org’s existing active interrupting rules against the cap', async () => {
    mockGetActivePolicies.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `gp_${i}`,
        policy_type: 'require_approval',
        rules: JSON.stringify({ action_types: [`t${i}`] }),
        active: 1,
      })),
    );
    const result = await importPolicies(vi.fn(), 'org_full', [
      { id: 'x', description: 'X', policy_type: 'block_action_type', rules: { action_types: ['drop'], short_list: true } },
      { id: 'y', description: 'Y', policy_type: 'warn_action_type', rules: { action_types: ['post'] } },
    ]);
    expect(result.skipped).toEqual(['X (short_list_full)']);
    // The watched line still installs — the cap only gates interrupting lines.
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].name).toBe('Y');
  });

  it('installs a no-warn-tier line DORMANT rather than dropping it or faking a demotion', async () => {
    const result = await importPolicies(vi.fn(), 'org_1', [
      { id: 'role', description: 'Role', policy_type: 'role_constraint', rules: { role: 'junior', blocked_action_types: ['deploy'] } },
      { id: 'nf', description: 'NF', policy_type: 'non_fabrication', rules: { on_violation: 'block' } },
      { id: 'wh', description: 'WH', policy_type: 'webhook_check', rules: { url: 'https://example.com/hook' } },
    ]);
    // Nothing is skipped and nothing is watched: all three reached the DB, off.
    expect(result.skipped).toEqual([]);
    expect(result.watched).toBe(0);
    expect(result.dormant).toBe(3);
    expect(result.imported).toEqual([]);
    expect(mockInsertPolicy).toHaveBeenCalledTimes(3);
    for (const [, , data] of mockInsertPolicy.mock.calls) {
      expect(data.active).toBe(0);
      expect(JSON.parse(data.rules).short_list).toBeUndefined();
    }
    // The stored type is preserved — no swap, no invented flag.
    expect(mockInsertPolicy.mock.calls.map(([, , d]) => d.policyType))
      .toEqual(['role_constraint', 'non_fabrication', 'webhook_check']);
  });

  it('leaves a never-interrupting line byte-identical (its flags are not stripped)', async () => {
    await importPolicies(vi.fn(), 'org_1', [
      { id: 'w', description: 'W', policy_type: 'warn_action_type', rules: { action_types: ['post'], ungrantable: true } },
    ]);
    expect(stored()).toEqual([
      { name: 'W', policy_type: 'warn_action_type', rules: { action_types: ['post'], ungrantable: true } },
    ]);
  });

  it('a name conflict still skips before any Short List accounting', async () => {
    mockFindPolicyByName.mockResolvedValue([{ id: 'gp_existing' }]);
    const result = await importPolicies(vi.fn(), 'org_1', [
      { id: 'dupe', description: 'Dupe', policy_type: 'block_action_type', rules: { action_types: ['drop'], short_list: true } },
    ]);
    expect(result.skipped).toEqual(['Dupe']);
    expect(mockInsertPolicy).not.toHaveBeenCalled();
  });
});

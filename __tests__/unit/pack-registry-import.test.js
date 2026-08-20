// Every shipped pack must survive Short List admission INTACT: installing a
// pack may never silently drop a line. Regression guard for the round-1
// no_watch_tier skip, which quietly installed read-only-analyst as zero rules.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindPolicyByName, mockInsertPolicy, mockGetActivePolicies } = vi.hoisted(() => ({
  mockFindPolicyByName: vi.fn(async () => []),
  mockInsertPolicy: vi.fn(async (_sql, _org, d) => ({
    id: d.id, name: d.name, policy_type: d.policyType, active: d.active ?? 1,
  })),
  mockGetActivePolicies: vi.fn(async () => []),
}));

vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  findPolicyByName: mockFindPolicyByName,
  insertPolicy: mockInsertPolicy,
  getActivePolicies: mockGetActivePolicies,
}));

import { importPolicies, loadPackPolicies } from '@/lib/guardrails/import-pack.js';
import { AVAILABLE_PACKS } from '@/lib/policyPackPreviews.js';

/** The rows insertPolicy was asked to store, keyed by name. */
function storedByName() {
  const out = new Map();
  for (const [, , d] of mockInsertPolicy.mock.calls) {
    out.set(d.name, { policy_type: d.policyType, active: d.active ?? 1, rules: JSON.parse(d.rules) });
  }
  return out;
}

/** The four pack lines whose policy_type has no Watch tier. */
const DORMANT_LINES = [
  ['read-only-analyst', 'analyst_role', 'role_constraint'],
  ['fleet-control', 'subagent_attenuation', 'delegation_constraint'],
  ['outbound-comms-guard', 'no_fabricated_outbound', 'non_fabrication'],
  ['support-agent', 'grounded_replies', 'non_fabrication'],
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFindPolicyByName.mockResolvedValue([]);
  mockInsertPolicy.mockImplementation(async (_sql, _org, d) => ({
    id: d.id, name: d.name, policy_type: d.policyType, active: d.active ?? 1,
  }));
  mockGetActivePolicies.mockResolvedValue([]);
});

describe('every shipped pack imports completely', () => {
  it('the registry is non-empty (guards against a vacuous sweep)', () => {
    expect(AVAILABLE_PACKS.length).toBeGreaterThan(10);
  });

  it.each(AVAILABLE_PACKS)('%s: nothing is skipped and every line reaches the database', async (pack) => {
    const policies = await loadPackPolicies(pack);
    expect(policies.length).toBeGreaterThan(0);

    const result = await importPolicies(vi.fn(), 'org_fresh', policies);

    expect(result.errors).toEqual([]);
    // Fresh org: no name conflicts, and no line may be dropped for any reason.
    expect(result.skipped).toEqual([]);
    expect(result.imported.length + result.dormant).toBe(policies.length);
    expect(mockInsertPolicy).toHaveBeenCalledTimes(policies.length);
  });

  it.each(DORMANT_LINES)('%s / %s (%s) lands dormant with its rules untouched', async (pack, id, type) => {
    const policies = await loadPackPolicies(pack);
    const line = policies.find((p) => p.id === id);
    expect(line, `${pack} no longer ships ${id}`).toBeDefined();

    const result = await importPolicies(vi.fn(), 'org_fresh', policies);
    expect(result.dormant).toBeGreaterThanOrEqual(1);

    const stored = storedByName().get(line.description || line.id);
    expect(stored).toBeDefined();
    expect(stored.active).toBe(0);
    // Dormant means UNTOUCHED: the type is preserved and no short_list flag is
    // invented on the operator's behalf.
    expect(stored.policy_type).toBe(type);
    expect(stored.rules).toEqual(line.rules);
    expect(stored.rules.short_list).toBeUndefined();
  });

  it('read-only-analyst installs its whole (single-policy) pack, not zero rules', async () => {
    const policies = await loadPackPolicies('read-only-analyst');
    const result = await importPolicies(vi.fn(), 'org_fresh', policies);
    expect(result.imported.length + result.dormant).toBe(policies.length);
    expect(mockInsertPolicy).toHaveBeenCalledTimes(policies.length);
  });

  it('a dormant line consumes no Short List slot', async () => {
    const policies = await loadPackPolicies('read-only-analyst');
    // Cap already full: the dormant line must still install.
    mockGetActivePolicies.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `gp_${i}`, policy_type: 'require_approval',
        rules: JSON.stringify({ action_types: [`t${i}`] }), active: 1,
      })),
    );
    const result = await importPolicies(vi.fn(), 'org_full', policies);
    expect(result.skipped).toEqual([]);
    expect(result.dormant).toBeGreaterThanOrEqual(1);
  });
});

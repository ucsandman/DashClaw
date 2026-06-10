/**
 * Integration: "Apply profile" from /compliance round-trips the REAL
 * POST /api/policies/modes/import handler — an admin applies the soc2 mode,
 * the compiled policies land in an in-memory guard_policies store with the
 * `_mode` tag, re-apply is idempotent (reactivates instead of duplicating),
 * and the applied state becomes visible to buildPolicySummary (the exact
 * signal the /compliance ProfileBand polls via GET /api/policies/summary).
 * A member role gets a 403 (the band renders a calm inline message for it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, store, role } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  store: { policies: [] },
  role: { value: 'admin' },
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: () => 'org_p13',
  getOrgRole: () => role.value,
}));
// In-memory guard_policies store standing in for Postgres, implementing the
// three repository calls the import route makes.
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  findPolicyByName: vi.fn(async (sql, orgId, name) =>
    store.policies.filter((p) => p.org_id === orgId && p.name === name)),
  insertPolicy: vi.fn(async (sql, orgId, { id, name, policyType, rules, active }) => {
    const row = { id, org_id: orgId, name, policy_type: policyType, rules, active: active ? 1 : 0 };
    store.policies.push(row);
    return row;
  }),
  reactivateModePolicy: vi.fn(async (sql, orgId, id, { policyType, rules }) => {
    const row = store.policies.find((p) => p.org_id === orgId && p.id === id);
    if (!row) return null;
    row.policy_type = policyType;
    row.rules = rules;
    row.active = 1;
    return row;
  }),
}));

const { POST } = await import('@/api/policies/modes/import/route.js');
const { compileMode } = await import('@/lib/policy-modes/compile');
const { buildPolicySummary } = await import('@/lib/policy-modes/summary');

function importRequest(body) {
  return new Request('http://test/api/policies/modes/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.policies.length = 0;
  role.value = 'admin';
});

describe('apply compliance profile (POST /api/policies/modes/import)', () => {
  it('member role → 403 (the ProfileBand degrades to a calm message)', async () => {
    role.value = 'member';
    const res = await POST(importRequest({ mode_id: 'soc2' }));
    expect(res.status).toBe(403);
    expect(store.policies.length).toBe(0);
  });

  it('unknown mode_id → 400', async () => {
    const res = await POST(importRequest({ mode_id: 'not-a-mode' }));
    expect(res.status).toBe(400);
  });

  it('admin applies soc2 → compiled policies created with the _mode tag, visible to the summary', async () => {
    const expected = compileMode('soc2');
    const res = await POST(importRequest({ mode_id: 'soc2' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported).toBe(expected.length);
    expect(body.errors).toEqual([]);
    expect(store.policies.length).toBe(expected.length);

    // Every persisted policy carries the _mode tag the summary keys off.
    for (const p of store.policies) {
      expect(JSON.parse(p.rules)._mode).toBe('soc2');
    }

    // The exact applied-state signal the ProfileBand reads: summary.modes.
    const summary = buildPolicySummary(
      store.policies.map((p) => ({ ...p, agent_ids: null })),
      {},
      { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 },
      0,
      0,
    );
    expect(summary.modes.map((m) => m.id)).toContain('soc2');
  });

  it('re-apply is idempotent: reactivates the same rows, no duplicates', async () => {
    await POST(importRequest({ mode_id: 'soc2' }));
    const countAfterFirst = store.policies.length;

    // Simulate the operator toggling the pack off, then re-applying.
    for (const p of store.policies) p.active = 0;
    const res = await POST(importRequest({ mode_id: 'soc2' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reactivated).toBe(countAfterFirst);
    expect(body.imported).toBe(0);
    expect(store.policies.length).toBe(countAfterFirst);
    expect(store.policies.every((p) => p.active === 1)).toBe(true);
  });

  it('enterprise-strict (the non-soc2 framework default) applies the same way', async () => {
    const expected = compileMode('enterprise-strict');
    const res = await POST(importRequest({ mode_id: 'enterprise-strict' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported).toBe(expected.length);
  });
});

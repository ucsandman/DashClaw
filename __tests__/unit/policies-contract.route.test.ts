import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

/** helpers.js returns a duck-typed request object; route handlers expect Request. */
function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockSql,
  mockGetActivePolicies,
  mockGetDecisionCountsByPolicy,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActivePolicies: vi.fn(),
  mockGetDecisionCountsByPolicy: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getActivePolicies: mockGetActivePolicies,
  getDecisionCountsByPolicy: mockGetDecisionCountsByPolicy,
}));

import { GET } from '@/api/policies/contract/route.js';

describe('GET /api/policies/contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockGetActivePolicies.mockResolvedValue([]);
    mockGetDecisionCountsByPolicy.mockResolvedValue({});
  });

  it('returns 200 with the expected ContractView shape', async () => {
    mockGetActivePolicies.mockResolvedValue([
      {
        id: 'gp_1',
        name: 'Require approval for deploys',
        policy_type: 'require_approval',
        rules: JSON.stringify({ action_types: ['deploy'] }),
        active: 1,
      },
    ]);
    mockGetDecisionCountsByPolicy.mockResolvedValue({
      gp_1: { fired: 3, lastFiredAt: '2026-06-10T00:00:00Z' },
    });

    const res = await GET(
      makeRequest('http://localhost/api/policies/contract', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('governed');
    expect(data).toHaveProperty('interrupts');
    expect(data).toHaveProperty('silent');
    expect(data).toHaveProperty('blocks');
    expect(data).toHaveProperty('grants');
    expect(data).toHaveProperty('custom');
    expect(data).toHaveProperty('friction');
    expect(data.governed).toBe(true);
    expect(data.interrupts).toHaveLength(1);
    expect(data.interrupts[0].fired_7d).toBe(3);
  });

  it('maps getDecisionCountsByPolicy { fired, lastFiredAt } objects to plain numbers', async () => {
    mockGetActivePolicies.mockResolvedValue([
      {
        id: 'gp_2',
        name: 'Block risky tool',
        policy_type: 'block_action_type',
        rules: JSON.stringify({ action_types: ['rm_rf'] }),
        active: 1,
      },
    ]);
    mockGetDecisionCountsByPolicy.mockResolvedValue({
      gp_2: { fired: 7, lastFiredAt: null },
    });

    const res = await GET(
      makeRequest('http://localhost/api/policies/contract', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    const data = await res.json();
    expect(data.blocks[0].fired_7d).toBe(7);
  });

  it('handles getDecisionCountsByPolicy returning numeric strings (Neon coercion)', async () => {
    mockGetActivePolicies.mockResolvedValue([
      {
        id: 'gp_3',
        name: 'Rate limiter',
        policy_type: 'require_approval',
        rules: JSON.stringify({ action_types: ['bash'] }),
        active: 1,
      },
    ]);
    // Simulate Neon returning numeric fields as strings
    mockGetDecisionCountsByPolicy.mockResolvedValue({
      gp_3: { fired: '5' as unknown as number, lastFiredAt: null },
    });

    const res = await GET(
      makeRequest('http://localhost/api/policies/contract', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    const data = await res.json();
    expect(data.interrupts[0].fired_7d).toBe(5);
  });

  it('returns 200 with ungoverned state when no active policies', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/policies/contract', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.governed).toBe(false);
    expect(data.interrupts).toHaveLength(0);
  });

  it('returns 500 when getActivePolicies throws', async () => {
    mockGetActivePolicies.mockRejectedValue(new Error('db fail'));
    const res = await GET(
      makeRequest('http://localhost/api/policies/contract', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    expect(res.status).toBe(500);
  });

  it('returns 200 even when getDecisionCountsByPolicy throws (graceful degradation)', async () => {
    mockGetActivePolicies.mockResolvedValue([]);
    mockGetDecisionCountsByPolicy.mockRejectedValue(new Error('counts fail'));
    const res = await GET(
      makeRequest('http://localhost/api/policies/contract', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    expect(res.status).toBe(200);
  });
});

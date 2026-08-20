import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockFindPolicyByName, mockInsertPolicy, mockGetActivePolicies } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockFindPolicyByName: vi.fn(),
  mockInsertPolicy: vi.fn(),
  mockGetActivePolicies: vi.fn(async () => []),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  findPolicyByName: mockFindPolicyByName,
  insertPolicy: mockInsertPolicy,
  getActivePolicies: mockGetActivePolicies,
}));

// Mock fs for pack loading
vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn(async () => 'policies:\n  - id: pack-policy\n    description: Pack Policy\n    rule:\n      block: true') },
  readFile: vi.fn(async () => 'policies:\n  - id: pack-policy\n    description: Pack Policy\n    rule:\n      block: true'),
}));

// Mock js-yaml
vi.mock('js-yaml', () => ({
  default: { load: vi.fn((content) => ({ policies: [{ id: 'parsed', description: 'Parsed', rule: { block: true } }] })) },
  load: vi.fn((content) => ({ policies: [{ id: 'parsed', description: 'Parsed', rule: { block: true } }] })),
}));

import { POST } from '@/api/policies/import/route.js';

describe('/api/policies/import POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActivePolicies.mockResolvedValue([]);
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('returns 403 for non-admin', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
      body: { pack: 'enterprise-strict' },
    }));
    expect(res.status).toBe(403);
  });

  it('returns 400 when neither pack nor yaml provided', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: {},
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid pack name', async () => {
    const res = await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { pack: 'invalid-pack' },
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid pack');
  });

  it('imports policies from pack', async () => {
    mockFindPolicyByName.mockResolvedValue([]);
    mockInsertPolicy.mockResolvedValue({ id: 'gp_1', name: 'Parsed', policy_type: 'block_action_type', active: 1 });

    const res = await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { pack: 'enterprise-strict' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported).toBe(1);
  });

  it('skips duplicate policies by name', async () => {
    mockFindPolicyByName.mockResolvedValue([{ id: 'existing' }]);

    const res = await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { pack: 'enterprise-strict' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported).toBe(0);
    expect(data.skipped).toBe(1);
  });

  it('imports from raw YAML', async () => {
    mockFindPolicyByName.mockResolvedValue([]);
    mockInsertPolicy.mockResolvedValue({ id: 'gp_2', name: 'Custom', policy_type: 'block_action_type', active: 1 });

    const res = await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { yaml: 'policies:\n  - id: custom\n    description: Custom\n    rule:\n      block: true' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported).toBe(1);
  });

  it('generated policy IDs start with gp_', async () => {
    mockFindPolicyByName.mockResolvedValue([]);
    mockInsertPolicy.mockResolvedValue({ id: 'gp_new', name: 'P', policy_type: 'block_action_type', active: 1 });

    await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { pack: 'enterprise-strict' },
    }));
    expect(mockInsertPolicy.mock.calls[0][2].id).toMatch(/^gp_/);
  });

  it('handles import errors gracefully', async () => {
    mockFindPolicyByName.mockResolvedValue([]);
    mockInsertPolicy.mockRejectedValue(new Error('constraint violation'));

    const res = await POST(makeRequest('http://localhost/api/policies/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { pack: 'enterprise-strict' },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported).toBe(0);
    expect(data.errors.length).toBeGreaterThan(0);
  });

  it('returns 500 on top-level error', async () => {
    // Mock request.json() to throw
    const req = {
      url: 'http://localhost/api/policies/import',
      headers: new Headers({ 'x-org-id': 'org_1', 'x-org-role': 'admin' }),
      json: async () => { throw new Error('parse fail'); },
      nextUrl: new URL('http://localhost/api/policies/import'),
    };
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

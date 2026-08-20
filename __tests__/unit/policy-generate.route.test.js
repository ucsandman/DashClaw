import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGeneratePolicies, mockGetOrgId, mockGetSql, mockGetOrgRole, mockInsertPolicy } = vi.hoisted(() => ({
  mockGeneratePolicies: vi.fn(),
  mockGetOrgId: vi.fn(() => 'org_1'),
  mockGetSql: vi.fn(() => 'mock-sql'),
  mockGetOrgRole: vi.fn(() => 'admin'),
  mockInsertPolicy: vi.fn(),
}));

vi.mock('@/lib/policy-generator.js', () => ({ generatePolicies: mockGeneratePolicies }));
vi.mock('@/lib/org', () => ({ getOrgId: mockGetOrgId, getOrgRole: mockGetOrgRole }));
vi.mock('@/lib/db.js', () => ({ getSql: mockGetSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({ insertPolicy: mockInsertPolicy }));

import { POST } from '@/api/policies/generate/route.js';
import { makeRequest } from '../helpers.js';

describe('POST /api/policies/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgRole.mockReturnValue('admin');
  });

  it('dry_run returns drafts/assumptions/clarifications and threads answers', async () => {
    mockGeneratePolicies.mockResolvedValue({
      drafts: [
        { name: 'Block deploys', policy_type: 'block_action_type', rules: { action_types: ['deploy'] }, confidence: 0.9 },
      ],
      assumptions: ['Assumed deploys means the deploy action type'],
      clarifications: [{ id: 'paths', question: 'Which paths?', suggestions: ['.env'], multi: true }],
      warnings: [],
      input_hash: 'abc123',
    });

    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: 'Block all deploys', answers: [{ id: 'x', value: 'y' }], dry_run: true },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.drafts).toHaveLength(1);
    expect(data.assumptions[0]).toMatch(/Assumed/);
    expect(data.clarifications[0].id).toBe('paths');
    expect(data.input_hash).toBe('abc123');
    expect(data.generated_policies).toBeUndefined();
    expect(mockGeneratePolicies).toHaveBeenCalledWith(expect.anything(), 'org_1', 'Block all deploys', [{ id: 'x', value: 'y' }]);
  });

  it('dry_run defaults answers to an empty array when omitted', async () => {
    mockGeneratePolicies.mockResolvedValue({
      drafts: [],
      assumptions: [],
      clarifications: [{ id: 'intent', question: 'What should this govern?', suggestions: ['block deploys'], multi: false }],
      warnings: [],
      input_hash: 'h',
    });

    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: 'protect my files' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockGeneratePolicies).toHaveBeenCalledWith(expect.anything(), 'org_1', 'protect my files', []);
  });

  it('dry_run=false creates policies from result.drafts (admin)', async () => {
    mockGeneratePolicies.mockResolvedValue({
      drafts: [
        { name: 'Block deploys', policy_type: 'block_action_type', rules: { action_types: ['deploy'] }, confidence: 0.9 },
      ],
      assumptions: [],
      clarifications: [],
      warnings: [],
      input_hash: 'abc123',
    });

    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: 'Block all deploys', dry_run: false },
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.count).toBe(1);
    expect(data.created_policies).toHaveLength(1);
    expect(mockInsertPolicy).toHaveBeenCalledTimes(1);
    // Short List (spec 2.3): a generated draft is stored in Watch — this route
    // writes past the /api/policies admission gate, so it demotes here.
    expect(mockInsertPolicy).toHaveBeenCalledWith('mock-sql', 'org_1', expect.objectContaining({
      name: 'Block deploys',
      policyType: 'warn_action_type',
      rules: JSON.stringify({ action_types: ['deploy'] }),
    }));
  });

  it('dry_run=false demotes an interrupting draft to its Watch tier', async () => {
    mockGeneratePolicies.mockResolvedValue({
      drafts: [
        { name: 'Gate spend', policy_type: 'risk_threshold', rules: { threshold: 70, action: 'require_approval' }, confidence: 0.8 },
      ],
      assumptions: [],
      clarifications: [],
      warnings: [],
      input_hash: 'h',
    });

    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: 'gate risky spend', dry_run: false },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const [, , input] = mockInsertPolicy.mock.calls[0];
    expect(input.policyType).toBe('risk_threshold');
    expect(JSON.parse(input.rules).action).toBe('warn');
  });

  it('returns 403 for a non-admin on dry_run=false', async () => {
    mockGetOrgRole.mockReturnValue('member');

    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: 'Block all deploys', dry_run: false },
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockGeneratePolicies).not.toHaveBeenCalled();
    expect(mockInsertPolicy).not.toHaveBeenCalled();
  });

  it('returns 400 when input_text is missing', async () => {
    const req = makeRequest('http://localhost/api/policies/generate', {
      body: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when input_text is empty', async () => {
    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: '' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 422 when no LLM provider is configured', async () => {
    mockGeneratePolicies.mockResolvedValue({
      error: 'No LLM provider configured. Add an API key in Settings or /setup.',
    });

    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: 'Block all deploys' },
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('caps input_text at 5000 characters', async () => {
    const req = makeRequest('http://localhost/api/policies/generate', {
      body: { input_text: 'a'.repeat(5001) },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

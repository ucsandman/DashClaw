/**
 * Phase 1 agent attribution tests.
 *
 * Phase 1 is trust-on-assertion body-only: agent_id and agent_name are
 * passed directly in the request body and stored verbatim in the audit
 * trail. No JWT extraction in Phase 1 — that comes in Phase 2 with real
 * JWKS verification and a verification_status field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validateGuardInput: mockValidateGuardInput, boundedIdField: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null) }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({ listGuardDecisions: mockListGuardDecisions }));

import { POST } from '@/api/guard/route.js';

describe('/api/guard — Phase 1 agent attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });
  });

  it('passes agent_id and agent_name from request body to evaluateGuard', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    await POST(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': 'org_1' },
      body: { action_type: 'deploy', agent_id: 'agt_body_id', agent_name: 'body-worker' },
    }));

    expect(mockEvaluateGuard).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ agent_id: 'agt_body_id', agent_name: 'body-worker' }),
      mockSql,
      expect.any(Object)
    );
  });

  it('proceeds normally when Authorization header is present but agent identity comes from body', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    // Phase 1: JWT in Authorization header is ignored; body fields are the source of truth
    await POST(makeRequest('http://localhost/api/guard', {
      headers: {
        'x-org-id': 'org_1',
        'authorization': 'Bearer some.bearer.token',
      },
      body: { action_type: 'deploy', agent_id: 'agt_from_body', agent_name: 'body-worker' },
    }));

    expect(mockValidateGuardInput).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agt_from_body', agent_name: 'body-worker' })
    );
    expect(mockEvaluateGuard).toHaveBeenCalled();
  });

  it('proceeds normally when no Authorization header is present', async () => {
    mockValidateGuardInput.mockImplementation((body) => ({
      valid: true,
      data: body,
      errors: [],
    }));

    const res = await POST(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': 'org_1' },
      body: { action_type: 'read' },
    }));

    expect(res.status).toBe(200);
    expect(mockEvaluateGuard).toHaveBeenCalled();
  });
});

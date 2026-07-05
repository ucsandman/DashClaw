import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validateGuardInput: mockValidateGuardInput }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({ listGuardDecisions: mockListGuardDecisions }));
// Phase 2b: stub the replay store. Without this mock the route would call
// the real checkAndRecord against mockSql, which returns [] for every
// tagged-template call — turning every "verified" test into a silent
// 'replayed' result. Mock returns 'unique' so the happy path tests reflect
// the path users actually take.
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));

import { POST, GET } from '@/api/guard/route.js';

describe('/api/guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud'; // disable self-host bypass in GET tests
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockListGuardDecisions.mockResolvedValue({ decisions: [], total: 0, stats: {} });
  });

  describe('POST', () => {
    it('returns 400 on validation failure', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: false, errors: ['action_type required'] });
      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: {},
      }));
      expect(res.status).toBe(400);
    });

    it('returns 200 for allow decision', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: true, data: { action_type: 'read' }, errors: [] });
      mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });

      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: { action_type: 'read' },
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.decision).toBe('allow');
    });

    it('returns 200 for block decision', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: true, data: { action_type: 'delete' }, errors: [] });
      mockEvaluateGuard.mockResolvedValue({ decision: 'block', reasons: ['Blocked'], warnings: [], matched_policies: ['gp_1'] });

      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: { action_type: 'delete' },
      }));
      expect(res.status).toBe(200);
    });

    it('returns 200 for require_approval decision', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: true, data: { action_type: 'deploy' }, errors: [] });
      mockEvaluateGuard.mockResolvedValue({ decision: 'require_approval', reasons: ['Needs approval'], warnings: [], matched_policies: [] });

      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: { action_type: 'deploy' },
      }));
      expect(res.status).toBe(200);
    });

    it('returns 200 for warn decision', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: true, data: { action_type: 'deploy' }, errors: [] });
      mockEvaluateGuard.mockResolvedValue({ decision: 'warn', reasons: [], warnings: ['Rate limit approaching'], matched_policies: [] });

      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: { action_type: 'deploy' },
      }));
      expect(res.status).toBe(200);
    });

    it('auto-scans content for secrets and attaches an advisory warning (no raw secret leaked)', async () => {
      mockValidateGuardInput.mockReturnValue({
        valid: true,
        data: { action_type: 'write', content: 'aws key AKIAIOSFODNN7EXAMPLE in config' },
        errors: [],
      });
      mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });

      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: { action_type: 'write', content: 'aws key AKIAIOSFODNN7EXAMPLE in config' },
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.secret_scan?.detected).toBe(true);
      expect(data.secret_scan.findings.length).toBeGreaterThan(0);
      // The raw secret must never appear in the response.
      expect(JSON.stringify(data)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('hard-blocks a secret in content when DASHCLAW_AUTOSCAN_BLOCK is enabled', async () => {
      mockValidateGuardInput.mockReturnValue({
        valid: true,
        data: { action_type: 'write', content: 'AKIAIOSFODNN7EXAMPLE' },
        errors: [],
      });
      mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });
      // getSettings reads via mockSql — return the opt-in block flag.
      mockSql.mockImplementation(async () => [{ key: 'DASHCLAW_AUTOSCAN_BLOCK', value: 'true' }]);

      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: { action_type: 'write', content: 'AKIAIOSFODNN7EXAMPLE' },
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.decision).toBe('block');
      expect(mockEvaluateGuard).not.toHaveBeenCalled();
    });

    it('passes include_signals option', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: true, data: { action_type: 'read' }, errors: [] });
      mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });

      await POST(makeRequest('http://localhost/api/guard?include_signals=true', {
        headers: { 'x-org-id': 'org_1' },
        body: { action_type: 'read' },
      }));
      expect(mockEvaluateGuard).toHaveBeenCalledWith(
        'org_1',
        // verification_status defaults to 'unverified' when no Authorization header is provided (Phase 2)
        { action_type: 'read', verification_status: 'unverified', replay_status: 'not_applicable', jti: null, act_status: 'not_applicable', act_hash: null, harness_session_id: null, subagent_uuid: null },
        mockSql,
        { includeSignals: true, computeSignals: expect.any(Function) }
      );
    });

    it('calls evaluateGuard with org_id and context', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: true, data: { action_type: 'deploy', risk_score: 50 }, errors: [] });
      mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [] });

      await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_42' },
        body: { action_type: 'deploy', risk_score: 50 },
      }));
      expect(mockEvaluateGuard).toHaveBeenCalledWith(
        'org_42',
        // verification_status defaults to 'unverified' when no Authorization header is provided (Phase 2)
        { action_type: 'deploy', risk_score: 50, verification_status: 'unverified', replay_status: 'not_applicable', jti: null, act_status: 'not_applicable', act_hash: null, harness_session_id: null, subagent_uuid: null },
        mockSql,
        { includeSignals: false, computeSignals: null },
      );
    });

    it('returns 500 on internal error', async () => {
      mockValidateGuardInput.mockReturnValue({ valid: true, data: {}, errors: [] });
      mockEvaluateGuard.mockRejectedValue(new Error('engine fail'));

      const res = await POST(makeRequest('http://localhost/api/guard', {
        headers: { 'x-org-id': 'org_1' },
        body: {},
      }));
      expect(res.status).toBe(500);
    });
  });

  describe('GET', () => {
    it('returns guard decisions with pagination', async () => {
      const decisions = [{ id: 'gd_1', decision: 'block' }];
      mockListGuardDecisions.mockResolvedValueOnce({ decisions, total: 1, stats: { total_24h: 5, blocks_24h: 2, warns_24h: 1, approvals_24h: 1 } });

      const res = await GET(makeRequest('http://localhost/api/guard', { headers: { 'x-org-id': 'org_1' } }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.decisions).toEqual(decisions);
      expect(data.total).toBe(1);
    });

    it('filters by agent_id', async () => {
      mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0, stats: {} });

      await GET(makeRequest('http://localhost/api/guard?agent_id=a1', { headers: { 'x-org-id': 'org_1' } }));
      expect(mockListGuardDecisions).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({ agentId: 'a1' }));
    });

    it('filters by decision type', async () => {
      mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0, stats: {} });

      await GET(makeRequest('http://localhost/api/guard?decision=block', { headers: { 'x-org-id': 'org_1' } }));
      expect(mockListGuardDecisions).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({ decision: 'block' }));
    });

    it('includes 24h stats', async () => {
      mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0, stats: { total_24h: 10, blocks_24h: 3, warns_24h: 2, approvals_24h: 1 } });

      const res = await GET(makeRequest('http://localhost/api/guard', { headers: { 'x-org-id': 'org_1' } }));
      const data = await res.json();
      expect(data.stats.total_24h).toBe(10);
    });

    it('respects limit and offset', async () => {
      mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0, stats: {} });

      const res = await GET(makeRequest('http://localhost/api/guard?limit=5&offset=10', { headers: { 'x-org-id': 'org_1' } }));
      const data = await res.json();
      expect(data.limit).toBe(5);
      expect(data.offset).toBe(10);
    });

    it('caps limit at 1000', async () => {
      mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0, stats: {} });

      const res = await GET(makeRequest('http://localhost/api/guard?limit=5000', { headers: { 'x-org-id': 'org_1' } }));
      const data = await res.json();
      expect(data.limit).toBe(1000);
    });

    it('returns 500 on error', async () => {
      mockListGuardDecisions.mockRejectedValueOnce(new Error('db fail'));
      const res = await GET(makeRequest('http://localhost/api/guard', { headers: { 'x-org-id': 'org_1' } }));
      expect(res.status).toBe(500);
    });
  });
});

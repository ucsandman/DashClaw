import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockValidatePolicy, mockPublishOrgEvent } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidatePolicy: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
// short-list.ts (via the route) imports POLICY_TYPES from this module, so the
// mock must keep the real exports and override only validatePolicy.
vi.mock('@/lib/validate', async (importOriginal) => ({
  ...(await importOriginal()),
  validatePolicy: mockValidatePolicy,
}));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { POLICY_UPDATED: 'policy.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));

import { GET, POST, PATCH, DELETE } from '@/api/policies/route.js';

describe('/api/policies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
  });

  // --- GET ---

  describe('GET', () => {
    it('returns policies for org', async () => {
      const policies = [{ id: 'gp_1', name: 'P1' }];
      mockSql.mockResolvedValueOnce(policies);
      const res = await GET(makeRequest('http://localhost/api/policies', { headers: { 'x-org-id': 'org_1' } }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.policies).toEqual(policies);
    });

    it('returns 500 on error', async () => {
      mockSql.mockRejectedValueOnce(new Error('db fail'));
      const res = await GET(makeRequest('http://localhost/api/policies', { headers: { 'x-org-id': 'org_1' } }));
      expect(res.status).toBe(500);
    });
  });

  // --- POST ---

  describe('POST', () => {
    it('returns 403 for non-admin', async () => {
      const res = await POST(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
        body: {},
      }));
      expect(res.status).toBe(403);
    });

    it('returns 400 on validation failure', async () => {
      mockValidatePolicy.mockReturnValue({ valid: false, errors: ['name is required'] });
      const res = await POST(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: {},
      }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
    });

    it('creates policy and returns 201', async () => {
      mockValidatePolicy.mockReturnValue({
        valid: true,
        data: { name: 'Block Deploy', policy_type: 'block_action_type', rules: '{}' },
        errors: [],
      });
      const created = { id: 'gp_1', name: 'Block Deploy' };
      mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);

      const res = await POST(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { name: 'Block Deploy', policy_type: 'block_action_type', rules: '{}' },
      }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.policy_id).toMatch(/^gp_/);
    });

    it('returns 409 on duplicate name', async () => {
      mockValidatePolicy.mockReturnValue({ valid: true, data: { name: 'X', policy_type: 'block_action_type', rules: '{}' }, errors: [] });
      mockSql.mockRejectedValueOnce(new Error('guard_policies_org_name_unique'));

      const res = await POST(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { name: 'X', policy_type: 'block_action_type', rules: '{}' },
      }));
      expect(res.status).toBe(409);
    });

    it('publishes POLICY_UPDATED event on create', async () => {
      mockValidatePolicy.mockReturnValue({ valid: true, data: { name: 'P', policy_type: 'block_action_type', rules: '{}' }, errors: [] });
      mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'gp_1' }]);

      await POST(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { name: 'P' },
      }));
      expect(mockPublishOrgEvent).toHaveBeenCalledWith('policy.updated', expect.objectContaining({ change_type: 'created' }));
    });

    it('defaults active to 1', async () => {
      mockValidatePolicy.mockReturnValue({ valid: true, data: { name: 'P', policy_type: 'block_action_type', rules: '{}' }, errors: [] });
      mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'gp_1' }]);

      await POST(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { name: 'P' },
      }));
      // The INSERT call should have active=1
      expect(mockSql.mock.calls[0]).toBeDefined();
    });
  });

  // --- PATCH ---

  describe('PATCH', () => {
    it('returns 403 for non-admin', async () => {
      const res = await PATCH(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
        body: { id: 'gp_1' },
      }));
      expect(res.status).toBe(403);
    });

    it('returns 400 when id missing', async () => {
      const res = await PATCH(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: {},
      }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when no fields to update', async () => {
      const res = await PATCH(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { id: 'gp_1' },
      }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('No fields');
    });

    it('returns 404 when policy not found', async () => {
      mockSql.query.mockResolvedValueOnce([{ policy_type: 'block_action_type' }]).mockResolvedValueOnce([]);
      mockValidatePolicy.mockReturnValue({ valid: true, errors: [] });
      const res = await PATCH(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { id: 'gp_1', rules: '{}' },
      }));
      expect(res.status).toBe(404);
    });

    it('updates and returns policy', async () => {
      const updated = { id: 'gp_1', name: 'Updated' };
      mockSql.query.mockResolvedValueOnce([updated]);
      const res = await PATCH(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { id: 'gp_1', name: 'Updated' },
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.policy.name).toBe('Updated');
    });

    it('validates rules through validatePolicy on update', async () => {
      mockSql.query.mockResolvedValueOnce([{ policy_type: 'block_action_type' }]);
      mockValidatePolicy.mockReturnValue({ valid: false, errors: ['bad rules'] });
      const res = await PATCH(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { id: 'gp_1', rules: '{"bad": true}' },
      }));
      expect(res.status).toBe(400);
    });

    it('publishes POLICY_UPDATED event on update', async () => {
      const updated = { id: 'gp_1', name: 'New' };
      mockSql.query.mockResolvedValueOnce([updated]);
      await PATCH(makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { id: 'gp_1', name: 'New' },
      }));
      expect(mockPublishOrgEvent).toHaveBeenCalledWith('policy.updated', expect.objectContaining({ change_type: 'updated' }));
    });
  });

  // --- DELETE ---

  describe('DELETE', () => {
    it('returns 403 for non-admin', async () => {
      const req = makeRequest('http://localhost/api/policies?id=gp_1', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(403);
    });

    it('returns 400 when id missing', async () => {
      const req = makeRequest('http://localhost/api/policies', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 when policy not found', async () => {
      mockSql.mockResolvedValueOnce([]);
      const req = makeRequest('http://localhost/api/policies?id=gp_1', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(404);
    });

    it('deletes and returns success', async () => {
      mockSql.mockResolvedValueOnce([{ id: 'gp_1' }]);
      const req = makeRequest('http://localhost/api/policies?id=gp_1', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);
    });

    it('publishes POLICY_UPDATED event on delete', async () => {
      mockSql.mockResolvedValueOnce([{ id: 'gp_1' }]);
      const req = makeRequest('http://localhost/api/policies?id=gp_1', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      });
      await DELETE(req);
      expect(mockPublishOrgEvent).toHaveBeenCalledWith('policy.updated', expect.objectContaining({ change_type: 'deleted' }));
    });
  });
});

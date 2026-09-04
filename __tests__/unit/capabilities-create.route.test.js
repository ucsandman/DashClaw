/**
 * POST /api/capabilities — restored write path on the enforcement seam
 * (2026-09-04 spend incident: an http_api capability is the credential
 * custody seam for purchases; operators need a non-SQL registration path).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const m = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  createCapability: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: () => 'org_1',
  getOrgRole: () => 'admin',
  getUserId: () => 'user_1',
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: m.logActivity }));
vi.mock('@/lib/repositories/capabilities.repository.js', () => ({
  listCapabilities: vi.fn(),
  createCapability: m.createCapability,
}));

import { POST } from '@/api/capabilities/route.js';

function post(body) {
  return POST(makeRequest('http://localhost/api/capabilities', { body }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/capabilities', () => {
  it('creates a capability and returns 201 with the shaped row', async () => {
    const capability = {
      capability_id: 'cap_1',
      org_id: 'org_1',
      name: 'Registrar buy',
      slug: 'registrar-buy',
      source_type: 'http_api',
      risk_level: 'high',
    };
    m.createCapability.mockResolvedValue(capability);

    const res = await post({ name: 'Registrar buy', source_type: 'http_api', risk_level: 'high' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ success: true, capability });
    expect(m.createCapability).toHaveBeenCalledWith(
      m.sql,
      'org_1',
      expect.objectContaining({ name: 'Registrar buy', source_type: 'http_api', risk_level: 'high' }),
    );
    expect(m.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        actorId: 'user_1',
        action: 'capability.created',
        resourceType: 'capability',
        resourceId: 'cap_1',
      }),
      m.sql,
    );
  });

  it('400s when name is missing', async () => {
    const res = await post({ source_type: 'http_api' });
    expect(res.status).toBe(400);
    expect(m.createCapability).not.toHaveBeenCalled();
  });

  it('400s on a repository validation error', async () => {
    m.createCapability.mockRejectedValue(new Error('risk_level must be one of low, medium, high, critical'));
    const res = await post({ name: 'X', risk_level: 'extreme' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/risk_level must be/);
  });

  it('409s on a duplicate slug', async () => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    m.createCapability.mockRejectedValue(err);
    const res = await post({ name: 'Registrar buy', slug: 'registrar-buy' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: 'capability_exists', slug: 'registrar-buy' });
  });

  it('400s on malformed JSON', async () => {
    const req = makeRequest('http://localhost/api/capabilities', {});
    req.json = async () => { throw new SyntaxError('Unexpected end of JSON input'); };
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(m.createCapability).not.toHaveBeenCalled();
  });
});

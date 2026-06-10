import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  deleteSecret: vi.fn(),
  listRotationDue: vi.fn(),
}));
vi.mock('../../app/lib/repositories/governed-secrets.repository.js', () => repo);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: () => 'org_1', getOrgRole: () => 'admin', getUserId: () => 'usr_test' }));

beforeEach(() => Object.values(repo).forEach((fn) => fn.mockReset()));

describe('GET /api/secrets', () => {
  it('returns list scoped by agent_id', async () => {
    repo.listSecrets.mockResolvedValue([{ id: 'sec_1', name: 'stripe' }]);
    const { GET } = await import('../../app/api/secrets/route.js');
    const res = await GET(new Request('http://test/api/secrets?agent_id=hermes', { headers: { 'x-api-key': 'k' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.secrets).toHaveLength(1);
  });
});

describe('POST /api/secrets', () => {
  it('creates with valid body', async () => {
    repo.createSecret.mockResolvedValue({ id: 'sec_1', name: 'openai' });
    const { POST } = await import('../../app/api/secrets/route.js');
    const res = await POST(new Request('http://test/api/secrets', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'openai', rotation_interval_days: 30 }),
    }));
    expect(res.status).toBe(201);
  });

  it('returns 400 when name missing', async () => {
    const { POST } = await import('../../app/api/secrets/route.js');
    const res = await POST(new Request('http://test/api/secrets', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/secrets/[id]', () => {
  it('updates lastRotatedAt', async () => {
    repo.updateSecret.mockResolvedValue({ id: 'sec_1', last_rotated_at: '2026-05-14T00:00:00Z' });
    const { PATCH } = await import('../../app/api/secrets/[id]/route.js');
    const res = await PATCH(new Request('http://test/api/secrets/sec_1', {
      method: 'PATCH', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ last_rotated_at: '2026-05-14T00:00:00Z' }),
    }), { params: Promise.resolve({ id: 'sec_1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    repo.updateSecret.mockResolvedValue(null);
    const { PATCH } = await import('../../app/api/secrets/[id]/route.js');
    const res = await PATCH(new Request('http://test/api/secrets/sec_x', {
      method: 'PATCH', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'x' }),
    }), { params: Promise.resolve({ id: 'sec_x' }) });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/secrets/[id]', () => {
  it('returns 200 when deleted', async () => {
    repo.deleteSecret.mockResolvedValue(true);
    const { DELETE } = await import('../../app/api/secrets/[id]/route.js');
    const res = await DELETE(new Request('http://test/api/secrets/sec_1', {
      method: 'DELETE', headers: { 'x-api-key': 'k' },
    }), { params: Promise.resolve({ id: 'sec_1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    repo.deleteSecret.mockResolvedValue(false);
    const { DELETE } = await import('../../app/api/secrets/[id]/route.js');
    const res = await DELETE(new Request('http://test/api/secrets/sec_x', {
      method: 'DELETE', headers: { 'x-api-key': 'k' },
    }), { params: Promise.resolve({ id: 'sec_x' }) });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/secrets/rotation-due', () => {
  it('returns secrets due within window', async () => {
    repo.listRotationDue.mockResolvedValue([{ id: 'sec_1', name: 'stripe', days_until_due: 3 }]);
    const { GET } = await import('../../app/api/secrets/rotation-due/route.js');
    const res = await GET(new Request('http://test/api/secrets/rotation-due?within_days=14', { headers: { 'x-api-key': 'k' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.due).toHaveLength(1);
  });
});

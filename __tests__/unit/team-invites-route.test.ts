/**
 * /api/team/invites — seat management contract:
 *  - GET lists pending invites; POST records one; DELETE revokes one.
 *  - Human org admins only (usr_ principal + admin role): agents (key_),
 *    anonymous trial cookies (trial:), and members are all refused. A
 *    CLAIMED org's admin passes — the gate is principal-shaped, not
 *    denyTrialPrincipal (which would 403 every hosted_mode org, claimed or
 *    not).
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, mockList, mockRevoke } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockList: vi.fn(async (): Promise<unknown[]> => []),
  mockRevoke: vi.fn(async () => ({ revoked: true })),
}));
vi.mock('@/lib/repositories/invites.repository', () => ({
  createInvite: mockCreate,
  listPendingInvites: mockList,
  revokeInvite: mockRevoke,
}));
const { mockGetTeam } = vi.hoisted(() => ({
  mockGetTeam: vi.fn(async (): Promise<{ org: Record<string, unknown>; members: Record<string, unknown>[] }> => ({
    org: { id: 'org_a', name: 'A', slug: 'a', plan: 'free', hosted_mode: false },
    members: [{ id: 'usr_admin', email: 'a@b.co', role: 'admin' }],
  })),
}));
vi.mock('@/lib/repositories/orgsTeam.repository', () => ({
  getTeamOrgAndMembers: mockGetTeam,
}));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

const { GET, POST, DELETE } = await import('../../app/api/team/invites/route');

function req(method: string, { userId = 'usr_admin', role = 'admin', body }: { userId?: string; role?: string; body?: unknown } = {}) {
  return new Request('http://localhost:3000/api/team/invites', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_a',
      'x-org-role': role,
      'x-user-id': userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ created: true, invite: { id: 'inv_1', email: 'a@b.co', role: 'member', expiresAt: '2099-01-01' } });
  mockList.mockResolvedValue([]);
  mockRevoke.mockResolvedValue({ revoked: true });
});

describe('principal gate', () => {
  it.each([
    ['agent key', 'key_abc', 'admin'],
    ['trial cookie', 'trial:org_a', 'admin'],
    ['operator sentinel', 'operator', 'admin'],
    ['member human', 'usr_member', 'member'],
  ])('%s is refused on every method', async (_label, userId, role) => {
    expect((await GET(req('GET', { userId, role }))).status).toBe(403);
    expect((await POST(req('POST', { userId, role, body: { email: 'a@b.co' } }))).status).toBe(403);
    expect((await DELETE(req('DELETE', { userId, role, body: { invite_id: 'inv_1' } }))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('lists the org’s members (seats) and pending invites together', async () => {
    mockList.mockResolvedValue([{ id: 'inv_1', email: 'a@b.co', role: 'member', createdAt: 'x', expiresAt: 'y', expired: false }]);
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toHaveLength(1);
    expect(body.members).toHaveLength(1);
    expect(body.org).toMatchObject({ id: 'org_a' });
    expect(mockList).toHaveBeenCalledWith(expect.anything(), 'org_a');
    expect(mockGetTeam).toHaveBeenCalledWith(expect.anything(), 'org_a');
  });
});

describe('POST', () => {
  it('records an invite for the org with the caller attributed', async () => {
    const res = await POST(req('POST', { body: { email: 'Casey@Example.com', role: 'member' } }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_a', email: 'Casey@Example.com', role: 'member', createdByUserId: 'usr_admin',
    });
  });

  it('defaults the role to member', async () => {
    await POST(req('POST', { body: { email: 'a@b.co' } }));
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: 'member' }));
  });

  it.each([
    ['invalid_email', 400],
    ['invalid_role', 400],
    ['already_member', 409],
    ['already_invited', 409],
  ])('maps %s to %i', async (reason, status) => {
    mockCreate.mockResolvedValue({ created: false, reason });
    const res = await POST(req('POST', { body: { email: 'a@b.co' } }));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(reason);
  });

  it('400 on unparseable body', async () => {
    const res = await POST(new Request('http://localhost:3000/api/team/invites', {
      method: 'POST',
      headers: { 'x-org-id': 'org_a', 'x-org-role': 'admin', 'x-user-id': 'usr_admin' },
      body: 'not json',
    }));
    expect(res.status).toBe(400);
  });

  describe('seat cap (hosted paid tier)', () => {
    it('blocks the invite once a hosted indie org is at its 2-seat cap', async () => {
      mockGetTeam.mockResolvedValue({
        org: { id: 'org_a', name: 'A', slug: 'a', plan: 'indie', hosted_mode: true },
        members: [{ id: 'usr_admin' }, { id: 'usr_member' }],
      });
      mockList.mockResolvedValue([]);
      const res = await POST(req('POST', { body: { email: 'new@example.com' } }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('SEAT_CAP_REACHED');
      expect(body.code).toBe('SEAT_CAP_REACHED');
      expect(body.seat_cap).toBe(2);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('counts pending invites toward the cap, not just members', async () => {
      mockGetTeam.mockResolvedValue({
        org: { id: 'org_a', name: 'A', slug: 'a', plan: 'indie', hosted_mode: true },
        members: [{ id: 'usr_admin' }],
      });
      mockList.mockResolvedValue([{ id: 'inv_1', email: 'x@y.co', role: 'member', createdAt: 'a', expiresAt: 'b', expired: false }]);
      const res = await POST(req('POST', { body: { email: 'new@example.com' } }));
      expect(res.status).toBe(409);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('allows up to 10 seats for a hosted team org before blocking', async () => {
      mockGetTeam.mockResolvedValue({
        org: { id: 'org_a', name: 'A', slug: 'a', plan: 'team', hosted_mode: true },
        members: Array.from({ length: 9 }, (_, i) => ({ id: `usr_${i}` })),
      });
      mockList.mockResolvedValue([]);
      const res = await POST(req('POST', { body: { email: 'new@example.com' } }));
      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalled();
    });

    it('blocks the 11th seat for a hosted team org already at 10', async () => {
      mockGetTeam.mockResolvedValue({
        org: { id: 'org_a', name: 'A', slug: 'a', plan: 'team', hosted_mode: true },
        members: Array.from({ length: 10 }, (_, i) => ({ id: `usr_${i}` })),
      });
      mockList.mockResolvedValue([]);
      const res = await POST(req('POST', { body: { email: 'new@example.com' } }));
      expect(res.status).toBe(409);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('self-host (hosted_mode false) never blocks, even far over the free seat cap', async () => {
      mockGetTeam.mockResolvedValue({
        org: { id: 'org_a', name: 'A', slug: 'a', plan: 'free', hosted_mode: false },
        members: Array.from({ length: 20 }, (_, i) => ({ id: `usr_${i}` })),
      });
      mockList.mockResolvedValue([]);
      const res = await POST(req('POST', { body: { email: 'new@example.com' } }));
      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalled();
    });

    it('a downgrade with existing members over the new cap blocks only new invites (existing members untouched)', async () => {
      // Org downgraded team (10 seats) -> indie (2 seats) with 6 pre-existing
      // members. Nothing here removes them; the cap only blocks the NEXT invite.
      mockGetTeam.mockResolvedValue({
        org: { id: 'org_a', name: 'A', slug: 'a', plan: 'indie', hosted_mode: true },
        members: Array.from({ length: 6 }, (_, i) => ({ id: `usr_${i}` })),
      });
      mockList.mockResolvedValue([]);
      const res = await POST(req('POST', { body: { email: 'new@example.com' } }));
      expect(res.status).toBe(409);
      expect(mockGetTeam).toHaveBeenCalled(); // members were read, never mutated
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});

describe('DELETE', () => {
  it('revokes a pending invite by id', async () => {
    const res = await DELETE(req('DELETE', { body: { invite_id: 'inv_1' } }));
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith(expect.anything(), { orgId: 'org_a', inviteId: 'inv_1' });
  });

  it('404 when nothing was revoked; 400 without an id', async () => {
    mockRevoke.mockResolvedValue({ revoked: false });
    expect((await DELETE(req('DELETE', { body: { invite_id: 'inv_x' } }))).status).toBe(404);
    expect((await DELETE(req('DELETE', { body: {} }))).status).toBe(400);
  });
});

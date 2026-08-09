/**
 * v5.13 seats: the signIn callback consults email-matched invites BEFORE
 * minting a personal org — an invited teammate's first sign-in lands them in
 * the inviting org with the invited role, and the invite is stamped
 * accepted. Two adjacent contracts ride along:
 *  - hosted founder bootstrap is OFF (a stranger's first Google sign-in on
 *    hosted.dashclaw.io must never become admin of the uncapped org_default);
 *  - the jwt callback honors trigger === 'update' so a just-claimed user's
 *    session reflects the new org immediately instead of after the 5-minute
 *    refresh window.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/authConfig.mjs', () => ({
  getAuthConfig: () => ({ hasGitHub: true, hasGoogle: true, hasOIDC: false }),
}));

const { applyHostedTrial, markTrialFull, countActiveTrials } = vi.hoisted(() => ({
  applyHostedTrial: vi.fn(async () => ({ expiresAt: '2026-09-09T00:00:00.000Z' })),
  markTrialFull: vi.fn(async () => undefined),
  countActiveTrials: vi.fn(async () => 0),
}));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({
  applyHostedTrial,
  markTrialFull,
  countActiveTrials,
}));

const { findPendingInviteByEmail, acceptInvite } = vi.hoisted(() => ({
  findPendingInviteByEmail: vi.fn(async () => null),
  acceptInvite: vi.fn(async () => ({ accepted: true, orgId: 'org_team', role: 'member' })),
}));
vi.mock('@/lib/repositories/invites.repository.js', () => ({
  findPendingInviteByEmail,
  acceptInvite,
}));

const { authOptions } = await import('@/lib/auth.js');
const signIn = authOptions.callbacks.signIn;
const jwt = authOptions.callbacks.jwt;

const originalEnv = { ...process.env };

function sqlTexts() {
  return mockSql.mock.calls.map((c) => (Array.isArray(c[0]) ? c[0].join(' ') : String(c[0])));
}

const newUser = { name: 'Casey', email: 'casey@example.com', image: null };
const account = { provider: 'google', providerAccountId: 'g-123' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.DATABASE_URL = 'postgres://test';
  mockSql.mockResolvedValue([]);
  findPendingInviteByEmail.mockResolvedValue(null);
  acceptInvite.mockResolvedValue({ accepted: true, orgId: 'org_team', role: 'member' });
  applyHostedTrial.mockResolvedValue({ expiresAt: '2026-09-09T00:00:00.000Z' });
  countActiveTrials.mockResolvedValue(0);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('invite-matched join on first sign-in', () => {
  it('a pending invite routes the new user into the inviting org with the invited role, and the invite is accepted', async () => {
    findPendingInviteByEmail.mockResolvedValue({ id: 'inv_1', orgId: 'org_team', role: 'member' });
    // existing-user SELECT → [] (new user); user INSERT → []
    const ok = await signIn({ user: newUser, account });
    expect(ok).toBe(true);

    expect(findPendingInviteByEmail).toHaveBeenCalledWith(mockSql, 'casey@example.com');
    const texts = sqlTexts();
    // no org row is minted for an invited user
    expect(texts.some((t) => t.includes('INSERT INTO organizations'))).toBe(false);
    // the users INSERT binds to the inviting org with the invited role
    const userInsert = mockSql.mock.calls.find((c) => (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO users'));
    expect(userInsert).toBeTruthy();
    expect(userInsert.slice(1)).toEqual(expect.arrayContaining(['org_team', 'member']));
    expect(acceptInvite).toHaveBeenCalledWith(mockSql, expect.objectContaining({ inviteId: 'inv_1' }));
    // invited users never get a hosted trial stamp — the org is already real
    expect(applyHostedTrial).not.toHaveBeenCalled();
  });

  it('an admin-role invite grants admin', async () => {
    findPendingInviteByEmail.mockResolvedValue({ id: 'inv_2', orgId: 'org_team', role: 'admin' });
    await signIn({ user: newUser, account });
    const userInsert = mockSql.mock.calls.find((c) => (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO users'));
    expect(userInsert.slice(1)).toEqual(expect.arrayContaining(['org_team', 'admin']));
  });

  it('no invite → the personal-org path runs exactly as before', async () => {
    mockSql.mockImplementation(async (strings) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('COUNT(*)')) return [{ count: 3 }]; // org_default already populated
      return [];
    });
    await signIn({ user: newUser, account });
    expect(sqlTexts().some((t) => t.includes('INSERT INTO organizations'))).toBe(true);
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('a returning user with a pending invite is NOT moved — invites bind at first sign-in only', async () => {
    findPendingInviteByEmail.mockResolvedValue({ id: 'inv_1', orgId: 'org_team', role: 'member' });
    mockSql.mockImplementation(async (strings) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('SELECT id, org_id, role FROM users')) {
        return [{ id: 'usr_existing', org_id: 'org_mine', role: 'admin' }];
      }
      return [];
    });
    await signIn({ user: newUser, account });
    expect(acceptInvite).not.toHaveBeenCalled();
    expect(sqlTexts().some((t) => t.includes('INSERT INTO users'))).toBe(false);
  });
});

describe('hosted founder bootstrap is disabled', () => {
  it('on hosted, the first-ever user still gets a personal trial org, never org_default admin', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    mockSql.mockImplementation(async (strings) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('COUNT(*)')) return [{ count: 0 }]; // org_default is EMPTY
      return [];
    });
    await signIn({ user: newUser, account });
    const texts = sqlTexts();
    expect(texts.some((t) => t.includes('INSERT INTO organizations'))).toBe(true);
    const userInsert = mockSql.mock.calls.find((c) => (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO users'));
    expect(userInsert.slice(1)).not.toContain('org_default');
    expect(applyHostedTrial).toHaveBeenCalled();
  });

  it('off hosted, the founder bootstrap still promotes the first user into org_default', async () => {
    mockSql.mockImplementation(async (strings) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (text.includes('COUNT(*)')) return [{ count: 0 }];
      return [];
    });
    await signIn({ user: newUser, account });
    const userInsert = mockSql.mock.calls.find((c) => (Array.isArray(c[0]) ? c[0].join(' ') : '').includes('INSERT INTO users'));
    expect(userInsert.slice(1)).toContain('org_default');
  });
});

describe('jwt trigger update (claim freshness)', () => {
  it("trigger === 'update' re-queries the org immediately, ignoring the 5-minute window", async () => {
    mockSql.mockResolvedValue([{ org_id: 'org_claimed', role: 'admin', plan: 'free' }]);
    const token = { userId: 'usr_1', orgId: 'org_old', role: 'admin', plan: 'free', orgRefreshedAt: Date.now() };
    const out = await jwt({ token, account: null, trigger: 'update' });
    expect(out.orgId).toBe('org_claimed');
  });

  it('without a trigger, a fresh token is not re-queried', async () => {
    const token = { userId: 'usr_1', orgId: 'org_old', role: 'admin', plan: 'free', orgRefreshedAt: Date.now() };
    const out = await jwt({ token, account: null });
    expect(out.orgId).toBe('org_old');
    expect(mockSql).not.toHaveBeenCalled();
  });
});

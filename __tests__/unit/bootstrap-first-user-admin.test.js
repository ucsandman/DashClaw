/**
 * Regression tests for BUG-03: first user of a fresh DashClaw instance must
 * be auto-promoted to role='admin' by the NextAuth signIn callback.
 *
 * Fix lives in: app/lib/auth.js signIn callback (Phase 1.5 Plan 01.5-02 T2)
 *
 * These tests verify:
 *   1. First user (users table count = 0) → INSERT with role='admin'
 *   2. Subsequent user (users table count > 0) → INSERT with role='member'
 *   3. Existing user re-login → UPDATE branch, no COUNT+INSERT calls
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/authConfig.mjs', () => ({
  getAuthConfig: () => ({ hasGitHub: true, hasGoogle: false, hasOIDC: false }),
}));
// v5.13: the signIn callback consults email-matched invites before any org
// mint. Mocked to "no invite" here so the scripted sql sequences (and call
// counts) still describe exactly the bootstrap paths under test — the invite
// path has its own suite (auth-invite-join.test.js).
vi.mock('@/lib/repositories/invites.repository.js', () => ({
  findPendingInviteByEmail: vi.fn(async () => null),
  acceptInvite: vi.fn(async () => ({ accepted: false })),
}));

// NOTE: must be after the mocks so getSql resolves to our spy
const { authOptions } = await import('@/lib/auth.js');

const signIn = authOptions.callbacks.signIn;

// Helper: return the first INSERT call's arguments from mockSql.mock.calls.
// sql template literal mock captures calls as [stringsArray, ...values] — the
// strings array contains the raw SQL text in chunks, so we can match on
// "INSERT INTO users" to find the relevant call.
function findInsertCall() {
  const calls = mockSql.mock.calls;
  for (const call of calls) {
    const strings = call[0];
    if (!Array.isArray(strings)) continue;
    const sqlText = strings.join(' ');
    if (sqlText.includes('INSERT INTO users')) {
      // Values start at index 1. Matching the template literal order from
      // app/lib/auth.js INSERT: [userId, org_id, email, name, image, provider,
      // providerAccountId, role, now, now]. So org_id is values index 1 (call[2])
      // and role is values index 7, which is overall index 8 (0 = strings array).
      return { strings, values: call.slice(1), role: call[8] };
    }
  }
  return null;
}

describe('BUG-03: bootstrap first-user-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('promotes the first user of a fresh instance to admin', async () => {
    // Scripted responses for each sql`...` call in the signIn callback:
    //   1. SELECT existing user by provider → empty (new user)
    //   2. SELECT COUNT(*) FROM users → 0 (fresh instance)
    //   3. INSERT INTO users → no-op (return empty)
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([]);

    const result = await signIn({
      user: { email: 'founder@example.com', name: 'Founder', image: null },
      account: { provider: 'github', providerAccountId: 'gh_12345' },
    });

    expect(result).toBe(true);
    expect(mockSql).toHaveBeenCalledTimes(3);

    const insertCall = findInsertCall();
    expect(insertCall).not.toBeNull();
    expect(insertCall.role).toBe('admin');
  });

  it('isolates subsequent users in their own workspace, not shared org_default', async () => {
    // SECURITY (team-invite lockdown): a non-first OAuth user must NOT be
    // dropped into the shared org_default. They get their own isolated org and
    // are admin of it; joining a real workspace requires an email-matched invite.
    // Scripted responses:
    //   1. SELECT existing user by provider → empty (new user)
    //   2. SELECT COUNT(*) FROM users → 5 (instance already has users)
    //   3. INSERT INTO organizations → no-op (their personal workspace)
    //   4. INSERT INTO users → no-op
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await signIn({
      user: { email: 'second@example.com', name: 'Second', image: null },
      account: { provider: 'github', providerAccountId: 'gh_67890' },
    });

    expect(result).toBe(true);
    expect(mockSql).toHaveBeenCalledTimes(4);

    // A personal organization was created for them.
    const orgInsert = mockSql.mock.calls.find(
      (c) => Array.isArray(c[0]) && c[0].join(' ').includes('INSERT INTO organizations'),
    );
    expect(orgInsert).toBeTruthy();

    // The user row is admin of their OWN org — not a member of org_default.
    const insertCall = findInsertCall();
    expect(insertCall).not.toBeNull();
    expect(insertCall.role).toBe('admin');
    expect(insertCall.values[1]).not.toBe('org_default'); // org_id is the 2nd template value
  });

  it('does not change role for existing users on re-login (UPDATE branch)', async () => {
    // Scripted responses:
    //   1. SELECT existing user → returns existing record
    //   2. UPDATE users → no-op
    // No COUNT call, no INSERT call
    mockSql
      .mockResolvedValueOnce([
        { id: 'usr_existing', org_id: 'org_default', role: 'member' },
      ])
      .mockResolvedValueOnce([]);

    const result = await signIn({
      user: { email: 'existing@example.com', name: 'Existing', image: null },
      account: { provider: 'github', providerAccountId: 'gh_99999' },
    });

    expect(result).toBe(true);
    // Only 2 calls: the SELECT existing lookup + the UPDATE. No COUNT, no INSERT.
    expect(mockSql).toHaveBeenCalledTimes(2);

    const insertCall = findInsertCall();
    expect(insertCall).toBeNull();
  });

  it('handles count=null gracefully (treat as first user)', async () => {
    // Edge case: if the count query returns null or undefined somehow, the
    // optional chaining in the fix (`countResult[0]?.count || 0`) must treat
    // it as 0 (first user). This prevents a crash on malformed DB state.
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]) // count field missing
      .mockResolvedValueOnce([]);

    await signIn({
      user: { email: 'edge@example.com', name: 'Edge', image: null },
      account: { provider: 'github', providerAccountId: 'gh_edge' },
    });

    const insertCall = findInsertCall();
    expect(insertCall.role).toBe('admin');
  });
});

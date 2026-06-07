/**
 * Task 4 (Instant Hosted Trial): when the NextAuth signIn callback creates a
 * NEW personal org for a non-founder OAuth user AND isHostedMode() is true,
 * the org is stamped as a trial (under the global cap) or marked inert/full
 * (at the cap). Returning users and the founder (org_default) path are never
 * trialed.
 *
 * Code under test: app/lib/auth.ts signIn callback (the `if (!isFirstUser)` block).
 *
 * Mock strategy: we vi.mock the hosted-workspace repository so the three trial
 * helpers (applyHostedTrial, markTrialFull, countActiveTrials) become spies.
 * The sql template-literal mock only has to drive the callback down the
 * new-personal-org branch (existing-user SELECT → [] ; first-user COUNT →
 * non-zero). Because the helpers are mocked they never touch sql, so the call
 * counts stay deterministic and the assertions check the REAL behavior the
 * callback chose (which helper it invoked, with which org id + config) rather
 * than re-asserting SQL text. countActiveTrials is given a scripted return so
 * the under-cap vs at-cap branch is exercised for real.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/authConfig.mjs', () => ({
  getAuthConfig: () => ({ hasGitHub: true, hasGoogle: true, hasOIDC: false }),
}));

// Spy on the three trial helpers. countActiveTrials is overridden per-test.
const { applyHostedTrial, markTrialFull, countActiveTrials } = vi.hoisted(() => ({
  applyHostedTrial: vi.fn(async () => ({ expiresAt: '2026-07-07T00:00:00.000Z' })),
  markTrialFull: vi.fn(async () => undefined),
  countActiveTrials: vi.fn(async () => 0),
}));

vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({
  applyHostedTrial,
  markTrialFull,
  countActiveTrials,
}));

// Must import after the mocks so getSql + the repo helpers resolve to our spies.
const { authOptions } = await import('@/lib/auth.js');
const signIn = authOptions.callbacks.signIn;

const originalEnv = { ...process.env };

describe('Task 4: hosted trial stamping on new personal-org sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgres://test'; // signIn returns true early without this
    // Default the helpers (clearAllMocks wipes implementations set in hoisted).
    applyHostedTrial.mockResolvedValue({ expiresAt: '2026-07-07T00:00:00.000Z' });
    markTrialFull.mockResolvedValue(undefined);
    countActiveTrials.mockResolvedValue(0);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('hosted + new user + under cap → applyHostedTrial once with new org id + config; markTrialFull not called', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    // Defaults: HOSTED_TRIAL_DAYS=30, HOSTED_TRIAL_ACTION_CAP=10000, maxActiveTrials=500
    countActiveTrials.mockResolvedValue(3); // well under the 500 default cap

    // sql sequence for the new-personal-org branch (helpers are mocked, no sql):
    //   1. SELECT existing user → [] (new user)
    //   2. SELECT COUNT(*) → non-zero (NOT first user → personal-org branch)
    //   3. INSERT INTO organizations → []
    //   4. INSERT INTO users → []
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await signIn({
      user: { email: 'newbie@example.com', name: 'Newbie', image: null },
      account: { provider: 'google', providerAccountId: 'g_under_cap' },
    });

    expect(result).toBe(true);
    expect(applyHostedTrial).toHaveBeenCalledTimes(1);
    expect(applyHostedTrial).toHaveBeenCalledWith(
      mockSql,
      expect.stringMatching(/^org_/),
      { trialDays: 30, trialActionCap: 10000 },
    );
    expect(markTrialFull).not.toHaveBeenCalled();

    // The org id passed to applyHostedTrial is the same fresh org the callback
    // just created (not org_default) — proves we trialed the new personal org.
    const trialedOrgId = applyHostedTrial.mock.calls[0][1];
    expect(trialedOrgId).not.toBe('org_default');
  });

  it('hosted + new user + at cap → markTrialFull with new org id; applyHostedTrial not called', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.HOSTED_MAX_ACTIVE_TRIALS = '1'; // parsePositiveInt rejects 0, so use 1
    countActiveTrials.mockResolvedValue(1); // active (1) >= cap (1) → full

    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await signIn({
      user: { email: 'atcap@example.com', name: 'AtCap', image: null },
      account: { provider: 'google', providerAccountId: 'g_at_cap' },
    });

    expect(result).toBe(true);
    expect(markTrialFull).toHaveBeenCalledTimes(1);
    expect(markTrialFull).toHaveBeenCalledWith(mockSql, expect.stringMatching(/^org_/));
    expect(applyHostedTrial).not.toHaveBeenCalled();

    const fullOrgId = markTrialFull.mock.calls[0][1];
    expect(fullOrgId).not.toBe('org_default');
  });

  it('hosted + returning user → neither helper called (idempotent, no second trial)', async () => {
    process.env.DASHCLAW_HOSTED = 'true';

    // Existing-user SELECT returns a row → UPDATE branch, no org creation.
    mockSql
      .mockResolvedValueOnce([{ id: 'usr_existing', org_id: 'org_abc', role: 'admin' }])
      .mockResolvedValueOnce([]); // UPDATE users

    const result = await signIn({
      user: { email: 'returning@example.com', name: 'Returning', image: null },
      account: { provider: 'google', providerAccountId: 'g_returning' },
    });

    expect(result).toBe(true);
    expect(applyHostedTrial).not.toHaveBeenCalled();
    expect(markTrialFull).not.toHaveBeenCalled();
    expect(countActiveTrials).not.toHaveBeenCalled();
  });

  it('not hosted + new user → neither helper called', async () => {
    delete process.env.DASHCLAW_HOSTED; // isHostedMode() → false

    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await signIn({
      user: { email: 'plain@example.com', name: 'Plain', image: null },
      account: { provider: 'google', providerAccountId: 'g_plain' },
    });

    expect(result).toBe(true);
    expect(applyHostedTrial).not.toHaveBeenCalled();
    expect(markTrialFull).not.toHaveBeenCalled();
    expect(countActiveTrials).not.toHaveBeenCalled();
  });

  it('founder (first user, org_default) is never trialed even in hosted mode', async () => {
    process.env.DASHCLAW_HOSTED = 'true';

    // COUNT → 0 → isFirstUser true → org_default path, no personal org, no trial.
    mockSql
      .mockResolvedValueOnce([]) // existing SELECT → new user
      .mockResolvedValueOnce([{ count: 0 }]) // first user
      .mockResolvedValueOnce([]); // INSERT INTO users (no org INSERT for founder)

    const result = await signIn({
      user: { email: 'founder@example.com', name: 'Founder', image: null },
      account: { provider: 'google', providerAccountId: 'g_founder' },
    });

    expect(result).toBe(true);
    expect(applyHostedTrial).not.toHaveBeenCalled();
    expect(markTrialFull).not.toHaveBeenCalled();
    expect(countActiveTrials).not.toHaveBeenCalled();
  });
});

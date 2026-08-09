/**
 * app/lib/repositories/claim.repository.ts — claim-your-workspace (G2 product
 * half): atomic claim (single conditional UPDATE, loser of a race gets a
 * truthful reason), user rebind to the claimed org as admin, and the
 * emptiness-guarded discard of the personal org the sign-in callback minted
 * on the way in. Spec: docs/decisions/2026-08-09-hosted-paid-tier.md
 * ("Accounts before billing").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqlTag } from '../../app/lib/types/db';

const { deleteHostedWorkspace } = vi.hoisted(() => ({
  deleteHostedWorkspace: vi.fn(async () => ({ deleted: true })),
}));
vi.mock('../../app/lib/repositories/hosted-workspace.repository', () => ({
  deleteHostedWorkspace,
}));

const {
  getClaimableWorkspace,
  claimTrialWorkspace,
  discardAbandonedPersonalOrg,
  canLeaveBehindOrg,
  bindUserAsAdmin,
} = await import('../../app/lib/repositories/claim.repository');

type Call = { text: string; values: unknown[] };

function makeSqlMock(responses: unknown[][]) {
  const queue = [...responses];
  const calls: Call[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    calls.push({ text, values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: Call[] };
  (fn as unknown as { calls: Call[] }).calls = calls;
  return fn;
}

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────── getClaimableWorkspace ─────

describe('getClaimableWorkspace', () => {
  it('reports a live unclaimed hosted trial as claimable', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const sql = makeSqlMock([[{
      id: 'org_t', name: 'Trial workspace', hosted_mode: true,
      claimed_at: null, trial_ends_at: future, trial_actions_used: 3,
    }]]);
    const result = await getClaimableWorkspace(sql, 'org_t');
    expect(result).toMatchObject({ claimable: true, orgId: 'org_t', actionsUsed: 3 });
  });

  it('reports not_found / already_claimed / expired / not_trial truthfully', async () => {
    expect(await getClaimableWorkspace(makeSqlMock([[]]), 'org_x'))
      .toMatchObject({ claimable: false, reason: 'not_found' });
    expect(await getClaimableWorkspace(makeSqlMock([[{ id: 'o', hosted_mode: true, claimed_at: '2026-08-01', claimed_by_user_id: 'usr_owner', trial_ends_at: null }]]), 'o'))
      .toMatchObject({ claimable: false, reason: 'already_claimed', claimedByUserId: 'usr_owner' });
    expect(await getClaimableWorkspace(makeSqlMock([[{ id: 'o', hosted_mode: true, claimed_at: null, trial_ends_at: '2020-01-01T00:00:00.000Z' }]]), 'o'))
      .toMatchObject({ claimable: false, reason: 'expired' });
    expect(await getClaimableWorkspace(makeSqlMock([[{ id: 'o', hosted_mode: false, claimed_at: null, trial_ends_at: null }]]), 'o'))
      .toMatchObject({ claimable: false, reason: 'not_trial' });
  });
});

// ─────────────────────────────────────────────────── claimTrialWorkspace ───

describe('claimTrialWorkspace', () => {
  it('claims atomically: conditional UPDATE clears expiry, stamps owner, renames, then rebinds the user as admin', async () => {
    const sql = makeSqlMock([
      [{ org_id: 'org_old' }],            // user's current org lookup
      [{ id: 'org_t' }],                  // conditional claim UPDATE ... RETURNING
      [{ id: 'usr_1' }],                  // user rebind UPDATE ... RETURNING
    ]);
    const result = await claimTrialWorkspace(sql, {
      orgId: 'org_t', userId: 'usr_1', orgName: "Wes's workspace",
    });
    expect(result).toEqual({ claimed: true, previousOrgId: 'org_old' });

    const claimSql = sql.calls[1]!.text;
    expect(claimSql).toContain('SET claimed_at = NOW()');
    expect(claimSql).toContain('trial_ends_at = NULL');
    expect(claimSql).toContain('claimed_by_user_id =');
    expect(claimSql).toContain('name =');
    expect(claimSql).toContain('WHERE id =');
    expect(claimSql).toContain('hosted_mode = TRUE');
    expect(claimSql).toContain('claimed_at IS NULL');
    expect(claimSql).toContain('trial_ends_at >');

    const rebindSql = sql.calls[2]!.text;
    expect(rebindSql).toContain('UPDATE users');
    expect(rebindSql).toContain("role = 'admin'");
    expect(sql.calls[2]!.values).toContain('org_t');
  });

  it('loses the race truthfully: zero rows from the conditional UPDATE → not claimed, user untouched', async () => {
    const sql = makeSqlMock([
      [{ org_id: 'org_old' }],
      [],                                  // someone else claimed first
    ]);
    const result = await claimTrialWorkspace(sql, { orgId: 'org_t', userId: 'usr_1', orgName: 'W' });
    expect(result).toEqual({ claimed: false, reason: 'not_claimable' });
    expect(sql.calls.length).toBe(2); // no user rebind attempted
  });

  it('unknown user → not claimed, org untouched', async () => {
    const sql = makeSqlMock([[]]); // user lookup returns nothing
    const result = await claimTrialWorkspace(sql, { orgId: 'org_t', userId: 'usr_ghost', orgName: 'W' });
    expect(result).toEqual({ claimed: false, reason: 'user_not_found' });
    expect(sql.calls.length).toBe(1);
  });
});

// ─────────────────────────────────────────── discardAbandonedPersonalOrg ───

describe('discardAbandonedPersonalOrg', () => {
  const emptinessRow = (over: Record<string, unknown> = {}) => [{
    hosted_mode: true, claimed_at: null,
    user_count: 0, used_key_count: 0, decision_count: 0, action_count: 0,
    ...over,
  }];

  it('discards only a provably-empty unclaimed hosted org', async () => {
    const sql = makeSqlMock([emptinessRow()]);
    const result = await discardAbandonedPersonalOrg(sql, 'org_old');
    expect(result).toEqual({ discarded: true });
    expect(deleteHostedWorkspace).toHaveBeenCalledWith(sql, 'org_old');
  });

  it.each([
    ['a user still bound', { user_count: 1 }],
    ['a key that was used', { used_key_count: 1 }],
    ['guard decisions', { decision_count: 2 }],
    ['recorded actions', { action_count: 1 }],
    ['a claimed org', { claimed_at: '2026-08-09T00:00:00Z' }],
    ['a non-hosted org', { hosted_mode: false }],
  ])('refuses when the org has %s', async (_label, over) => {
    const sql = makeSqlMock([emptinessRow(over)]);
    const result = await discardAbandonedPersonalOrg(sql, 'org_old');
    expect(result).toEqual({ discarded: false, reason: 'not_empty' });
    expect(deleteHostedWorkspace).not.toHaveBeenCalled();
  });

  it('missing org → nothing to discard, delete never called', async () => {
    const sql = makeSqlMock([[]]);
    const result = await discardAbandonedPersonalOrg(sql, 'org_gone');
    expect(result).toEqual({ discarded: false, reason: 'not_found' });
    expect(deleteHostedWorkspace).not.toHaveBeenCalled();
  });

  it('never throws when the delete fails — the expiry sweep is the backstop', async () => {
    deleteHostedWorkspace.mockRejectedValueOnce(new Error('fk storm'));
    const sql = makeSqlMock([emptinessRow()]);
    const result = await discardAbandonedPersonalOrg(sql, 'org_old');
    expect(result).toEqual({ discarded: false, reason: 'delete_failed' });
  });
});

// ─────────────────────────────────────────────────── canLeaveBehindOrg ─────

describe('canLeaveBehindOrg', () => {
  const row = (over: Record<string, unknown> = {}) => [{
    hosted_mode: true, claimed_at: null,
    other_user_count: 0, used_key_count: 0, decision_count: 0, action_count: 0,
    ...over,
  }];

  it('an empty auto-minted personal org can be left behind', async () => {
    const sql = makeSqlMock([row()]);
    expect(await canLeaveBehindOrg(sql, { orgId: 'org_p', userId: 'usr_1' })).toBe(true);
    // the user themself must not count against emptiness
    expect(sql.calls[0]!.text).toContain('u.id <>');
  });

  it.each([
    ['another member', { other_user_count: 1 }],
    ['a used key', { used_key_count: 1 }],
    ['governed activity', { decision_count: 1 }],
    ['recorded actions', { action_count: 3 }],
    ['a claim stamp', { claimed_at: '2026-08-09T00:00:00Z' }],
    ['a non-hosted org', { hosted_mode: false }],
  ])('an org with %s must not be abandoned', async (_label, over) => {
    const sql = makeSqlMock([row(over)]);
    expect(await canLeaveBehindOrg(sql, { orgId: 'org_p', userId: 'usr_1' })).toBe(false);
  });

  it('a missing org cannot be left behind', async () => {
    expect(await canLeaveBehindOrg(makeSqlMock([[]]), { orgId: 'org_x', userId: 'usr_1' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────── bindUserAsAdmin ───

describe('bindUserAsAdmin (claim crash recovery)', () => {
  it('rebinds the user into the org as admin', async () => {
    const sql = makeSqlMock([[{ id: 'usr_1' }]]);
    expect(await bindUserAsAdmin(sql, { userId: 'usr_1', orgId: 'org_t' })).toBe(true);
    const { text, values } = sql.calls[0]!;
    expect(text).toContain('UPDATE users');
    expect(text).toContain("role = 'admin'");
    expect(values).toEqual(expect.arrayContaining(['usr_1', 'org_t']));
  });

  it('unknown user → false', async () => {
    expect(await bindUserAsAdmin(makeSqlMock([[]]), { userId: 'usr_x', orgId: 'org_t' })).toBe(false);
  });
});

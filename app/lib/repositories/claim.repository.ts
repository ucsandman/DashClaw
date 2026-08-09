import { deleteHostedWorkspace } from './hosted-workspace.repository';
import type { SqlTag } from '../types/db';

/**
 * Claim-your-workspace (G2 product half, v5.13).
 * docs/decisions/2026-08-09-hosted-paid-tier.md: "Accounts before billing" —
 * an anonymous hosted trial binds to an authenticated owner without losing
 * its decisions history. The claim clears trial_ends_at (the expiry sweep
 * keys on it, so a claimed org can never be collected) and stamps
 * claimed_at, which middleware's resolveTrialOrg treats as the end of
 * anonymous trial-cookie access to the org. The action cap deliberately
 * stays: entitlement ceilings replace it in the week-5 tier work, and until
 * then a claimed free org must not become the only uncapped tenant.
 */

export type ClaimableWorkspace =
  | { claimable: true; orgId: string; name: string; actionsUsed: number }
  | { claimable: false; reason: 'already_claimed'; claimedByUserId: string | null }
  | { claimable: false; reason: 'not_found' | 'expired' | 'not_trial' };

export async function getClaimableWorkspace(sql: SqlTag, orgId: string): Promise<ClaimableWorkspace> {
  const rows = await sql`
    SELECT id, name, hosted_mode, claimed_at, claimed_by_user_id, trial_ends_at, trial_actions_used
    FROM organizations
    WHERE id = ${orgId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { claimable: false, reason: 'not_found' };
  if (row.claimed_at) {
    // claimedByUserId lets the route finish a claim that crashed between the
    // org stamp and the user rebind: the same user re-running is recovery,
    // anyone else is a hard already_claimed.
    return {
      claimable: false,
      reason: 'already_claimed',
      claimedByUserId: row.claimed_by_user_id ? String(row.claimed_by_user_id) : null,
    };
  }
  if (!row.hosted_mode) return { claimable: false, reason: 'not_trial' };
  if (!row.trial_ends_at || new Date(String(row.trial_ends_at)).getTime() < Date.now()) {
    return { claimable: false, reason: 'expired' };
  }
  return {
    claimable: true,
    orgId: String(row.id),
    name: String(row.name ?? ''),
    actionsUsed: Number(row.trial_actions_used) || 0,
  };
}

export type ClaimResult =
  | { claimed: true; previousOrgId: string }
  | { claimed: false; reason: 'user_not_found' | 'not_claimable' };

/**
 * The claim itself. Two conditional statements, no transaction (house
 * pattern; the neon http driver has no tx tag):
 *   1. one atomic UPDATE that only succeeds on a live, unclaimed hosted
 *      trial — the loser of a concurrent claim race matches zero rows and
 *      the user rebind never runs;
 *   2. rebind the user into the claimed org as admin.
 * If the process dies between the two, the org is claimed by a user still
 * parked in their personal org — re-running the claim route resolves it via
 * the already_claimed + claimed_by check, so the state is recoverable.
 */
export async function claimTrialWorkspace(
  sql: SqlTag,
  { orgId, userId, orgName }: { orgId: string; userId: string; orgName: string },
): Promise<ClaimResult> {
  const userRows = await sql`
    SELECT org_id FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (userRows.length === 0) return { claimed: false, reason: 'user_not_found' };
  const previousOrgId = String(userRows[0]?.org_id ?? '');

  const nowIso = new Date().toISOString();
  const claimedRows = await sql`
    UPDATE organizations
    SET claimed_at = NOW(),
        claimed_by_user_id = ${userId},
        trial_ends_at = NULL,
        name = ${orgName},
        updated_at = NOW()
    WHERE id = ${orgId}
      AND hosted_mode = TRUE
      AND claimed_at IS NULL
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at > ${nowIso}
    RETURNING id
  `;
  if (claimedRows.length === 0) return { claimed: false, reason: 'not_claimable' };

  await sql`
    UPDATE users
    SET org_id = ${orgId}, role = 'admin', last_login_at = NOW()
    WHERE id = ${userId}
    RETURNING id
  `;
  return { claimed: true, previousOrgId };
}

/**
 * May this user abandon their current org to claim another? True only when
 * the org is a provably-empty, unclaimed hosted workspace (the one the
 * signIn callback auto-minted on the way to /claim) with no members besides
 * the user. org_default and self-host orgs are never hosted_mode, so they
 * always refuse — claiming never strands real history.
 */
export async function canLeaveBehindOrg(
  sql: SqlTag,
  { orgId, userId }: { orgId: string; userId: string },
): Promise<boolean> {
  const rows = await sql`
    SELECT
      o.hosted_mode,
      o.claimed_at,
      (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id AND u.id <> ${userId}) AS other_user_count,
      (SELECT COUNT(*)::int FROM api_keys k WHERE k.org_id = o.id AND k.last_used_at IS NOT NULL) AS used_key_count,
      (SELECT COUNT(*)::int FROM guard_decisions gd WHERE gd.org_id = o.id) AS decision_count,
      (SELECT COUNT(*)::int FROM action_records ar WHERE ar.org_id = o.id) AS action_count
    FROM organizations o
    WHERE o.id = ${orgId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return false;
  return (
    row.hosted_mode === true &&
    !row.claimed_at &&
    Number(row.other_user_count) === 0 &&
    Number(row.used_key_count) === 0 &&
    Number(row.decision_count) === 0 &&
    Number(row.action_count) === 0
  );
}

/** Name + email for the claim route's org-naming ("<owner>'s workspace"). */
export async function getUserDisplay(
  sql: SqlTag,
  userId: string,
): Promise<{ name: string | null; email: string | null } | null> {
  const rows = await sql`
    SELECT name, email FROM users WHERE id = ${userId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.name ? String(row.name) : null,
    email: row.email ? String(row.email) : null,
  };
}

/** Claim crash recovery: re-run the user rebind for the org's claimer. */
export async function bindUserAsAdmin(
  sql: SqlTag,
  { userId, orgId }: { userId: string; orgId: string },
): Promise<boolean> {
  const rows = await sql`
    UPDATE users
    SET org_id = ${orgId}, role = 'admin', last_login_at = NOW()
    WHERE id = ${userId}
    RETURNING id
  `;
  return rows.length > 0;
}

export type DiscardResult =
  | { discarded: true }
  | { discarded: false; reason: 'not_found' | 'not_empty' | 'delete_failed' };

/**
 * Discard the personal org the signIn callback auto-minted moments before a
 * claim. Every guard is positive evidence of emptiness — any user still
 * bound, any key ever used, any governed activity, a claim stamp, or a
 * non-hosted org refuses the discard. Refusal is never an error: the org
 * still carries trial_ends_at, so the expiry sweep collects it later.
 */
export async function discardAbandonedPersonalOrg(sql: SqlTag, orgId: string): Promise<DiscardResult> {
  const rows = await sql`
    SELECT
      o.hosted_mode,
      o.claimed_at,
      (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) AS user_count,
      (SELECT COUNT(*)::int FROM api_keys k WHERE k.org_id = o.id AND k.last_used_at IS NOT NULL) AS used_key_count,
      (SELECT COUNT(*)::int FROM guard_decisions gd WHERE gd.org_id = o.id) AS decision_count,
      (SELECT COUNT(*)::int FROM action_records ar WHERE ar.org_id = o.id) AS action_count
    FROM organizations o
    WHERE o.id = ${orgId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { discarded: false, reason: 'not_found' };
  const empty =
    row.hosted_mode === true &&
    !row.claimed_at &&
    Number(row.user_count) === 0 &&
    Number(row.used_key_count) === 0 &&
    Number(row.decision_count) === 0 &&
    Number(row.action_count) === 0;
  if (!empty) return { discarded: false, reason: 'not_empty' };

  try {
    await deleteHostedWorkspace(sql, orgId);
    return { discarded: true };
  } catch (err) {
    console.error(`[CLAIM] discard of abandoned org ${orgId} failed (sweep will collect it):`, (err as Error).message);
    return { discarded: false, reason: 'delete_failed' };
  }
}

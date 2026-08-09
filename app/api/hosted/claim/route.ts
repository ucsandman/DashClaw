export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../lib/hosted/flag';
import { resolveTrialSession, TRIAL_SESSION_COOKIE } from '../../../lib/sessionViewer.mjs';
import {
  getClaimableWorkspace,
  claimTrialWorkspace,
  discardAbandonedPersonalOrg,
  canLeaveBehindOrg,
  bindUserAsAdmin,
  getUserDisplay,
} from '../../../lib/repositories/claim.repository';
import { getSql } from '../../../lib/db';

/**
 * Claim-your-workspace (G2 product half, v5.13).
 *
 * The same browser holds two credentials: the anonymous trial cookie (which
 * org to claim) and a NextAuth session (who is claiming — middleware has
 * already verified it and stamped x-user-id/x-org-id). The signIn callback
 * cannot see cookies, so it auto-mints a personal org on the way in; the
 * POST here rebinds the user into the trial org and discards that empty
 * personal org. GET is the preview the /claim page renders from.
 */

function humanUserId(request: Request): string | null {
  const userId = request.headers.get('x-user-id') || '';
  // Only NextAuth humans claim. Trial principals are `trial:<org>`, API-key
  // principals are `key_<uuid>`, the self-host bootstrap key is `operator`.
  return userId.startsWith('usr_') ? userId : null;
}

async function trialOrgFromCookie(request: Request): Promise<string | null> {
  const session = (await resolveTrialSession(request.headers.get('cookie') || '', process.env)) as
    | { orgId?: string }
    | null;
  return session?.orgId ? String(session.orgId) : null;
}

function clearTrialCookie(response: NextResponse): NextResponse {
  response.cookies.set(TRIAL_SESSION_COOKIE, '', { path: '/', expires: new Date(0) });
  return response;
}

export async function GET(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const trialOrgId = await trialOrgFromCookie(request);
  if (!trialOrgId) {
    // A preview, not an error: every signed-in dashboard page probes this
    // (ClaimWorkspaceBanner), and most browsers hold no trial cookie. A 400
    // here would put red noise in every user's console for normal state.
    return NextResponse.json({ claimable: false, reason: 'no_trial_session', signed_in: humanUserId(request) !== null });
  }

  const sql = getSql();
  const claimable = await getClaimableWorkspace(sql, trialOrgId);
  const userId = humanUserId(request);
  const currentOrgId = request.headers.get('x-org-id') || '';

  let movable: boolean | null = null;
  if (userId && currentOrgId && currentOrgId !== trialOrgId) {
    movable = await canLeaveBehindOrg(sql, { orgId: currentOrgId, userId });
  }

  if (!claimable.claimable) {
    const alreadyMine =
      claimable.reason === 'already_claimed' && userId !== null && claimable.claimedByUserId === userId;
    return NextResponse.json({
      claimable: false,
      reason: claimable.reason,
      already_yours: alreadyMine,
      signed_in: userId !== null,
      current_workspace_movable: movable,
    });
  }

  return NextResponse.json({
    claimable: true,
    signed_in: userId !== null,
    current_workspace_movable: movable,
    workspace: {
      org_id: claimable.orgId,
      name: claimable.name,
      actions_used: claimable.actionsUsed,
    },
  });
}

export async function POST(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const trialOrgId = await trialOrgFromCookie(request);
  if (!trialOrgId) {
    return NextResponse.json({ error: 'no_trial_session' }, { status: 400 });
  }
  const userId = humanUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  }

  const sql = getSql();
  const claimable = await getClaimableWorkspace(sql, trialOrgId);

  // Crash recovery: the org was stamped for this user but the rebind never
  // ran (process died between the two statements). Finish it; claiming
  // again is idempotent for the claimer and a hard 409 for anyone else.
  if (!claimable.claimable) {
    if (claimable.reason === 'already_claimed' && claimable.claimedByUserId === userId) {
      await bindUserAsAdmin(sql, { userId, orgId: trialOrgId });
      const response = NextResponse.json({ claimed: true, recovered: true, org_id: trialOrgId });
      return clearTrialCookie(response);
    }
    return NextResponse.json({ error: claimable.reason }, { status: 409 });
  }

  const currentOrgId = request.headers.get('x-org-id') || '';
  if (currentOrgId && currentOrgId !== trialOrgId) {
    const movable = await canLeaveBehindOrg(sql, { orgId: currentOrgId, userId });
    if (!movable) {
      return NextResponse.json({ error: 'current_workspace_not_empty' }, { status: 409 });
    }
  }

  const u = await getUserDisplay(sql, userId);
  const ownerLabel = u?.name || (u?.email ? u.email.split('@')[0] : '') || 'My';
  const orgName = `${ownerLabel}'s workspace`;

  const result = await claimTrialWorkspace(sql, { orgId: trialOrgId, userId, orgName });
  if (!result.claimed) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  // The abandoned personal org: best-effort discard behind hard emptiness
  // guards; a refusal is fine (it still carries trial_ends_at, so the
  // expiry sweep collects it).
  if (result.previousOrgId && result.previousOrgId !== trialOrgId) {
    await discardAbandonedPersonalOrg(sql, result.previousOrgId);
  }

  const response = NextResponse.json({ claimed: true, org_id: trialOrgId });
  return clearTrialCookie(response);
}

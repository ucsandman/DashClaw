export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import {
  createInvite,
  listPendingInvites,
  revokeInvite,
} from '../../../lib/repositories/invites.repository';
import { getTeamOrgAndMembers } from '../../../lib/repositories/orgsTeam.repository';
import { getSql } from '../../../lib/db';
import { seatCapReached, entitlementsForPlan } from '../../../lib/entitlements';

/**
 * Seat management (v5.13): email-matched invites. Human org admins only —
 * the principal must be a NextAuth user (usr_), not an agent key, the
 * operator sentinel, or an anonymous trial cookie. Deliberately NOT
 * denyTrialPrincipal: that helper refuses every hosted_mode org, and a
 * claimed org (hosted_mode + claimed_at) is exactly who manages seats here.
 */
function requireHumanAdmin(request: Request): NextResponse | null {
  const userId = request.headers.get('x-user-id') || '';
  const role = request.headers.get('x-org-role') || '';
  if (!userId.startsWith('usr_') || role !== 'admin') {
    return NextResponse.json(
      { error: 'Invite management requires a signed-in org admin' },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const denied = requireHumanAdmin(request);
  if (denied) return denied;
  const sql = getSql();
  const orgId = getOrgId(request);
  // Members ARE the seats — one endpoint answers the whole /team page.
  const [{ org, members }, invites] = await Promise.all([
    getTeamOrgAndMembers(sql, orgId),
    listPendingInvites(sql, orgId),
  ]);
  return NextResponse.json({ org, members, invites });
}

export async function POST(request: Request) {
  const denied = requireHumanAdmin(request);
  if (denied) return denied;

  let body: { email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sql = getSql();
  const orgId = getOrgId(request);

  // Seat cap (hosted paid tier, G4): only hosted orgs are gated — self-host
  // is free and complete forever, and a downgrade never removes an existing
  // member, it only blocks the NEXT invite once at/over cap.
  const [{ org, members }, pendingInvites] = await Promise.all([
    getTeamOrgAndMembers(sql, orgId),
    listPendingInvites(sql, orgId),
  ]);
  const plan = (org?.plan as string | null | undefined) ?? null;
  if (org?.hosted_mode && seatCapReached(plan, members.length, pendingInvites.length)) {
    return NextResponse.json(
      {
        error: 'SEAT_CAP_REACHED',
        code: 'SEAT_CAP_REACHED',
        seat_cap: entitlementsForPlan(plan).seatCap,
        upgrade_hint: 'Upgrade your plan to invite more teammates.',
      },
      { status: 409 },
    );
  }

  const result = await createInvite(sql, {
    orgId,
    email: typeof body.email === 'string' ? body.email : '',
    role: typeof body.role === 'string' ? body.role : 'member',
    createdByUserId: request.headers.get('x-user-id') || '',
  });

  if (!result.created) {
    const status = result.reason === 'already_member' || result.reason === 'already_invited' ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ invite: result.invite }, { status: 201 });
}

export async function DELETE(request: Request) {
  const denied = requireHumanAdmin(request);
  if (denied) return denied;

  let body: { invite_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const inviteId = typeof body.invite_id === 'string' ? body.invite_id : '';
  if (!inviteId) {
    return NextResponse.json({ error: 'invite_id required' }, { status: 400 });
  }

  const result = await revokeInvite(getSql(), { orgId: getOrgId(request), inviteId });
  if (!result.revoked) {
    return NextResponse.json({ error: 'Invite not found or already accepted' }, { status: 404 });
  }
  return NextResponse.json({ revoked: true });
}

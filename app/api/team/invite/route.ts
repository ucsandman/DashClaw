export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { checkQuotaFast, getOrgPlan } from '../../../lib/usage';
import { logActivity } from '../../../lib/audit';
import { getSql } from '../../../lib/db';
import {
  ensureInvitesTable,
  createInvite,
  listPendingInvites,
  revokeInvite,
  VALID_ROLES
} from '../../../lib/repositories/invites.repository';

function requireAdmin(request: Request) {
  const orgId = getOrgId(request);
  const role = getOrgRole(request);
  const userId = getUserId(request);
  if (orgId === 'org_default') {
    return { error: NextResponse.json({ error: 'Complete onboarding first', needsOnboarding: true }, { status: 403 }) };
  }
  if (role !== 'admin') {
    return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) };
  }
  return { orgId, userId };
}

// POST /api/team/invite - Create invite link (admin only)
export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth.error) return auth.error;
    const { orgId, userId } = auth;

    const body = await request.json();
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const role = body.role && VALID_ROLES.includes(body.role) ? body.role : 'member';

    const sql = getSql();
    await ensureInvitesTable(sql);

    // Quota check: members (fast meter path)
    const plan = await getOrgPlan(orgId, sql);
    const membersQuota = await checkQuotaFast(orgId, 'members', plan, sql);
    if (!membersQuota.allowed) {
      return NextResponse.json(
        { error: 'Team member limit reached. Upgrade your plan.', code: 'QUOTA_EXCEEDED', usage: membersQuota.usage, limit: membersQuota.limit },
        { status: 402 }
      );
    }

    const invite = await createInvite(sql, { orgId, email: email ?? undefined, role, invitedBy: userId });

    // SECURITY: Use NEXTAUTH_URL as canonical origin to prevent header injection phishing.
    // Falls back to request URL origin only as a last resort.
    const origin = process.env.NEXTAUTH_URL
      ? new URL(process.env.NEXTAUTH_URL).origin
      : new URL(request.url).origin;
    const inviteUrl = `${origin}/invite/${invite.token}`;

    logActivity({
      orgId, actorId: userId, action: 'invite.created',
      resourceType: 'invite', resourceId: invite.id,
      details: { email, role }, request,
    }, sql);

    return NextResponse.json({
      invite: {
        ...invite,
        invite_url: inviteUrl,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Team invite POST error:', error);
    const status = (error as Error).message.includes('Invalid') ? 400 : 500;
    return NextResponse.json({ error: (error as Error).message || 'Failed to create invite' }, { status });
  }
}

// GET /api/team/invite - List pending invites (admin only)
export async function GET(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth.error) return auth.error;
    const { orgId } = auth;

    const sql = getSql();
    await ensureInvitesTable(sql);

    const invites = await listPendingInvites(sql, orgId);

    return NextResponse.json({ invites });
  } catch (error) {
    console.error('Team invite GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 });
  }
}

// DELETE /api/team/invite?id=inv_xxx - Revoke invite (admin only)
export async function DELETE(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth.error) return auth.error;
    const { orgId } = auth;

    const { searchParams } = new URL(request.url);
    const inviteId = searchParams.get('id');

    const sql = getSql();
    await ensureInvitesTable(sql);

    const result = await revokeInvite(sql, inviteId as string, orgId);

    logActivity({
      orgId, actorId: auth.userId, action: 'invite.revoked',
      resourceType: 'invite', resourceId: inviteId as string, request,
    }, sql);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Team invite DELETE error:', error);
    let status = 500;
    if ((error as Error).message.includes('not found')) status = 404;
    else if ((error as Error).message.includes('not pending')) status = 409;
    else if ((error as Error).message.includes('required')) status = 400;
    return NextResponse.json({ error: (error as Error).message || 'Failed to revoke invite' }, { status });
  }
}

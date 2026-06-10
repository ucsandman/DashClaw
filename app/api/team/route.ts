export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getUserId } from '../../lib/org';
import { getSql } from '../../lib/db';
import { getTeamOrgAndMembers } from '../../lib/repositories/orgsTeam.repository';
import { isSelfHostModeEnabled } from '../../lib/selfHost';

// GET /api/team - List members + org info for caller's org
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);

    const sql = getSql();

    const { org, members } = await getTeamOrgAndMembers(sql, orgId);
    if (!org) {
      // Self-host bypass: org_default may not exist yet if migrations haven't completed.
      if (isSelfHostModeEnabled()) {
        return NextResponse.json({ org: { id: orgId, name: 'Default Organization', plan: 'free' }, members: [], member_count: 0 });
      }
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const userId = getUserId(request);

    return NextResponse.json({
      org,
      members: members.map((m: any) => ({
        ...m,
        is_self: m.id === userId,
      })),
      member_count: members.length,
    });
  } catch (error) {
    console.error('Team API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
  }
}

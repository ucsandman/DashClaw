export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getProfile, updateProfile, deleteProfile } from '../../../../lib/scoringProfiles';

export async function GET(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { profileId } = await params;

    const profile = await getProfile(sql, orgId, profileId);
    if (!profile) return Response.json({ error: 'Profile not found' }, { status: 404 });

    return Response.json(profile);
  } catch (err) {
    console.error('[scoring/profiles/:id] GET error:', (err as Error).message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { profileId } = await params;
    const body = await request.json();

    const updated = await updateProfile(sql, orgId, profileId, body);
    if (!updated) return Response.json({ error: 'Profile not found' }, { status: 404 });

    return Response.json(updated);
  } catch (err) {
    console.error('[scoring/profiles/:id] PATCH error:', (err as Error).message);
    return Response.json({ error: (err as Error).message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { profileId } = await params;

    const deleted = await deleteProfile(sql, orgId, profileId);
    if (!deleted) return Response.json({ error: 'Profile not found' }, { status: 404 });

    return Response.json({ deleted: true });
  } catch (err) {
    console.error('[scoring/profiles/:id] DELETE error:', (err as Error).message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

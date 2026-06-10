export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { createProfile, listProfiles } from '../../../lib/scoringProfiles';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const url = new URL(request.url);
    const action_type = url.searchParams.get('action_type');
    const status = url.searchParams.get('status') || 'active';
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const profiles = await listProfiles(sql, orgId, { action_type: action_type ?? undefined, status, limit, offset });
    return Response.json({ profiles });
  } catch (err) {
    console.error('[scoring/profiles] GET error:', (err as Error).message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const profile = await createProfile(sql, orgId, body);

    // If dimensions are provided inline, add them
    if (Array.isArray(body.dimensions) && body.dimensions.length > 0) {
      const { addDimension } = await import('../../../lib/scoringProfiles');
      const dims = [];
      for (let i = 0; i < body.dimensions.length; i++) {
        // createProfile always returns a profile with a generated id (Profile.id is
        // optional only on the input shape); assert non-null for addDimension's string param.
        const dim = await addDimension(sql, orgId, profile.id!, {
          ...body.dimensions[i],
          sort_order: body.dimensions[i].sort_order ?? i,
        });
        dims.push(dim);
      }
      (profile as Record<string, any>).dimensions = dims;
    }

    return Response.json(profile, { status: 201 });
  } catch (err) {
    console.error('[scoring/profiles] POST error:', (err as Error).message);
    return Response.json({ error: (err as Error).message || 'Internal server error' }, { status: 500 });
  }
}

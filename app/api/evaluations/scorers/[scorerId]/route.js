export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId, getOrgRole } from '../../../../lib/org.js';

export async function PATCH(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const { scorerId } = params;

    if (role !== 'admin' && role !== 'owner') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.config !== undefined) updates.config = typeof body.config === 'string' ? body.config : JSON.stringify(body.config);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const setClauses = Object.entries(updates).map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`).join(', ');

    await sql.query(`UPDATE eval_scorers SET ${setClauses} WHERE id = '${scorerId}' AND org_id = '${orgId}'`);

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('Scorer PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update scorer' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const { scorerId } = params;

    if (role !== 'admin' && role !== 'owner') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await sql`DELETE FROM eval_scorers WHERE id = ${scorerId} AND org_id = ${orgId}`;

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Scorer DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete scorer' }, { status: 500 });
  }
}

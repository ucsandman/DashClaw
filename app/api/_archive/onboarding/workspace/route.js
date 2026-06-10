export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../../../lib/db';
import crypto from 'crypto';

let _sql;
function getSql() {
  if (_sql) return _sql;
  _sql = getDbSql();
  return _sql;
}

// POST /api/onboarding/workspace — create workspace for current user
export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (name.length > 256) {
      return NextResponse.json({ error: 'name must be 256 characters or fewer' }, { status: 400 });
    }

    const sql = getSql();

    // Verify user exists and is still on org_default
    const users = await sql`
      SELECT id, org_id FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (users.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (users[0].org_id !== 'org_default') {
      return NextResponse.json({ error: 'Workspace already created' }, { status: 409 });
    }

    // Auto-generate slug from name
    const slug = name.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 64);

    if (!slug) {
      return NextResponse.json({ error: 'name must contain at least one alphanumeric character' }, { status: 400 });
    }

    const orgId = `org_${crypto.randomUUID()}`;

    // Create the organization
    await sql`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES (${orgId}, ${name.trim()}, ${slug}, 'free')
    `;

    // Update user to new org as admin
    await sql`
      UPDATE users SET org_id = ${orgId}, role = 'admin' WHERE id = ${userId} AND org_id = 'org_default'
    `;

    return NextResponse.json({
      org: { id: orgId, name: name.trim(), slug },
    }, { status: 201 });
  } catch (error) {
    console.error('Onboarding workspace error:', error);
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return NextResponse.json({ error: 'A workspace with this name already exists. Try a different name.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }
}

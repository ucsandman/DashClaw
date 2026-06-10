export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/org';
import { incrementMeter } from '../../../../lib/usage';
import { logActivity } from '../../../../lib/audit';
import { getSql } from '../../../../lib/db';

// GET /api/invite/[token] - Get invite details (public-ish — for the accept page)
export async function GET(request, { params }) {
  try {
    const { token } = await params;
    if (!token || token.length !== 64) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 });
    }

    const sql = getSql();
    const rows = await sql`
      SELECT
        i.id, i.email, i.role, i.status, i.expires_at, i.created_at,
        o.name as org_name
      FROM invites i
      JOIN organizations o ON o.id = i.org_id
      WHERE i.token = ${token}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    const invite = rows[0];
    const expired = new Date(invite.expires_at) < new Date();

    return NextResponse.json({
      invite: {
        id: invite.id,
        org_name: invite.org_name,
        role: invite.role,
        email: invite.email,
        status: expired && invite.status === 'pending' ? 'expired' : invite.status,
        expires_at: invite.expires_at,
      },
    });
  } catch (error) {
    console.error('Invite GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch invite' }, { status: 500 });
  }
}

// POST /api/invite/[token] - Accept invite (requires authenticated user)
export async function POST(request, { params }) {
  try {
    const { token } = await params;
    if (!token || token.length !== 64) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 });
    }

    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const sql = getSql();

    // Get invite details
    const inviteRows = await sql`
      SELECT id, org_id, email, role, status, expires_at
      FROM invites
      WHERE token = ${token}
      LIMIT 1
    `;

    if (inviteRows.length === 0) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    const invite = inviteRows[0];

    // Validate invite status
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: `Invite has already been ${invite.status}` },
        { status: 409 }
      );
    }
    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invite has expired' }, { status: 410 });
    }

    // Get current user
    const userRows = await sql`
      SELECT id, email, org_id FROM users WHERE id = ${userId}
    `;
    if (userRows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = userRows[0];

    // Email restriction check
    if (invite.email && user.email.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'This invite is restricted to a specific email address' },
        { status: 403 }
      );
    }

    // Already in the target org?
    if (user.org_id === invite.org_id) {
      return NextResponse.json(
        { error: 'You are already a member of this workspace' },
        { status: 409 }
      );
    }

    // User on another org (not org_default)?
    if (user.org_id !== 'org_default') {
      return NextResponse.json(
        { error: 'You are already in another workspace. Leave your current workspace first.' },
        { status: 409 }
      );
    }

    // Accept: atomically update invite (race-safe via WHERE status='pending')
    const updated = await sql`
      UPDATE invites
      SET status = 'accepted', accepted_by = ${userId}
      WHERE token = ${token} AND status = 'pending'
      RETURNING id
    `;

    if (updated.length === 0) {
      // Another user accepted first
      return NextResponse.json({ error: 'Invite is no longer available' }, { status: 409 });
    }

    // Move user to the org with the invited role
    await sql`
      UPDATE users
      SET org_id = ${invite.org_id}, role = ${invite.role}
      WHERE id = ${userId}
    `;

    // Fire-and-forget meter increment
    incrementMeter(invite.org_id, 'members', sql).catch((err) => {
      console.warn('[Invite] Failed to increment members meter:', err.message);
    });

    logActivity({
      orgId: invite.org_id, actorId: userId, action: 'invite.accepted',
      resourceType: 'invite', resourceId: invite.id,
      details: { role: invite.role }, request,
    }, sql);

    return NextResponse.json({
      success: true,
      org_id: invite.org_id,
      role: invite.role,
    });
  } catch (error) {
    console.error('Invite POST error:', error);
    return NextResponse.json({ error: 'Failed to accept invite' }, { status: 500 });
  }
}

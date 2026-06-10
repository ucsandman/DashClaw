export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getUserId } from '../../../lib/org';
import { parseJsonWithSchema, notificationPreferenceUpsertSchema } from '../../../lib/contracts/index';
import { getSql } from '../../../lib/db';
import crypto from 'crypto';

// GET /api/notifications - Get current user's preferences
export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const sql = getSql();
    const rows = await sql`
      SELECT id, channel, enabled, signal_types, created_at, updated_at
      FROM notification_preferences
      WHERE org_id = ${orgId} AND user_id = ${userId}
      ORDER BY channel
    `;

    return NextResponse.json({ preferences: rows });
  } catch (error) {
    console.error('Notifications GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch notification preferences' }, { status: 500 });
  }
}

// POST /api/notifications - Upsert preferences
export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const sql = getSql();
    const parsed = await parseJsonWithSchema(request, notificationPreferenceUpsertSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { channel, enabled, signal_types } = parsed.data;

    const now = new Date().toISOString();
    const prefId = `np_${crypto.randomUUID()}`;
    const enabledInt = enabled ? 1 : 0;
    const typesStr = JSON.stringify(signal_types);

    await sql`
      INSERT INTO notification_preferences (id, org_id, user_id, channel, enabled, signal_types, created_at, updated_at)
      VALUES (${prefId}, ${orgId}, ${userId}, ${channel}, ${enabledInt}, ${typesStr}, ${now}, ${now})
      ON CONFLICT (org_id, user_id, channel) DO UPDATE SET
        enabled = ${enabledInt},
        signal_types = ${typesStr},
        updated_at = ${now}
    `;

    return NextResponse.json({ success: true, channel, enabled, signal_types });
  } catch (error) {
    console.error('Notifications POST error:', error);
    return NextResponse.json({ error: 'Failed to update notification preferences' }, { status: 500 });
  }
}

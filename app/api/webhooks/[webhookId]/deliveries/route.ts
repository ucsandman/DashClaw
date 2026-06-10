export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';

// GET /api/webhooks/[webhookId]/deliveries - Recent deliveries
export async function GET(request: Request, { params }: { params: Promise<{ webhookId: string }> }) {
  try {
    const orgId = getOrgId(request);
    const { webhookId } = await params;

    if (!webhookId || !webhookId.startsWith('wh_')) {
      return NextResponse.json({ error: 'Valid webhook id is required' }, { status: 400 });
    }

    const sql = getSql();

    // Verify webhook belongs to this org
    const whRows = await sql`
      SELECT id FROM webhooks WHERE id = ${webhookId} AND org_id = ${orgId}
    `;
    if (whRows.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const deliveries = await sql`
      SELECT id, event_type, status, response_status, attempted_at, duration_ms
      FROM webhook_deliveries
      WHERE webhook_id = ${webhookId} AND org_id = ${orgId}
      ORDER BY attempted_at DESC
      LIMIT 20
    `;

    return NextResponse.json({ deliveries });
  } catch (error) {
    console.error('Webhook deliveries GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 });
  }
}

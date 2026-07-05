export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';
import { findWebhookById, listWebhookDeliveries } from '../../../../lib/repositories/webhooks.repository';

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
    const whRows = await findWebhookById(sql, webhookId, orgId);
    if (whRows.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    // payload + response_body are redacted at write time (redactForStorage in
    // app/lib/webhooks.ts logWebhookDelivery), so exposing them read-only is
    // safe and lets users debug deliveries without external tooling.
    const deliveries = await listWebhookDeliveries(sql, webhookId, orgId);

    return NextResponse.json({ deliveries });
  } catch (error) {
    console.error('Webhook deliveries GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 });
  }
}

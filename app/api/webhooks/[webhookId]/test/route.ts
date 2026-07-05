export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { deliverWebhook } from '../../../../lib/webhooks';
import { logActivity } from '../../../../lib/audit';
import { getSql } from '../../../../lib/db';
import { findWebhookForDelivery } from '../../../../lib/repositories/webhooks.repository';

// POST /api/webhooks/[webhookId]/test - Send test payload (admin only)
export async function POST(request: Request, { params }: { params: Promise<{ webhookId: string }> }) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { webhookId } = await params;
    if (!webhookId || !webhookId.startsWith('wh_')) {
      return NextResponse.json({ error: 'Valid webhook id is required' }, { status: 400 });
    }

    const sql = getSql();
    const userId = getUserId(request);

    const rows = await findWebhookForDelivery(sql, webhookId, orgId);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const wh = rows[0];
    if (!wh) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }
    const testPayload = {
      event: 'test',
      org_id: orgId,
      timestamp: new Date().toISOString(),
      signals: [{
        type: 'test',
        severity: 'amber',
        label: 'Test signal from DashClaw',
        detail: 'This is a test webhook delivery to verify your endpoint is receiving events correctly.',
        help: 'No action required — this is a test.',
      }],
    };

    const result = await deliverWebhook({
      webhookId: wh.id as string,
      orgId,
      url: wh.url as string,
      secret: wh.secret as string,
      eventType: 'test',
      payload: testPayload,
      sql,
    });

    logActivity({
      orgId, actorId: userId, action: 'webhook.tested',
      resourceType: 'webhook', resourceId: webhookId,
      details: { success: result.success, status: result.status }, request,
    }, sql);

    return NextResponse.json({
      success: result.success,
      response_status: result.status,
    });
  } catch (error) {
    console.error('Webhook test POST error:', error);
    return NextResponse.json({ error: 'Failed to test webhook' }, { status: 500 });
  }
}

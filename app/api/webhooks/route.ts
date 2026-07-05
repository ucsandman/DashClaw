import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { logActivity } from '../../lib/audit';
import { isValidWebhookUrl } from '../../lib/validate.js';
import {
  listWebhooksByOrg,
  insertWebhook,
  findWebhookById,
  deleteWebhook,
} from '../../lib/repositories/webhooks.repository';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VALID_EVENT_TYPES = [
  'all', 'autonomy_spike', 'high_impact_low_oversight', 'repeated_failures',
  'stale_loop', 'assumption_drift', 'stale_assumption', 'stale_running_action',
  'drift_alert',
  'approval_pending', 'approval_granted', 'approval_denied'
];

// GET /api/webhooks - List webhooks for org (all members)
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();

    const webhooks = await listWebhooksByOrg(sql, orgId);

    // Mask secrets: reveal 4 chars (6th-through-3rd from the end), keeping the
    // final 2 hidden so the full suffix is never exposed.
    const masked = webhooks.map((wh: any) => ({
      ...wh,
      secret: wh.secret ? `${'•'.repeat(28)}${wh.secret.slice(-6, -2)}` : null,
    }));

    return NextResponse.json({ webhooks: masked });
  } catch (error) {
    console.error('Webhooks GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 });
  }
}

// POST /api/webhooks - Create webhook (admin only)
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const sql = getSql();
    const userId = getUserId(request);
    const body = await request.json();
    const { url, events = ['all'] } = body;

    // Validate URL
    const urlErr = isValidWebhookUrl(url);
    if (urlErr) {
      return NextResponse.json({ error: urlErr }, { status: 400 });
    }

    // Validate events
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'Events must be a non-empty array' }, { status: 400 });
    }
    for (const evt of events) {
      if (!VALID_EVENT_TYPES.includes(evt)) {
        return NextResponse.json({ error: `Invalid event type: ${evt}` }, { status: 400 });
      }
    }

    const webhookId = `wh_${crypto.randomUUID()}`;
    const secret = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();

    await insertWebhook(sql, { webhookId, orgId, url, secret, events, userId, now });

    logActivity({
      orgId, actorId: userId, action: 'webhook.created',
      resourceType: 'webhook', resourceId: webhookId,
      details: { url, events }, request,
    }, sql);

    return NextResponse.json({
      webhook: { id: webhookId, url, secret, events, active: 1, created_at: now },
      storageWarning: 'Store this secret now — it will not be shown again.',
    }, { status: 201 });
  } catch (error) {
    console.error('Webhooks POST error:', error);
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
  }
}
// DELETE /api/webhooks?id=wh_xxx - Delete webhook (admin only)
export async function DELETE(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const webhookId = searchParams.get('id');
    if (!webhookId || !webhookId.startsWith('wh_')) {
      return NextResponse.json({ error: 'Valid webhook id is required' }, { status: 400 });
    }

    const sql = getSql();
    const userId = getUserId(request);

    const existing = await findWebhookById(sql, webhookId, orgId);
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    await deleteWebhook(sql, webhookId, orgId);

    logActivity({
      orgId, actorId: userId, action: 'webhook.deleted',
      resourceType: 'webhook', resourceId: webhookId, request,
    }, sql);

    return NextResponse.json({ success: true, deleted: webhookId });
  } catch (error) {
    console.error('Webhooks DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}



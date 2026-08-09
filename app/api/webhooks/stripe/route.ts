export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getStripe, planForPriceId } from '../../../lib/billing-stripe';
import {
  claimWebhookEvent,
  applyCheckoutCompleted,
  applySubscriptionUpdated,
  applySubscriptionDeleted,
  applyPaymentFailed,
} from '../../../lib/repositories/billing.repository';
import { getSql } from '../../../lib/db';

/**
 * Stripe webhook (v5.14). Public route — auth is the stripe-signature
 * header verified against STRIPE_WEBHOOK_SECRET over the RAW body (the
 * Telegram-webhook pattern: self-verifying, registered in PUBLIC_ROUTES).
 * Every event id is claimed exactly once through the stripe_webhook_events
 * ledger before its handler runs, so Stripe retries and operator replays
 * acknowledge without re-applying. Handlers acknowledge with 200 even when
 * the referenced org/subscription is unknown — Stripe retries are for
 * transport failures, not data we have chosen not to store.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: 'Billing not configured', code: 'BILLING_NOT_CONFIGURED' }, { status: 501 });
  }

  const signature = request.headers.get('stripe-signature') || '';
  const rawBody = await request.text();

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) as unknown as typeof event;
  } catch (err) {
    console.warn('[StripeWebhook] signature verification failed:', (err as Error).message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const sql = getSql();
  const obj = event.data.object;
  const metadata = (obj.metadata ?? {}) as Record<string, string>;
  const orgId = typeof metadata.org_id === 'string' && metadata.org_id ? metadata.org_id : null;

  const claimed = await claimWebhookEvent(sql, { eventId: event.id, eventType: event.type, orgId });
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const plan = typeof metadata.plan === 'string' ? metadata.plan : '';
      if (orgId && (plan === 'indie' || plan === 'team')) {
        await applyCheckoutCompleted(sql, {
          orgId,
          plan,
          customerId: String(obj.customer ?? ''),
          subscriptionId: String(obj.subscription ?? ''),
        });
      } else {
        console.warn(`[StripeWebhook] checkout.session.completed without usable metadata (org=${orgId}, plan=${plan})`);
      }
      break;
    }
    case 'customer.subscription.updated': {
      const items = obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
      const priceId = items?.data?.[0]?.price?.id ?? null;
      const periodEnd = typeof obj.current_period_end === 'number'
        ? new Date(obj.current_period_end * 1000).toISOString()
        : null;
      await applySubscriptionUpdated(sql, {
        subscriptionId: String(obj.id ?? ''),
        plan: planForPriceId(priceId),
        status: String(obj.status ?? 'active'),
        currentPeriodEnd: periodEnd,
      });
      break;
    }
    case 'customer.subscription.deleted': {
      await applySubscriptionDeleted(sql, { subscriptionId: String(obj.id ?? '') });
      break;
    }
    case 'invoice.payment_failed': {
      await applyPaymentFailed(sql, { customerId: String(obj.customer ?? '') });
      break;
    }
    default:
      break; // acknowledged, no side effects
  }

  return NextResponse.json({ received: true });
}

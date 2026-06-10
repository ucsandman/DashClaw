export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSql } from '../../../lib/db';

const PRICE_TO_PLAN: Record<string, string> = {};

function buildPriceToPlan() {
  if (process.env.STRIPE_PRICE_PRO) PRICE_TO_PLAN[process.env.STRIPE_PRICE_PRO] = 'pro';
  if (process.env.STRIPE_PRICE_BUSINESS) PRICE_TO_PLAN[process.env.STRIPE_PRICE_BUSINESS] = 'business';
}

export async function POST(request: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    let event;
    try {
      event = stripe.webhooks.constructEvent(body, sig as string, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.warn('[Stripe Webhook] Signature verification failed:', (err as Error).message);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    buildPriceToPlan();
    const sql = getSql();

    switch (event.type) {
      case 'checkout.session.completed': {
        // Stripe's `event.data.object` is a broad SDK union; project it to the
        // exact webhook fields used here (real field-level safety, no `any`,
        // and robust to Stripe SDK type drift e.g. current_period_end moves).
        const session = event.data.object as {
          metadata?: Record<string, string | undefined> | null;
          customer?: string | null;
          subscription?: string | null;
        };
        const orgId = session.metadata?.org_id;
        const plan = session.metadata?.plan;
        if (!orgId || !plan) break;

        const customerId = session.customer;
        const subscriptionId = session.subscription;

        await sql`
          UPDATE organizations
          SET plan = ${plan},
              stripe_customer_id = ${customerId},
              stripe_subscription_id = ${subscriptionId},
              subscription_status = 'active'
          WHERE id = ${orgId}
        `;
        console.log(`[Stripe] Org ${orgId} upgraded to ${plan}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as {
          customer?: string | null;
          items?: { data?: Array<{ price?: { id?: string } | null } | undefined> };
          status?: string;
          current_period_end?: number | null;
        };
        const customerId = subscription.customer;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const plan = priceId ? PRICE_TO_PLAN[priceId] || null : null;
        const status = subscription.status;
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;

        if (plan) {
          await sql`
            UPDATE organizations
            SET plan = ${plan}, subscription_status = ${status}, current_period_end = ${periodEnd}
            WHERE stripe_customer_id = ${customerId}
          `;
        } else {
          await sql`
            UPDATE organizations
            SET subscription_status = ${status}, current_period_end = ${periodEnd}
            WHERE stripe_customer_id = ${customerId}
          `;
        }
        console.log(`[Stripe] Subscription updated for customer ${customerId}: ${status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as { customer?: string | null };
        const customerId = subscription.customer;

        await sql`
          UPDATE organizations
          SET plan = 'free', subscription_status = 'canceled', stripe_subscription_id = NULL
          WHERE stripe_customer_id = ${customerId}
        `;
        console.log(`[Stripe] Subscription canceled for customer ${customerId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as { customer?: string | null };
        const customerId = invoice.customer;

        await sql`
          UPDATE organizations SET subscription_status = 'past_due'
          WHERE stripe_customer_id = ${customerId}
        `;
        console.warn(`[Stripe] Payment failed for customer ${customerId}`);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Stripe Webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

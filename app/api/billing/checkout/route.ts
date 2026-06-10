export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';

const PLAN_PRICES: Record<string, string | undefined> = {
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

export async function POST(request: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Billing not configured', code: 'BILLING_NOT_CONFIGURED' },
        { status: 501 },
      );
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();
    const { plan } = body;

    if (!plan || !PLAN_PRICES[plan]) {
      return NextResponse.json(
        { error: 'Invalid plan. Must be "pro" or "business".', code: 'INVALID_PLAN' },
        { status: 400 },
      );
    }

    const priceId = PLAN_PRICES[plan];
    if (!priceId) {
      return NextResponse.json(
        { error: `Stripe price not configured for ${plan} plan`, code: 'PRICE_NOT_CONFIGURED' },
        { status: 501 },
      );
    }

    const orgs = await sql`SELECT stripe_customer_id FROM organizations WHERE id = ${orgId} LIMIT 1`;
    let customerId: string | null = orgs.length > 0 ? (orgs[0]?.stripe_customer_id as string | null ?? null) : null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { org_id: orgId },
      });
      customerId = customer.id;
      await sql`UPDATE organizations SET stripe_customer_id = ${customerId} WHERE id = ${orgId}`;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/settings?billing=success`,
      cancel_url: `${appUrl}/settings?billing=canceled`,
      metadata: { org_id: orgId, plan },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return apiErrorResponse(error, 'BILLING_CHECKOUT');
  }
}

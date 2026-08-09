export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getStripe, priceIdForPlan, appUrl } from '../../../lib/billing-stripe';
import { getOrgBillingState, saveStripeCustomerId } from '../../../lib/repositories/billing.repository';
import { getSql } from '../../../lib/db';

/**
 * Start a subscription Checkout Session for the caller's org (v5.14).
 * Human org admins only, and on hosted the org must be CLAIMED first —
 * docs/decisions/2026-08-09-hosted-paid-tier.md: "you cannot bill an
 * anonymous trial cookie." 501 (not 500) when Stripe is unconfigured, so
 * self-host instances answer honestly instead of erroring.
 */
export async function POST(request: Request) {
  const userId = request.headers.get('x-user-id') || '';
  const role = request.headers.get('x-org-role') || '';
  if (!userId.startsWith('usr_') || role !== 'admin') {
    return NextResponse.json({ error: 'Billing requires a signed-in org admin' }, { status: 403 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'Billing not configured', code: 'BILLING_NOT_CONFIGURED' }, { status: 501 });
  }

  let body: { plan?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const plan = typeof body.plan === 'string' ? body.plan : '';
  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json({ error: 'Unknown plan', code: 'UNKNOWN_PLAN' }, { status: 400 });
  }

  const sql = getSql();
  const orgId = getOrgId(request);
  const state = await getOrgBillingState(sql, orgId);
  if (!state) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  if (state.hostedMode && !state.claimed) {
    return NextResponse.json(
      { error: 'claim_required', message: 'Claim this workspace before subscribing — billing needs a durable owner.' },
      { status: 409 },
    );
  }

  let customerId = state.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { org_id: orgId } });
    customerId = customer.id;
    const won = await saveStripeCustomerId(sql, { orgId, customerId });
    if (!won) {
      // A concurrent checkout created the link first — use the stored one.
      const fresh = await getOrgBillingState(sql, orgId);
      customerId = fresh?.stripeCustomerId ?? customerId;
    }
  }

  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/settings?tab=billing&billing=success`,
    cancel_url: `${base}/settings?tab=billing&billing=canceled`,
    metadata: { org_id: orgId, plan },
  });

  return NextResponse.json({ url: session.url });
}

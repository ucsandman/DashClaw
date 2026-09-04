export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getStripe, appUrl, isStaleCustomerError } from '../../../lib/billing-stripe';
import { getOrgBillingState, clearStripeCustomerId } from '../../../lib/repositories/billing.repository';
import { getSql } from '../../../lib/db';

/** Stripe customer portal for the caller's org (v5.14). Human admins only. */
export async function GET(request: Request) {
  const userId = request.headers.get('x-user-id') || '';
  const role = request.headers.get('x-org-role') || '';
  if (!userId.startsWith('usr_') || role !== 'admin') {
    return NextResponse.json({ error: 'Billing requires a signed-in org admin' }, { status: 403 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'Billing not configured', code: 'BILLING_NOT_CONFIGURED' }, { status: 501 });
  }

  const sql = getSql();
  const orgId = getOrgId(request);
  const state = await getOrgBillingState(sql, orgId);
  if (!state?.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No billing account for this workspace yet', code: 'NO_CUSTOMER' },
      { status: 400 },
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: state.stripeCustomerId,
      return_url: `${appUrl()}/settings?tab=billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (!isStaleCustomerError(err)) throw err;
    // Unlike checkout, minting a fresh customer here is useless — it has no
    // subscription, so the portal would just be empty. Clear the stale link
    // and tell the client to start checkout again.
    console.warn(`[BillingPortal] stale Stripe customer for org ${orgId} (was ${state.stripeCustomerId.slice(0, 8)}...)`);
    await clearStripeCustomerId(sql, { orgId, staleCustomerId: state.stripeCustomerId });
    return NextResponse.json(
      { error: 'No Stripe customer on file for this workspace — start checkout again', code: 'NO_STRIPE_CUSTOMER' },
      { status: 409 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getStripe, appUrl } from '../../../lib/billing-stripe';
import { getOrgBillingState } from '../../../lib/repositories/billing.repository';
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

  const state = await getOrgBillingState(getSql(), getOrgId(request));
  if (!state?.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No billing account for this workspace yet', code: 'NO_CUSTOMER' },
      { status: 400 },
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: state.stripeCustomerId,
    return_url: `${appUrl()}/settings?tab=billing`,
  });
  return NextResponse.json({ url: session.url });
}

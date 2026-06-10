export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';

export async function GET(request: Request) {
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

    const orgs = await sql`SELECT stripe_customer_id FROM organizations WHERE id = ${orgId} LIMIT 1`;
    const customerId = (orgs[0]?.stripe_customer_id as string | null | undefined) ?? null;

    if (!customerId) {
      return NextResponse.json(
        { error: 'No billing account. Subscribe first.', code: 'NO_CUSTOMER' },
        { status: 400 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return apiErrorResponse(error, 'BILLING_PORTAL');
  }
}

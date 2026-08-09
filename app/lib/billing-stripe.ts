import Stripe from 'stripe';

/**
 * Shared Stripe plumbing for the billing routes (v5.14). One place answers
 * "is billing configured", maps tier plans to price ids and back, and
 * builds the client — the routes stay thin and repository-only.
 */

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export function priceIdForPlan(plan: string): string | null {
  if (plan === 'indie') return process.env.STRIPE_PRICE_INDIE || null;
  if (plan === 'team') return process.env.STRIPE_PRICE_TEAM || null;
  return null;
}

/** null = price id not recognized (legacy/foreign price); keep the stored plan. */
export function planForPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_INDIE) return 'indie';
  if (priceId === process.env.STRIPE_PRICE_TEAM) return 'team';
  return null;
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
}

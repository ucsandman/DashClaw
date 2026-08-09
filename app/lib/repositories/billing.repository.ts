import type { SqlTag } from '../types/db';

/**
 * Hosted paid tier checkout (v5.14, docs/decisions/2026-08-09-hosted-paid-tier.md).
 * Every Stripe-driven state transition on organizations lives here, behind
 * the route-SQL ratchet, plus the webhook idempotency claim over
 * stripe_webhook_events (drizzle/0070).
 *
 * Cap semantics: paying clears trial_action_cap — a paying customer must
 * never be throttled at trial levels (real entitlement ceilings are the
 * week-5 tier work). Cancellation restores the free-tier cap on hosted orgs
 * so a lapsed org is not the only uncapped free tenant.
 */

/** Cap a hosted org returns to when its subscription ends. Matches the
 * hosted trial default (HOSTED_TRIAL_ACTION_CAP) until week-5 entitlements
 * define real free-tier ceilings. */
export const FREE_TIER_ACTION_CAP = 10_000;

const PAID_PLANS = new Set(['indie', 'team']);

export type OrgBillingState = {
  orgId: string;
  plan: string;
  claimed: boolean;
  hostedMode: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
};

export async function getOrgBillingState(sql: SqlTag, orgId: string): Promise<OrgBillingState | null> {
  const rows = await sql`
    SELECT id, plan, claimed_at, hosted_mode, stripe_customer_id, stripe_subscription_id,
           subscription_status, current_period_end
    FROM organizations
    WHERE id = ${orgId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    orgId: String(row.id),
    plan: String(row.plan ?? 'free'),
    claimed: Boolean(row.claimed_at),
    hostedMode: row.hosted_mode === true,
    stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
    subscriptionStatus: row.subscription_status ? String(row.subscription_status) : null,
    currentPeriodEnd: row.current_period_end ? String(row.current_period_end) : null,
  };
}

/** First writer wins — never overwrite an existing Stripe customer link. */
export async function saveStripeCustomerId(
  sql: SqlTag,
  { orgId, customerId }: { orgId: string; customerId: string },
): Promise<boolean> {
  const rows = await sql`
    UPDATE organizations
    SET stripe_customer_id = ${customerId}, updated_at = NOW()
    WHERE id = ${orgId} AND stripe_customer_id IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Idempotency claim: true exactly once per Stripe event id. The caller runs
 * the handler only on true — retries and replays claim nothing.
 */
export async function claimWebhookEvent(
  sql: SqlTag,
  { eventId, eventType, orgId }: { eventId: string; eventType: string; orgId: string | null },
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO stripe_webhook_events (event_id, event_type, org_id)
    VALUES (${eventId}, ${eventType}, ${orgId})
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  return rows.length > 0;
}

export async function applyCheckoutCompleted(
  sql: SqlTag,
  { orgId, plan, customerId, subscriptionId }: { orgId: string; plan: string; customerId: string; subscriptionId: string },
): Promise<{ applied: boolean }> {
  if (!PAID_PLANS.has(plan)) {
    throw new Error(`applyCheckoutCompleted: unknown paid plan ${JSON.stringify(plan)}`);
  }
  const rows = await sql`
    UPDATE organizations
    SET plan = ${plan},
        stripe_customer_id = COALESCE(stripe_customer_id, ${customerId}),
        stripe_subscription_id = ${subscriptionId},
        subscription_status = 'active',
        trial_action_cap = NULL,
        updated_at = NOW()
    WHERE id = ${orgId}
    RETURNING id
  `;
  return { applied: rows.length > 0 };
}

export async function applySubscriptionUpdated(
  sql: SqlTag,
  { subscriptionId, plan, status, currentPeriodEnd }: {
    subscriptionId: string;
    /** null = price id not recognized; keep the stored plan. */
    plan: string | null;
    status: string;
    currentPeriodEnd: string | null;
  },
): Promise<{ applied: boolean; orgId: string | null }> {
  if (plan !== null && !PAID_PLANS.has(plan)) {
    throw new Error(`applySubscriptionUpdated: unknown paid plan ${JSON.stringify(plan)}`);
  }
  const rows = await sql`
    UPDATE organizations
    SET plan = COALESCE(${plan}, plan),
        subscription_status = ${status},
        current_period_end = ${currentPeriodEnd},
        trial_action_cap = NULL,
        updated_at = NOW()
    WHERE stripe_subscription_id = ${subscriptionId}
    RETURNING id
  `;
  const row = rows[0];
  return { applied: rows.length > 0, orgId: row ? String(row.id) : null };
}

export async function applySubscriptionDeleted(
  sql: SqlTag,
  { subscriptionId }: { subscriptionId: string },
): Promise<{ applied: boolean; orgId: string | null }> {
  const rows = await sql`
    UPDATE organizations
    SET plan = 'free',
        subscription_status = 'canceled',
        stripe_subscription_id = NULL,
        current_period_end = NULL,
        trial_action_cap = CASE WHEN hosted_mode = TRUE THEN ${FREE_TIER_ACTION_CAP} ELSE trial_action_cap END,
        updated_at = NOW()
    WHERE stripe_subscription_id = ${subscriptionId}
    RETURNING id
  `;
  const row = rows[0];
  return { applied: rows.length > 0, orgId: row ? String(row.id) : null };
}

export async function applyPaymentFailed(
  sql: SqlTag,
  { customerId }: { customerId: string },
): Promise<{ applied: boolean; orgId: string | null }> {
  const rows = await sql`
    UPDATE organizations
    SET subscription_status = 'past_due', updated_at = NOW()
    WHERE stripe_customer_id = ${customerId}
    RETURNING id
  `;
  const row = rows[0];
  return { applied: rows.length > 0, orgId: row ? String(row.id) : null };
}

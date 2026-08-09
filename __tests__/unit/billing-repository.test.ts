/**
 * app/lib/repositories/billing.repository.ts — hosted paid tier checkout
 * (docs/decisions/2026-08-09-hosted-paid-tier.md). All Stripe-driven state
 * transitions on organizations, behind the route-SQL ratchet, plus the
 * webhook idempotency claim over stripe_webhook_events. Paying clears the
 * trial action cap (a customer must never be throttled at trial levels);
 * cancellation restores the free-tier cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqlTag } from '../../app/lib/types/db';
import {
  getOrgBillingState,
  saveStripeCustomerId,
  claimWebhookEvent,
  applyCheckoutCompleted,
  applySubscriptionUpdated,
  applySubscriptionDeleted,
  applyPaymentFailed,
  FREE_TIER_ACTION_CAP,
} from '../../app/lib/repositories/billing.repository';

type Call = { text: string; values: unknown[] };

function makeSqlMock(responses: unknown[][]) {
  const queue = [...responses];
  const calls: Call[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    calls.push({ text, values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: Call[] };
  (fn as unknown as { calls: Call[] }).calls = calls;
  return fn;
}

beforeEach(() => vi.clearAllMocks());

describe('getOrgBillingState', () => {
  it('returns the org billing snapshot', async () => {
    const sql = makeSqlMock([[{
      id: 'org_a', plan: 'free', claimed_at: '2026-08-09T00:00:00Z', hosted_mode: true,
      stripe_customer_id: 'cus_1', stripe_subscription_id: null,
      subscription_status: 'active', current_period_end: null,
    }]]);
    const state = await getOrgBillingState(sql, 'org_a');
    expect(state).toMatchObject({
      orgId: 'org_a', plan: 'free', claimed: true, hostedMode: true,
      stripeCustomerId: 'cus_1', stripeSubscriptionId: null,
    });
  });

  it('missing org → null', async () => {
    expect(await getOrgBillingState(makeSqlMock([[]]), 'org_x')).toBeNull();
  });
});

describe('claimWebhookEvent (idempotency)', () => {
  it('first claim wins and the handler should run', async () => {
    const sql = makeSqlMock([[{ event_id: 'evt_1' }]]);
    expect(await claimWebhookEvent(sql, { eventId: 'evt_1', eventType: 'checkout.session.completed', orgId: 'org_a' })).toBe(true);
    const { text } = sql.calls[0]!;
    expect(text).toContain('INSERT INTO stripe_webhook_events');
    expect(text).toContain('ON CONFLICT');
    expect(text).toContain('DO NOTHING');
    expect(text).toContain('RETURNING');
  });

  it('a replayed event id claims nothing and the handler must not run', async () => {
    expect(await claimWebhookEvent(makeSqlMock([[]]), { eventId: 'evt_1', eventType: 'x', orgId: null })).toBe(false);
  });
});

describe('applyCheckoutCompleted', () => {
  it('activates the plan, stores customer + subscription, and clears the trial action cap', async () => {
    const sql = makeSqlMock([[{ id: 'org_a' }]]);
    const r = await applyCheckoutCompleted(sql, {
      orgId: 'org_a', plan: 'indie', customerId: 'cus_1', subscriptionId: 'sub_1',
    });
    expect(r).toEqual({ applied: true });
    const { text, values } = sql.calls[0]!;
    expect(text).toContain('UPDATE organizations');
    expect(text).toContain("subscription_status = 'active'");
    expect(text).toContain('trial_action_cap = NULL');
    expect(values).toEqual(expect.arrayContaining(['org_a', 'indie', 'cus_1', 'sub_1']));
  });

  it('unknown org applies nothing', async () => {
    expect(await applyCheckoutCompleted(makeSqlMock([[]]), { orgId: 'org_x', plan: 'team', customerId: 'c', subscriptionId: 's' }))
      .toEqual({ applied: false });
  });

  it('rejects plans outside the tier set', async () => {
    const sql = makeSqlMock([]);
    await expect(applyCheckoutCompleted(sql, { orgId: 'o', plan: 'enterprise', customerId: 'c', subscriptionId: 's' }))
      .rejects.toThrow(/plan/);
    expect(sql.calls.length).toBe(0);
  });
});

describe('applySubscriptionUpdated', () => {
  it('updates plan, status, and period end by subscription id', async () => {
    const sql = makeSqlMock([[{ id: 'org_a' }]]);
    const r = await applySubscriptionUpdated(sql, {
      subscriptionId: 'sub_1', plan: 'team', status: 'active', currentPeriodEnd: '2026-09-09T00:00:00.000Z',
    });
    expect(r).toEqual({ applied: true, orgId: 'org_a' });
    const { text, values } = sql.calls[0]!;
    expect(text).toContain('WHERE stripe_subscription_id =');
    expect(text).toContain('trial_action_cap = NULL');
    expect(values).toEqual(expect.arrayContaining(['sub_1', 'team', 'active']));
  });

  it('a plan of null keeps the stored plan (price id not recognized)', async () => {
    const sql = makeSqlMock([[{ id: 'org_a' }]]);
    await applySubscriptionUpdated(sql, { subscriptionId: 'sub_1', plan: null, status: 'past_due', currentPeriodEnd: null });
    expect(sql.calls[0]!.text).toContain('COALESCE');
  });
});

describe('applySubscriptionDeleted', () => {
  it('returns the org to free and restores the free-tier action cap', async () => {
    const sql = makeSqlMock([[{ id: 'org_a' }]]);
    const r = await applySubscriptionDeleted(sql, { subscriptionId: 'sub_1' });
    expect(r).toEqual({ applied: true, orgId: 'org_a' });
    const { text, values } = sql.calls[0]!;
    expect(text).toContain("plan = 'free'");
    expect(text).toContain("subscription_status = 'canceled'");
    expect(text).toContain('stripe_subscription_id = NULL');
    // Only hosted orgs get the cap restored; the value is the free-tier cap.
    expect(text).toContain('WHEN hosted_mode = TRUE THEN');
    expect(values).toContain(FREE_TIER_ACTION_CAP);
  });
});

describe('applyPaymentFailed', () => {
  it('marks the subscription past_due by customer id', async () => {
    const sql = makeSqlMock([[{ id: 'org_a' }]]);
    const r = await applyPaymentFailed(sql, { customerId: 'cus_1' });
    expect(r).toEqual({ applied: true, orgId: 'org_a' });
    const { text } = sql.calls[0]!;
    expect(text).toContain("subscription_status = 'past_due'");
    expect(text).toContain('WHERE stripe_customer_id =');
  });
});

describe('saveStripeCustomerId', () => {
  it('writes the customer id only when none is stored (first writer wins)', async () => {
    const sql = makeSqlMock([[{ id: 'org_a' }]]);
    expect(await saveStripeCustomerId(sql, { orgId: 'org_a', customerId: 'cus_1' })).toBe(true);
    const { text } = sql.calls[0]!;
    expect(text).toContain('stripe_customer_id IS NULL');
  });
});

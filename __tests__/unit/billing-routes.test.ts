/**
 * Billing routes (v5.14 hosted paid tier checkout):
 *  - POST /api/billing/checkout — human org admin of a CLAIMED org starts a
 *    subscription Checkout Session ("you cannot bill an anonymous trial
 *    cookie"); 501 when Stripe is unconfigured.
 *  - GET /api/billing/portal — customer portal session for the org's
 *    stored Stripe customer.
 *  - POST /api/webhooks/stripe — public, stripe-signature verified in the
 *    route, every event id claimed exactly once through the
 *    stripe_webhook_events ledger before its handler runs.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCheckoutCreate, mockPortalCreate, mockCustomersCreate, mockConstructEvent,
} = vi.hoisted(() => ({
  mockCheckoutCreate: vi.fn(),
  mockPortalCreate: vi.fn(),
  mockCustomersCreate: vi.fn(),
  mockConstructEvent: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class StripeMock {
    checkout = { sessions: { create: mockCheckoutCreate } };
    billingPortal = { sessions: { create: mockPortalCreate } };
    customers = { create: mockCustomersCreate };
    webhooks = { constructEvent: mockConstructEvent };
  },
}));

const {
  mockGetState, mockSaveCustomer, mockClaimEvent,
  mockApplyCompleted, mockApplyUpdated, mockApplyDeleted, mockApplyFailed,
} = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockSaveCustomer: vi.fn(async () => true),
  mockClaimEvent: vi.fn(async () => true),
  mockApplyCompleted: vi.fn(async () => ({ applied: true })),
  mockApplyUpdated: vi.fn(async () => ({ applied: true, orgId: 'org_a' })),
  mockApplyDeleted: vi.fn(async () => ({ applied: true, orgId: 'org_a' })),
  mockApplyFailed: vi.fn(async () => ({ applied: true, orgId: 'org_a' })),
}));
vi.mock('@/lib/repositories/billing.repository', () => ({
  getOrgBillingState: mockGetState,
  saveStripeCustomerId: mockSaveCustomer,
  claimWebhookEvent: mockClaimEvent,
  applyCheckoutCompleted: mockApplyCompleted,
  applySubscriptionUpdated: mockApplyUpdated,
  applySubscriptionDeleted: mockApplyDeleted,
  applyPaymentFailed: mockApplyFailed,
  FREE_TIER_ACTION_CAP: 10_000,
}));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

const { POST: checkoutPOST } = await import('../../app/api/billing/checkout/route');
const { GET: portalGET } = await import('../../app/api/billing/portal/route');
const { POST: webhookPOST } = await import('../../app/api/webhooks/stripe/route');

function authedReq(method: string, { userId = 'usr_1', role = 'admin', body }: { userId?: string; role?: string; body?: unknown } = {}) {
  return new Request('http://localhost:3000/api/billing/x', {
    method,
    headers: { 'x-org-id': 'org_a', 'x-org-role': role, 'x-user-id': userId, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function webhookReq(payload: unknown, sig = 'sig_valid') {
  return new Request('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': sig },
    body: JSON.stringify(payload),
  });
}

const claimedState = {
  orgId: 'org_a', plan: 'free', claimed: true, hostedMode: true,
  stripeCustomerId: 'cus_1', stripeSubscriptionId: null,
  subscriptionStatus: 'active', currentPeriodEnd: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_vitest_fixture');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_vitest_fixture');
  vi.stubEnv('STRIPE_PRICE_INDIE', 'price_indie');
  vi.stubEnv('STRIPE_PRICE_TEAM', 'price_team');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://hosted.dashclaw.io');
  mockGetState.mockResolvedValue({ ...claimedState });
  mockClaimEvent.mockResolvedValue(true);
  mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/s/1' });
  mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/1' });
  mockCustomersCreate.mockResolvedValue({ id: 'cus_new' });
});

describe('POST /api/billing/checkout', () => {
  it('creates a subscription checkout session for a claimed org', async () => {
    const res = await checkoutPOST(authedReq('POST', { body: { plan: 'indie' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain('checkout.stripe.com');
    const args = mockCheckoutCreate.mock.calls[0]![0];
    expect(args.mode).toBe('subscription');
    expect(args.line_items).toEqual([{ price: 'price_indie', quantity: 1 }]);
    expect(args.metadata).toMatchObject({ org_id: 'org_a', plan: 'indie' });
    expect(args.success_url).toContain('billing=success');
    expect(args.cancel_url).toContain('billing=canceled');
  });

  it('creates and stores a Stripe customer when the org has none', async () => {
    mockGetState.mockResolvedValue({ ...claimedState, stripeCustomerId: null });
    const res = await checkoutPOST(authedReq('POST', { body: { plan: 'team' } }));
    expect(res.status).toBe(200);
    expect(mockCustomersCreate).toHaveBeenCalledWith(expect.objectContaining({ metadata: { org_id: 'org_a' } }));
    expect(mockSaveCustomer).toHaveBeenCalledWith(expect.anything(), { orgId: 'org_a', customerId: 'cus_new' });
  });

  it('501 when Stripe is unconfigured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const res = await checkoutPOST(authedReq('POST', { body: { plan: 'indie' } }));
    expect(res.status).toBe(501);
    expect((await res.json()).code).toBe('BILLING_NOT_CONFIGURED');
  });

  it('409 claim_required for an unclaimed hosted org — you cannot bill an anonymous trial cookie', async () => {
    mockGetState.mockResolvedValue({ ...claimedState, claimed: false });
    const res = await checkoutPOST(authedReq('POST', { body: { plan: 'indie' } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('claim_required');
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('400 on unknown plan; 403 for non-human or non-admin principals', async () => {
    expect((await checkoutPOST(authedReq('POST', { body: { plan: 'enterprise' } }))).status).toBe(400);
    expect((await checkoutPOST(authedReq('POST', { userId: 'key_1', body: { plan: 'indie' } }))).status).toBe(403);
    expect((await checkoutPOST(authedReq('POST', { role: 'member', body: { plan: 'indie' } }))).status).toBe(403);
  });
});

describe('GET /api/billing/portal', () => {
  it('opens the customer portal for the stored customer', async () => {
    const res = await portalGET(authedReq('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain('billing.stripe.com');
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_1' }));
  });

  it('400 NO_CUSTOMER when the org never checked out', async () => {
    mockGetState.mockResolvedValue({ ...claimedState, stripeCustomerId: null });
    const res = await portalGET(authedReq('GET'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('NO_CUSTOMER');
  });

  it('403 for non-admin; 501 unconfigured', async () => {
    expect((await portalGET(authedReq('GET', { role: 'member' }))).status).toBe(403);
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect((await portalGET(authedReq('GET'))).status).toBe(501);
  });
});

describe('POST /api/webhooks/stripe', () => {
  const completedEvent = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { org_id: 'org_a', plan: 'indie' } } },
  };

  it('verifies the signature, claims the event, and applies checkout completion', async () => {
    mockConstructEvent.mockReturnValue(completedEvent);
    const res = await webhookPOST(webhookReq(completedEvent));
    expect(res.status).toBe(200);
    expect(mockClaimEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventId: 'evt_1' }));
    expect(mockApplyCompleted).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_a', plan: 'indie', customerId: 'cus_1', subscriptionId: 'sub_1',
    });
  });

  it('400 on a bad signature, and nothing is applied', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const res = await webhookPOST(webhookReq(completedEvent, 'sig_bad'));
    expect(res.status).toBe(400);
    expect(mockApplyCompleted).not.toHaveBeenCalled();
  });

  it('a replayed event id is acknowledged but never re-applied', async () => {
    mockConstructEvent.mockReturnValue(completedEvent);
    mockClaimEvent.mockResolvedValue(false);
    const res = await webhookPOST(webhookReq(completedEvent));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(mockApplyCompleted).not.toHaveBeenCalled();
  });

  it('maps subscription.updated price ids to plans (unknown price → keep stored plan)', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', current_period_end: 1770000000, items: { data: [{ price: { id: 'price_team' } }] } } },
    });
    await webhookPOST(webhookReq({}));
    expect(mockApplyUpdated).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subscriptionId: 'sub_1', plan: 'team', status: 'active',
      currentPeriodEnd: new Date(1770000000 * 1000).toISOString(),
    }));

    mockConstructEvent.mockReturnValue({
      id: 'evt_3',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', current_period_end: null, items: { data: [{ price: { id: 'price_legacy' } }] } } },
    });
    await webhookPOST(webhookReq({}));
    expect(mockApplyUpdated).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ plan: null }));
  });

  it('handles subscription.deleted and invoice.payment_failed', async () => {
    mockConstructEvent.mockReturnValue({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
    await webhookPOST(webhookReq({}));
    expect(mockApplyDeleted).toHaveBeenCalledWith(expect.anything(), { subscriptionId: 'sub_1' });

    mockConstructEvent.mockReturnValue({ id: 'evt_5', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
    await webhookPOST(webhookReq({}));
    expect(mockApplyFailed).toHaveBeenCalledWith(expect.anything(), { customerId: 'cus_1' });
  });

  it('unhandled event types are acknowledged without side effects', async () => {
    mockConstructEvent.mockReturnValue({ id: 'evt_6', type: 'customer.created', data: { object: {} } });
    const res = await webhookPOST(webhookReq({}));
    expect(res.status).toBe(200);
    expect(mockApplyCompleted).not.toHaveBeenCalled();
    expect(mockApplyUpdated).not.toHaveBeenCalled();
  });

  it('501 when the webhook secret is unset', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const res = await webhookPOST(webhookReq(completedEvent));
    expect(res.status).toBe(501);
  });
});

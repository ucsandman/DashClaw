import { describe, expect, it } from 'vitest';
import { processCheckoutCompletedEvent } from '../../app/lib/repositories/billing.repository';

describe('F17 Stripe webhook atomicity', () => {
  it('claims an event and applies checkout state in the same SQL statement', async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join('?'), values });
      return Promise.resolve([{ claimed: true, applied: true, org_id: 'org_a' }]);
    }) as never;

    const result = await processCheckoutCompletedEvent(sql, {
      eventId: 'evt_1', eventType: 'checkout.session.completed', orgId: 'org_a',
      plan: 'indie', customerId: 'cus_1', subscriptionId: 'sub_1',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain('INSERT INTO stripe_webhook_events');
    expect(calls[0]!.text).toContain('UPDATE organizations');
    expect(result).toEqual({ claimed: true, applied: true, orgId: 'org_a' });
  });

  it('reports a concurrent/replayed event as unclaimed without a second mutation', async () => {
    const sql = (() => Promise.resolve([{ claimed: false, applied: false, org_id: null }])) as never;
    await expect(processCheckoutCompletedEvent(sql, {
      eventId: 'evt_1', eventType: 'checkout.session.completed', orgId: 'org_a',
      plan: 'team', customerId: 'cus_1', subscriptionId: 'sub_1',
    })).resolves.toEqual({ claimed: false, applied: false, orgId: null });
  });
});

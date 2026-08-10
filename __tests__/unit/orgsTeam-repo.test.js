import { describe, it, expect } from 'vitest';
import { getOrgStripeCustomerId, getTeamOrgAndMembers } from '../../app/lib/repositories/orgsTeam.repository';

function fakeSql(returns = []) {
  const calls = [];
  const tag = (strings, ...vals) => {
    calls.push({ text: strings.join('?'), vals });
    return Promise.resolve(returns);
  };
  tag.calls = calls;
  return tag;
}

describe('getOrgStripeCustomerId', () => {
  it('selects stripe_customer_id from organizations scoped to the org', async () => {
    const sql = fakeSql([{ stripe_customer_id: 'cus_123' }]);
    const customerId = await getOrgStripeCustomerId(sql, 'org_test');
    expect(customerId).toBe('cus_123');
    expect(sql.calls.length).toBe(1);
    expect(sql.calls[0].text).toMatch(/SELECT stripe_customer_id FROM organizations WHERE id =/);
    expect(sql.calls[0].vals).toEqual(['org_test']);
  });

  it('returns null when the org has no stripe customer', async () => {
    const sql = fakeSql([{ stripe_customer_id: null }]);
    expect(await getOrgStripeCustomerId(sql, 'org_test')).toBeNull();
  });

  it('returns null when the org row is missing', async () => {
    const sql = fakeSql([]);
    expect(await getOrgStripeCustomerId(sql, 'org_missing')).toBeNull();
  });
});

describe('getTeamOrgAndMembers', () => {
  it('selects hosted_mode alongside plan (seat-cap entitlement check gates on it)', async () => {
    const sql = fakeSql([]);
    await getTeamOrgAndMembers(sql, 'org_test');
    const orgCall = sql.calls.find((c) => c.text.includes('FROM organizations'));
    expect(orgCall.text).toMatch(/SELECT id, name, slug, plan, hosted_mode FROM organizations/);
    expect(orgCall.vals).toEqual(['org_test']);
  });
});

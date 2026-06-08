import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProvider, listProviders, getProvider, updateProvider, resolveProviderByName,
  createEndpoint, listEndpoints, getEndpoint,
  createPurchase, getPurchase, listPurchases, setPurchaseOutcome,
} from '@/lib/repositories/x402.repository.js';

// __tests__/helpers.js `createSqlMock` uses a pre-seeded taggedResponses/queryCalls
// shape (NOT vi.fn) and exposes `.taggedCalls`, not `.mock.calls`. For repository
// SQL tests we use a plain vi.fn() as the tagged-template `sql`. When called as a
// tagged template, the mock receives (templateStringsArray, ...interpolatedValues),
// so calls[n][0] is the SQL skeleton and calls[n].slice(1) are the bound values.
let sql;
beforeEach(() => { sql = vi.fn(); });
const sqlText = (call) => call[0].join('?');
const sqlValues = (call) => call.slice(1);

describe('x402 provider repository', () => {
  it('createProvider mints a prov_ id, slugifies the name, and binds the org as a value', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', slug: 'exa-search' }]);
    const row = await createProvider(sql, 'org_1', { name: 'Exa Search' });
    expect(row.provider_id).toBe('prov_x');
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('INSERT INTO x402_providers');
    expect(call[1]).toMatch(/^prov_/);   // generated provider_id (not just the mocked return)
    expect(call[2]).toBe('org_1');       // org scoping bound as a parameter
    expect(call[4]).toBe('exa-search');  // slug derived from the name by slugify
  });

  it('listProviders filters by org + status', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x' }]);
    const rows = await listProviders(sql, 'org_1', { status: 'active' });
    expect(rows).toHaveLength(1);
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('AND status =');
    expect(sqlValues(call)).toEqual(['org_1', 'active']);
  });

  it('listProviders without a status uses the unfiltered org-scoped query', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_a' }, { provider_id: 'prov_b' }]);
    const rows = await listProviders(sql, 'org_1');
    expect(rows).toHaveLength(2);
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('FROM x402_providers');
    expect(sqlText(call)).not.toContain('AND status =');
    expect(sqlValues(call)).toEqual(['org_1']);
  });

  it('getProvider binds org + id and returns null when missing', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getProvider(sql, 'org_1', 'prov_missing')).toBeNull();
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'prov_missing']);
  });

  it('updateProvider applies whitelisted fields and ignores non-whitelisted ones', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', name: 'Exa', status: 'active', category: 'research', base_url: null, description: null, pricing_model: null, default_currency: 'USDC', metadata: '{}' }]);
    sql.mockResolvedValueOnce([{ provider_id: 'prov_x', status: 'disabled' }]);
    const row = await updateProvider(sql, 'org_1', 'prov_x', { status: 'disabled', slug: 'evil', provider_id: 'evil', org_id: 'evil' });
    expect(row.status).toBe('disabled');
    const updateValues = sqlValues(sql.mock.calls[1]);
    expect(updateValues).toContain('disabled');  // whitelisted patch applied
    expect(updateValues).not.toContain('evil');   // slug / provider_id / org_id are NOT patchable
    expect(updateValues).toContain('org_1');       // org scoping preserved
    expect(updateValues).toContain('prov_x');      // target id preserved
  });

  it('updateProvider returns null without issuing an UPDATE when the provider is missing', async () => {
    sql.mockResolvedValueOnce([]); // getProvider miss
    expect(await updateProvider(sql, 'org_1', 'prov_missing', { status: 'disabled' })).toBeNull();
    expect(sql.mock.calls).toHaveLength(1); // no second (UPDATE) query was issued
  });

  it('resolveProviderByName reuses an existing provider matched by slug/name without inserting', async () => {
    sql.mockResolvedValueOnce([{ provider_id: 'prov_existing', name: 'stableenrich.dev', slug: 'stableenrich-dev' }]);
    const row = await resolveProviderByName(sql, 'org_1', 'stableenrich.dev');
    expect(row.provider_id).toBe('prov_existing');
    expect(sql.mock.calls).toHaveLength(1); // SELECT only — no INSERT when a match exists
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('FROM x402_providers');
    expect(sqlValues(call)).toEqual(['org_1', 'stableenrich-dev', 'stableenrich.dev']); // org, slug, lower(name)
  });

  it('resolveProviderByName auto-registers a minimal active provider when none matches', async () => {
    sql.mockResolvedValueOnce([]); // SELECT miss
    sql.mockResolvedValueOnce([{ provider_id: 'prov_new', slug: 'stableenrich-dev' }]); // INSERT
    const row = await resolveProviderByName(sql, 'org_1', 'stableenrich.dev');
    expect(row.provider_id).toBe('prov_new');
    expect(sql.mock.calls).toHaveLength(2);
    expect(sqlText(sql.mock.calls[1])).toContain('INSERT INTO x402_providers');
    expect(sql.mock.calls[1][4]).toBe('stableenrich-dev'); // slug derived from the name
  });

  it('resolveProviderByName returns null for a blank name without touching the DB', async () => {
    expect(await resolveProviderByName(sql, 'org_1', '   ')).toBeNull();
    expect(sql.mock.calls).toHaveLength(0);
  });
});

describe('x402 endpoint repository', () => {
  it('createEndpoint mints a pep_ id under a provider and binds org + provider + slug', async () => {
    sql.mockResolvedValueOnce([{ endpoint_id: 'pep_1', provider_id: 'prov_x', slug: 'search' }]);
    const row = await createEndpoint(sql, 'org_1', 'prov_x', { name: 'Search' });
    expect(row.endpoint_id).toBe('pep_1');
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('INSERT INTO x402_endpoints');
    expect(call[1]).toMatch(/^pep_/);  // generated endpoint_id
    expect(call[2]).toBe('org_1');      // org bound as a value
    expect(call[3]).toBe('prov_x');     // provider bound as a value
    expect(call[5]).toBe('search');     // slug derived from name
  });

  it('listEndpoints scopes by org + provider', async () => {
    sql.mockResolvedValueOnce([{ endpoint_id: 'pep_1' }]);
    const rows = await listEndpoints(sql, 'org_1', 'prov_x');
    expect(rows).toHaveLength(1);
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'prov_x']);
  });

  it('getEndpoint binds org + id and returns null when missing', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getEndpoint(sql, 'org_1', 'pep_missing')).toBeNull();
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'pep_missing']);
  });
});

describe('x402 purchase repository', () => {
  it('createPurchase upserts a detail row keyed by action_id, binding org + provider + spend', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1', spend_amount: 0.05, provider_id: 'prov_x' }]);
    const row = await createPurchase(sql, 'org_1', 'act_1', { provider_id: 'prov_x', spend_amount: 0.05, purchase_reason: 'gap' });
    expect(row.action_id).toBe('act_1');
    const call = sql.mock.calls[0];
    expect(sqlText(call)).toContain('INSERT INTO x402_purchases');
    expect(sqlText(call)).toContain('ON CONFLICT (action_id) DO UPDATE');
    expect(call[1]).toBe('act_1');   // PK = action_id (the act_ id)
    expect(call[2]).toBe('org_1');   // org bound
    expect(call[3]).toBe('prov_x');  // provider bound
    expect(call[6]).toBe(0.05);      // spend_amount bound
  });

  it('getPurchase binds org + action_id and returns null when missing', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getPurchase(sql, 'org_1', 'act_missing')).toBeNull();
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'act_missing']);
  });

  it('listPurchases is org-scoped with no provider filter', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1' }]);
    expect(await listPurchases(sql, 'org_1', {})).toHaveLength(1);
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1']);
  });

  it('listPurchases filters by provider when given', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1' }]);
    await listPurchases(sql, 'org_1', { providerId: 'prov_x' });
    expect(sqlValues(sql.mock.calls[0])).toEqual(['org_1', 'prov_x']);
  });

  it('listPurchases caps both branches with an explicit LIMIT', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1' }]);
    await listPurchases(sql, 'org_1', {});
    expect(sqlText(sql.mock.calls[0])).toContain('LIMIT 1000');

    sql.mockResolvedValueOnce([{ action_id: 'act_2' }]);
    await listPurchases(sql, 'org_1', { providerId: 'prov_x' });
    expect(sqlText(sql.mock.calls[1])).toContain('LIMIT 1000');
  });

  it('setPurchaseOutcome records execution result + value score, org-scoped', async () => {
    sql.mockResolvedValueOnce([{ action_id: 'act_1', execution_status: 'succeeded', value_score: 0.8 }]);
    const row = await setPurchaseOutcome(sql, 'org_1', 'act_1', { execution_status: 'succeeded', value_score: 0.8, result_summary: 'ok' });
    expect(row.execution_status).toBe('succeeded');
    const vals = sqlValues(sql.mock.calls[0]);
    expect(vals).toContain('succeeded');
    expect(vals).toContain(0.8);
    expect(vals).toContain('org_1');
    expect(vals).toContain('act_1');
  });
});

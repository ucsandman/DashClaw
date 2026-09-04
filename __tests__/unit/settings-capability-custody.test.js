import { describe, expect, it, vi } from 'vitest';
import { upsertSetting, settingsDeclaredByCapability } from '@/lib/repositories/settings.repository.js';

// Capability custody (v5.33.1): a setting a registered http_api capability
// declares (auth.token_setting, `$settings.<KEY>` in its request mapping) is
// writable for that org even though the static allowlist does not name it.
// The live wiring of the buy-domain capability was refused with
// "Invalid setting key: VERCEL_REGISTRAR_TOKEN" (2026-09-04).

const BUY_DOMAIN_SCHEMA = {
  endpoint: 'https://api.vercel.com/v1/registrar/domains/${input.domain}/buy',
  method: 'POST',
  auth: { type: 'bearer', token_setting: 'VERCEL_REGISTRAR_TOKEN' },
  request_mapping: {
    expectedPrice: '$.expectedPrice',
    nested: { contactInformation: '$settings.REGISTRANT_CONTACT' },
    list: ['$settings.LIST_KEY'],
  },
};

function sqlWith(rows) {
  const calls = [];
  const sql = vi.fn(async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/FROM capabilities/.test(text)) return rows;
    return [];
  });
  return { sql, calls };
}

describe('settingsDeclaredByCapability', () => {
  it('collects the auth token setting and every $settings.KEY in the request mapping', () => {
    expect(settingsDeclaredByCapability(BUY_DOMAIN_SCHEMA).sort()).toEqual(['LIST_KEY', 'REGISTRANT_CONTACT', 'VERCEL_REGISTRAR_TOKEN']);
  });

  it('ignores malformed keys and non-object schemas', () => {
    expect(settingsDeclaredByCapability({ auth: { token_setting: '../etc' }, request_mapping: { a: '$settings.lower' } })).toEqual([]);
    expect(settingsDeclaredByCapability(null)).toEqual([]);
  });
});

describe('upsertSetting — capability custody keys', () => {
  it('accepts a key a registered capability declares (JSON-string column)', async () => {
    const { sql, calls } = sqlWith([{ invocation_schema_json: JSON.stringify(BUY_DOMAIN_SCHEMA) }]);
    await upsertSetting(sql, 'org_1', { key: 'VERCEL_REGISTRAR_TOKEN', value: 'enc', category: 'integration', encrypted: true });
    expect(calls.some((c) => /INSERT INTO settings/.test(c.text))).toBe(true);
  });

  it('accepts a $settings key from the request mapping (object column)', async () => {
    const { sql, calls } = sqlWith([{ invocation_schema_json: BUY_DOMAIN_SCHEMA }]);
    await upsertSetting(sql, 'org_1', { key: 'REGISTRANT_CONTACT', value: '{}', category: 'integration', encrypted: true });
    expect(calls.some((c) => /INSERT INTO settings/.test(c.text))).toBe(true);
  });

  it('still refuses a key no capability declares', async () => {
    const { sql } = sqlWith([{ invocation_schema_json: JSON.stringify(BUY_DOMAIN_SCHEMA) }]);
    await expect(upsertSetting(sql, 'org_1', { key: 'SOME_OTHER_TOKEN', value: 'x', category: 'integration' }))
      .rejects.toThrow('Invalid setting key: SOME_OTHER_TOKEN');
  });

  it('scopes the lookup to the org', async () => {
    const { sql, calls } = sqlWith([]);
    await expect(upsertSetting(sql, 'org_2', { key: 'VERCEL_REGISTRAR_TOKEN', value: 'x', category: 'integration' }))
      .rejects.toThrow('Invalid setting key');
    const lookup = calls.find((c) => /FROM capabilities/.test(c.text));
    expect(lookup.values).toContain('org_2');
  });

  it('does not consult capabilities for an allowlisted key', async () => {
    const { sql, calls } = sqlWith([]);
    await upsertSetting(sql, 'org_1', { key: 'VERCEL_TOKEN', value: 'x', category: 'integration' });
    expect(calls.some((c) => /FROM capabilities/.test(c.text))).toBe(false);
  });
});

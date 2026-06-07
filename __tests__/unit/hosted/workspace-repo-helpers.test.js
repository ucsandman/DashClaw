import { describe, it, expect } from 'vitest';
import {
  applyHostedTrial,
  markTrialFull,
  countActiveTrials,
  mintOrgApiKey,
} from '../../../app/lib/repositories/hosted-workspace.repository.js';

function fakeSql(returns = []) {
  const calls = [];
  const tag = (strings, ...vals) => {
    calls.push({ text: strings.join('?'), vals });
    return Promise.resolve(returns);
  };
  tag.calls = calls;
  return tag;
}

describe('applyHostedTrial', () => {
  it('issues UPDATE organizations with hosted_mode = TRUE and returns a future expiresAt', async () => {
    const sql = fakeSql([]);
    const { expiresAt } = await applyHostedTrial(sql, 'org_test', {
      trialDays: 30,
      trialActionCap: 5000,
    });
    expect(sql.calls.length).toBe(1);
    expect(sql.calls[0].text).toMatch(/UPDATE organizations/);
    expect(sql.calls[0].text).toMatch(/hosted_mode = TRUE/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('markTrialFull', () => {
  it('issues UPDATE organizations setting trial_action_cap = 0', async () => {
    const sql = fakeSql([]);
    await markTrialFull(sql, 'org_full');
    expect(sql.calls.length).toBe(1);
    expect(sql.calls[0].text).toMatch(/trial_action_cap = 0/);
  });
});

describe('countActiveTrials', () => {
  it('returns the count value from the query row', async () => {
    const sql = fakeSql([{ count: 7 }]);
    const count = await countActiveTrials(sql);
    expect(count).toBe(7);
  });

  it('returns 0 when the result set is empty', async () => {
    const sql = fakeSql([]);
    const count = await countActiveTrials(sql);
    expect(count).toBe(0);
  });
});

describe('mintOrgApiKey', () => {
  it('inserts into api_keys and returns a plaintext key + prefix', async () => {
    const sql = fakeSql([]);
    const { apiKey, keyPrefix } = await mintOrgApiKey(sql, 'org_abc');
    expect(sql.calls.length).toBe(1);
    expect(sql.calls[0].text).toMatch(/INSERT INTO api_keys/);
    expect(apiKey).toMatch(/^oc_live_/);
    expect(typeof keyPrefix).toBe('string');
    expect(keyPrefix.length).toBeGreaterThan(0);
  });

  it('accepts custom label/role/scope options', async () => {
    const sql = fakeSql([]);
    await mintOrgApiKey(sql, 'org_abc', { label: 'custom', role: 'viewer', scope: 'read' });
    expect(sql.calls.length).toBe(1);
  });
});

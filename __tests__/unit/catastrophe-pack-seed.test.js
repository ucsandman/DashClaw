// __tests__/unit/catastrophe-pack-seed.test.js
//
// app/lib/setup/catastrophe-pack.mjs — the plain-node seed helper called by
// scripts/auto-migrate.mjs at org birth. Uses a stub `sql` tag: each SELECT
// decides skip-vs-insert, and inserts are captured for assertion. No conditional
// sql`` fragments here, so the tagged-template mock is a straight call log.

import { describe, it, expect } from 'vitest';
import { seedCatastrophePack, loadCatastrophePackPolicies } from '../../app/lib/setup/catastrophe-pack.mjs';

// existingNames: policy names the org already has → SELECT returns a row → skip.
function makeSqlStub(existingNames = []) {
  const inserts = [];
  const selects = [];
  const sql = (strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('SELECT')) {
      // WHERE org_id = ${orgId} AND name = ${name}
      const name = values[1];
      selects.push({ orgId: values[0], name });
      return Promise.resolve(existingNames.includes(name) ? [{ id: 'gp_existing' }] : []);
    }
    if (text.includes('INSERT')) {
      // VALUES (${id}, ${orgId}, ${name}, ${policy_type}, ${rules}, 1, ${now}, ${now})
      inserts.push({
        id: values[0],
        orgId: values[1],
        name: values[2],
        policyType: values[3],
        rules: values[4],
      });
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  sql._inserts = inserts;
  sql._selects = selects;
  return sql;
}

describe('loadCatastrophePackPolicies', () => {
  it('parses exactly three policies from the pack yml', () => {
    const policies = loadCatastrophePackPolicies();
    expect(policies).toHaveLength(3);
    expect(policies.map((p) => p.id)).toEqual([
      'block_mass_destructive',
      'hold_secret_file_writes',
      'rate_limit_runaway_safety',
    ]);
  });
});

describe('seedCatastrophePack', () => {
  it('inserts all three policies into an empty org', async () => {
    const sql = makeSqlStub([]);
    const result = await seedCatastrophePack(sql, 'org_default');
    expect(result).toEqual({ imported: 3, skipped: 0 });
    expect(sql._inserts).toHaveLength(3);
    for (const row of sql._inserts) {
      expect(row.orgId).toBe('org_default');
      expect(row.id).toMatch(/^gp_/);
      expect(typeof row.rules).toBe('string'); // JSON.stringify(policy.rules)
    }
  });

  it('uses the `description || id` naming formula (byte-identical to importPolicies)', async () => {
    const sql = makeSqlStub([]);
    await seedCatastrophePack(sql, 'org_default');
    const names = sql._inserts.map((r) => r.name);
    expect(names).toEqual([
      'Catastrophe Pack — Block Mass-Destructive Operations',
      'Catastrophe Pack — Hold Secret-File Writes for Approval',
      'Catastrophe Pack — Rate-Limit Runaway Agents',
    ]);
  });

  it('skips policies whose name already exists (idempotent second layer)', async () => {
    const sql = makeSqlStub([
      'Catastrophe Pack — Block Mass-Destructive Operations',
      'Catastrophe Pack — Hold Secret-File Writes for Approval',
      'Catastrophe Pack — Rate-Limit Runaway Agents',
    ]);
    const result = await seedCatastrophePack(sql, 'org_default');
    expect(result).toEqual({ imported: 0, skipped: 3 });
    expect(sql._inserts).toHaveLength(0);
  });

  it('inserts only the missing policy when one already exists', async () => {
    const sql = makeSqlStub(['Catastrophe Pack — Block Mass-Destructive Operations']);
    const result = await seedCatastrophePack(sql, 'org_default');
    expect(result).toEqual({ imported: 2, skipped: 1 });
    expect(sql._inserts.map((r) => r.name)).toEqual([
      'Catastrophe Pack — Hold Secret-File Writes for Approval',
      'Catastrophe Pack — Rate-Limit Runaway Agents',
    ]);
  });
});

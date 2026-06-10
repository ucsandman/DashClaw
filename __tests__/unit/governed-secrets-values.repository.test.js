/**
 * Managed secret values — repository layer.
 * Uses the REAL app/lib/encryption.ts (AES-256-GCM) with a test
 * ENCRYPTION_KEY so ciphertext format, AAD binding, and the delivery
 * merge/decrypt path are exercised for real, not mocked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { encrypt, decrypt } from '../../app/lib/encryption.js';
import {
  listSecrets,
  createSecret,
  updateSecret,
  setSecretValue,
  clearSecretValue,
  setDeliveryEnabled,
  getDeliverableSecrets,
  isEnvSafeName,
} from '../../app/lib/repositories/governed-secrets.repository.js';

const TEST_KEY = 'unit-test-encryption-key-32bytes'; // exactly 32 bytes
const PLAINTEXT_FIXTURE = 'sk-live-plaintext-fixture-do-not-leak';

let savedKey;
beforeAll(() => {
  savedKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedKey;
});

describe('setSecretValue', () => {
  it('stores v2 ciphertext that does not contain the plaintext, and resets last_rotated_at', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'sec_1', name: 'OPENAI_API_KEY' }]] });
    const row = await setSecretValue(sql, 'org_a', 'sec_1', PLAINTEXT_FIXTURE);
    expect(row.id).toBe('sec_1');

    const call = sql.taggedCalls[0];
    expect(call.text).toMatch(/UPDATE governed_secrets/i);
    // A set IS a rotation.
    expect(call.text).toMatch(/last_rotated_at = NOW\(\)/i);

    const stored = call.values.find((v) => typeof v === 'string' && v.startsWith('v2:'));
    expect(stored).toBeDefined();
    expect(stored).not.toContain(PLAINTEXT_FIXTURE);
    expect(call.values).toContain('aes-256-gcm-v2');
    // No parameter carries the raw plaintext.
    for (const v of call.values) {
      if (typeof v === 'string') expect(v).not.toContain(PLAINTEXT_FIXTURE);
    }
    // Round-trips with the row's own AAD.
    expect(decrypt(stored, 'org_a:sec_1')).toBe(PLAINTEXT_FIXTURE);
  });
});

describe('AAD binding (cross-org / cross-row splice protection)', () => {
  it('refuses decryption under any other org or secret id', () => {
    const ct = encrypt(PLAINTEXT_FIXTURE, 'orgA:id1');
    expect(decrypt(ct, 'orgA:id1')).toBe(PLAINTEXT_FIXTURE);
    // decrypt() catches GCM auth failures and returns null (fail closed).
    expect(decrypt(ct, 'orgB:id1')).toBeNull();
    expect(decrypt(ct, 'orgA:id2')).toBeNull();
  });
});

describe('getDeliverableSecrets', () => {
  it('merges org-wide + agent-specific with agent winning per name; skips corrupt rows', async () => {
    const rows = [
      { id: 's1', org_id: 'org_a', agent_id: null, name: 'FOO', value_encrypted: encrypt('org-foo', 'org_a:s1') },
      { id: 's2', org_id: 'org_a', agent_id: 'hermes', name: 'FOO', value_encrypted: encrypt('agent-foo', 'org_a:s2') },
      { id: 's3', org_id: 'org_a', agent_id: null, name: 'BAR', value_encrypted: encrypt('bar-val', 'org_a:s3') },
      // Ciphertext spliced from another row: AAD auth fails → skipped, not fatal.
      { id: 's4', org_id: 'org_a', agent_id: null, name: 'BAD', value_encrypted: encrypt('stolen', 'org_a:other') },
    ];
    const sql = createSqlMock({ taggedResponses: [rows] });
    const result = await getDeliverableSecrets(sql, 'org_a', 'hermes');

    expect(sql.taggedCalls[0].text).toMatch(/delivery_enabled = 1/);
    expect(sql.taggedCalls[0].text).toMatch(/value_encrypted IS NOT NULL/);

    const byName = Object.fromEntries(result.map((r) => [r.name, r.value]));
    expect(byName).toEqual({ FOO: 'agent-foo', BAR: 'bar-val' });
  });

  it('skips names that are not env-var-safe', async () => {
    const rows = [
      { id: 's1', org_id: 'org_a', agent_id: null, name: 'stripe-prod-key', value_encrypted: encrypt('v', 'org_a:s1') },
      { id: 's2', org_id: 'org_a', agent_id: null, name: 'GOOD_NAME', value_encrypted: encrypt('ok', 'org_a:s2') },
    ];
    const sql = createSqlMock({ taggedResponses: [rows] });
    const result = await getDeliverableSecrets(sql, 'org_a', 'hermes');
    expect(result).toEqual([{ name: 'GOOD_NAME', value: 'ok' }]);
  });
});

describe('clearSecretValue / setDeliveryEnabled', () => {
  it('clearSecretValue nulls value columns', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'sec_1', name: 'X', delivery_enabled: 1 }]] });
    const row = await clearSecretValue(sql, 'org_a', 'sec_1');
    expect(row.id).toBe('sec_1');
    expect(sql.taggedCalls[0].text).toMatch(/value_encrypted = NULL/i);
    expect(sql.taggedCalls[0].text).toMatch(/value_set_at = NULL/i);
  });

  it('setDeliveryEnabled stores integer 0/1', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'sec_1', delivery_enabled: 1 }]] });
    await setDeliveryEnabled(sql, 'org_a', 'sec_1', true);
    expect(sql.taggedCalls[0].values).toContain(1);
  });
});

describe('pre-existing bug fixes', () => {
  it('updateSecret with explicit null notes clears them (no longer a COALESCE no-op)', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'sec_1', notes: null }]] });
    await updateSecret(sql, 'org_a', 'sec_1', { notes: null });
    const call = sql.taggedCalls[0];
    expect(call.text).toMatch(/notes = CASE WHEN/i);
    // Providedness flag true, value null.
    expect(call.values).toContain(true);
  });

  it('updateSecret without notes keeps existing notes (providedness flag false)', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'sec_1' }]] });
    await updateSecret(sql, 'org_a', 'sec_1', { rotationIntervalDays: 30 });
    expect(sql.taggedCalls[0].values).toContain(false);
  });

  it('createSecret rejects negative and zero rotation_interval_days', async () => {
    const sql = createSqlMock();
    await expect(createSecret(sql, 'org_a', { name: 'x', rotationIntervalDays: -5 }))
      .rejects.toThrow(/rotation_interval_days must be >= 1/);
    await expect(createSecret(sql, 'org_a', { name: 'x', rotationIntervalDays: 0 }))
      .rejects.toThrow(/rotation_interval_days must be >= 1/);
  });

  it('createSecret still defaults to 90 when interval omitted', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'sec_1', name: 'x' }]] });
    await createSecret(sql, 'org_a', { name: 'x' });
    expect(sql.taggedCalls[0].values).toContain(90);
  });
});

describe('listSecrets write-only projection', () => {
  it('exposes has_value flag but never selects the raw value_encrypted column', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    await listSecrets(sql, 'org_a', {});
    const text = sql.taggedCalls[0].text;
    expect(text).toMatch(/\(value_encrypted IS NOT NULL\) AS has_value/);
    expect(text).toMatch(/value_set_at, delivery_enabled/);
    // The column itself is never projected bare.
    expect(text).not.toMatch(/value_encrypted\s*,/);
  });
});

describe('isEnvSafeName', () => {
  it('accepts env-var-safe names and rejects others', () => {
    expect(isEnvSafeName('OPENAI_API_KEY')).toBe(true);
    expect(isEnvSafeName('_private')).toBe(true);
    expect(isEnvSafeName('9LEADING_DIGIT')).toBe(false);
    expect(isEnvSafeName('has-dash')).toBe(false);
    expect(isEnvSafeName('A'.repeat(129))).toBe(false);
    expect(isEnvSafeName('')).toBe(false);
  });
});

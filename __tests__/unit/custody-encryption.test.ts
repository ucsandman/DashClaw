import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { decrypt, encrypt } from '@/lib/encryption';
import { generateSigningKey } from '@/lib/integrity/keys';
import { getServerPublicJwks, getServerSigningKey, _resetSigningKeyCacheForTesting } from '@/lib/integrity/server-key';
import { insertWebhook, listWebhooksByOrg } from '@/lib/repositories/webhooks.repository';
import { listPublicJwks } from '@/lib/repositories/signing-keys.repository';

const TEST_ENCRYPTION_KEY = 'unit-test-custody-key-32-bytes!!';

describe('custody encryption', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_ENCRYPTION_KEY);
    _resetSigningKeyCacheForTesting();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetSigningKeyCacheForTesting();
  });

  it('encrypts a newly generated signing private JWK with kid-bound AAD', async () => {
    const sql = createSqlMock({ taggedResponses: [[], [{ kid: 'stored' }]] });

    const key = await getServerSigningKey(sql);

    const insert = sql.taggedCalls.find((call) => /INSERT INTO server_signing_keys/i.test(call.text));
    const storedPrivateJwk = String(insert?.values[3]);
    expect(storedPrivateJwk).toMatch(/^v2:/);
    expect(JSON.parse(decrypt(storedPrivateJwk, `dashclaw:server-signing-key:${key.kid}`) as string).d)
      .toBe(key.privateKeyJwk.d);
  });

  it('decrypts an encrypted signing key row and preserves signing authority', async () => {
    const kp = generateSigningKey('encrypted-kid');
    const aad = `dashclaw:server-signing-key:${kp.kid}`;
    const sql = createSqlMock({ taggedResponses: [[{
      kid: kp.kid,
      alg: 'EdDSA',
      private_jwk: encrypt(JSON.stringify(kp.privateKeyJwk), aad),
      public_jwk: JSON.stringify(kp.publicKeyJwk),
      status: 'active',
    }]] });

    const key = await getServerSigningKey(sql);
    expect(key.privateKeyJwk.d).toBe(kp.privateKeyJwk.d);
  });

  it('refreshes a cached DB key when rotation changes the active kid', async () => {
    const first = generateSigningKey('first-kid');
    const replacement = generateSigningKey('replacement-kid');
    const row = (key: typeof first) => ({
      kid: key.kid,
      alg: 'EdDSA',
      private_jwk: encrypt(
        JSON.stringify(key.privateKeyJwk),
        `dashclaw:server-signing-key:${key.kid}`,
      ),
      public_jwk: JSON.stringify(key.publicKeyJwk),
      status: 'active',
    });
    const sql = createSqlMock({ taggedResponses: [[row(first)], [row(replacement)]] });

    expect((await getServerSigningKey(sql)).kid).toBe('first-kid');
    expect((await getServerSigningKey(sql)).kid).toBe('replacement-kid');
  });

  it('encrypts webhook secrets with org and webhook-bound AAD and decrypts them on retrieval', async () => {
    const sql = createSqlMock();
    const secret = 'fake-webhook-signing-material';

    await insertWebhook(sql, {
      webhookId: 'wh_test', orgId: 'org_test', url: 'https://example.com/hook',
      secret, events: ['all'], userId: 'user_test', now: '2026-09-05T00:00:00.000Z',
    });

    const stored = String(sql.taggedCalls[0]?.values[3]);
    expect(stored).toMatch(/^v2:/);
    expect(stored).not.toContain(secret);

    const readSql = createSqlMock({ taggedResponses: [[{
      id: 'wh_test', org_id: 'org_test', url: 'https://example.com/hook', secret: stored,
      events: '["all"]', active: 1, failure_count: 0,
    }]] });
    const [row] = await listWebhooksByOrg(readSql, 'org_test');
    expect(row?.secret).toBe(secret);
  });

  it('keeps retired public keys trusted for historical verification and removes compromised keys', async () => {
    const active = generateSigningKey('active-kid').publicKeyJwk;
    const retired = generateSigningKey('retired-kid').publicKeyJwk;
    const compromised = generateSigningKey('compromised-kid').publicKeyJwk;
    const sql = createSqlMock({ taggedResponses: [[
      { public_jwk: JSON.stringify(active), status: 'active', retired_at: null, compromised_at: null },
      { public_jwk: JSON.stringify(retired), status: 'retired', retired_at: '2026-09-01T00:00:00Z', compromised_at: null },
      { public_jwk: JSON.stringify(compromised), status: 'compromised', retired_at: null, compromised_at: '2026-09-02T00:00:00Z' },
    ]] });

    const keys = await listPublicJwks(sql);
    expect(keys.map((key: any) => key.kid)).toEqual(['active-kid', 'retired-kid']);
    expect(keys[1]).toMatchObject({ dashclaw_status: 'retired', dashclaw_retired_at: '2026-09-01T00:00:00Z' });
  });

  it('publishes compromised keys only in the public lifecycle manifest', async () => {
    const active = generateSigningKey('active-kid').publicKeyJwk;
    const compromised = generateSigningKey('compromised-kid').publicKeyJwk;
    const sql = createSqlMock({ taggedResponses: [
      [{ public_jwk: JSON.stringify(active), status: 'active' }],
      [
        { kid: 'active-kid', alg: 'EdDSA', status: 'active', created_at: '2026-09-01T00:00:00Z' },
        { kid: 'compromised-kid', alg: 'EdDSA', status: 'compromised', compromised_at: '2026-09-02T00:00:00Z' },
      ],
    ] });

    const jwks = await getServerPublicJwks(sql);
    expect(jwks.keys.map((key) => key.kid)).toEqual(['active-kid']);
    expect(jwks.dashclaw_key_status).toContainEqual(expect.objectContaining({
      kid: 'compromised-kid', status: 'compromised', compromised_at: '2026-09-02T00:00:00Z',
    }));
    expect(JSON.stringify(jwks)).not.toContain(compromised.d);
  });
});

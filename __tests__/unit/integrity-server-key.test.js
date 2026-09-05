import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  getServerSigningKey,
  getServerPublicJwks,
  _resetSigningKeyCacheForTesting,
} from '../../app/lib/integrity/server-key.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';
import { issueReceipt, verifyReceipt } from '../../app/lib/integrity/receipt.js';
import { verify } from '../../app/lib/integrity/verify.js';

const source = {
  requiredFacts: [{ label: 'a', value: 'x' }],
  allowedFacts: [{ label: 'a', value: 'x' }],
  extract: { money: false, dates: false, percentages: false },
};
const ISSUED_AT = '2026-06-01T00:00:00.000Z';

function signAndVerify(key) {
  const r = issueReceipt(verify('x', source), 'x', source, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, ISSUED_AT);
  return verifyReceipt(r, key.publicKeyJwk).ok;
}

beforeEach(() => {
  _resetSigningKeyCacheForTesting();
  vi.stubEnv('ENCRYPTION_KEY', 'unit-test-custody-key-32-bytes!!');
});

afterEach(() => vi.unstubAllEnvs());

describe('getServerSigningKey — hybrid env/DB', () => {
  it('loads an existing key from the DB and it signs a re-verifiable receipt', async () => {
    const kp = generateSigningKey();
    const row = {
      kid: kp.kid,
      alg: 'EdDSA',
      private_jwk: JSON.stringify(kp.privateKeyJwk),
      public_jwk: JSON.stringify(kp.publicKeyJwk),
    };
    const sql = createSqlMock({ taggedResponses: [[row]] });
    const key = await getServerSigningKey(sql);
    expect(key.kid).toBe(kp.kid);
    expect(key.source).toBe('db');
    expect(signAndVerify(key)).toBe(true);
  });

  it('generates and persists a key on a fresh instance (empty DB)', async () => {
    // call 1: getActiveSigningKey -> [] ; call 2: insert ... RETURNING -> [{kid}] (we won the race)
    const sql = createSqlMock({ taggedResponses: [[], [{ kid: 'placeholder' }]] });
    const key = await getServerSigningKey(sql);
    expect(key.kid).toBeTruthy();
    expect(key.source).toBe('db');
    expect(sql.taggedCalls.some((c) => /insert into server_signing_keys/i.test(c.text))).toBe(true);
    expect(signAndVerify(key)).toBe(true);
  });

  it('prefers the DASHCLAW_SIGNING_KEY_JWK env override and never touches the DB', async () => {
    const kp = generateSigningKey('env-kid');
    vi.stubEnv('DASHCLAW_SIGNING_KEY_JWK', JSON.stringify(kp.privateKeyJwk));
    const sql = createSqlMock({ taggedResponses: [] });
    const key = await getServerSigningKey(sql);
    expect(key.source).toBe('env');
    expect(key.kid).toBe('env-kid');
    expect(sql.taggedCalls.length).toBe(0);
    expect(signAndVerify(key)).toBe(true);
  });

  it('fails closed on a malformed env signing key', async () => {
    vi.stubEnv('DASHCLAW_SIGNING_KEY_JWK', '{"kty":"RSA"}');
    const sql = createSqlMock({});
    await expect(getServerSigningKey(sql)).rejects.toThrow();
  });
});

describe('getServerPublicJwks', () => {
  it('publishes the active DB public key and never the private half', async () => {
    const kp = generateSigningKey();
    const sql = createSqlMock({ taggedResponses: [[{ public_jwk: JSON.stringify(kp.publicKeyJwk) }]] });
    const jwks = await getServerPublicJwks(sql);
    expect(jwks.keys.length).toBe(1);
    expect(jwks.keys[0].kid).toBe(kp.kid);
    expect(jwks.keys[0].d).toBeUndefined();
  });

  it('publishes the env public key (public half only)', async () => {
    const kp = generateSigningKey('env-kid');
    vi.stubEnv('DASHCLAW_SIGNING_KEY_JWK', JSON.stringify(kp.privateKeyJwk));
    const sql = createSqlMock({ taggedResponses: [[]] });
    const jwks = await getServerPublicJwks(sql);
    expect(jwks.keys.some((k) => k.kid === 'env-kid')).toBe(true);
    expect(jwks.keys.every((k) => k.d === undefined)).toBe(true);
  });
});

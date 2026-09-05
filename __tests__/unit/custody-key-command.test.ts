import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertCompromiseHasReplacement,
  assertCustodyMutationAuthorized,
  parseCustodyArgs,
  runCustodyCommand,
} from '../../scripts/custody-keys.mjs';
import { createSqlMock } from '../helpers.js';

afterEach(() => vi.unstubAllEnvs());

describe('custody key command safety', () => {
  it('defaults to a read-only plan', () => {
    expect(parseCustodyArgs([])).toMatchObject({ apply: false, rotateSigningKey: false });
  });

  it('requires an exact confirmation before rewriting stored secret material', () => {
    expect(() => assertCustodyMutationAuthorized({
      apply: true, allowProduction: false, nodeEnv: 'development', confirm: '',
    })).toThrow(/confirmation/i);
  });

  it('requires an additional explicit flag for a production target', () => {
    expect(() => assertCustodyMutationAuthorized({
      apply: true,
      allowProduction: false,
      nodeEnv: 'production',
      confirm: 'ENCRYPT_CUSTODY_MATERIAL',
    })).toThrow(/production/i);
  });

  it('will not compromise the active issuer without rotating a replacement', () => {
    expect(() => assertCompromiseHasReplacement({
      compromiseKid: 'kid_old', rotateSigningKey: false,
    })).toThrow(/replacement/i);
  });

  it('rewrites plaintext rows with compare-and-swap updates without returning material', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'unit-test-custody-key-32-bytes!!');
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'wh_1', org_id: 'org_1', secret: 'fake-webhook-secret' }],
      [{ kid: 'kid_1', private_jwk: '{"kty":"OKP","d":"fake"}', status: 'active' }],
      [{ id: 'wh_1' }],
      [{ kid: 'kid_1' }],
    ] });

    const result = await runCustodyCommand({
      argv: ['--apply', '--confirm', 'ENCRYPT_CUSTODY_MATERIAL'],
      env: { NODE_ENV: 'development' },
      sql,
    });

    expect(result).toMatchObject({ webhooks_encrypted: 1, signing_keys_encrypted: 1 });
    expect(JSON.stringify(result)).not.toContain('fake-webhook-secret');
    const taggedCalls = (sql as unknown as { taggedCalls: Array<{ text: string }> }).taggedCalls;
    expect(taggedCalls[2]?.text).toMatch(/WHERE id = \?.*secret = \?/s);
    expect(taggedCalls[3]?.text).toMatch(/WHERE kid = \?.*private_jwk = \?/s);
  });
});

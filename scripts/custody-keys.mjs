#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const CUSTODY_CONFIRMATION = 'ENCRYPT_CUSTODY_MATERIAL';

export function parseCustodyArgs(argv) {
  const args = {
    apply: false,
    rotateSigningKey: false,
    compromiseKid: null,
    allowProduction: false,
    confirm: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--rotate-signing-key') args.rotateSigningKey = true;
    else if (arg === '--allow-production') args.allowProduction = true;
    else if (arg === '--compromise-kid') args.compromiseKid = argv[++i] || null;
    else if (arg === '--confirm') args.confirm = argv[++i] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function assertCustodyMutationAuthorized({ apply, allowProduction, nodeEnv, confirm }) {
  if (!apply) return;
  if (confirm !== CUSTODY_CONFIRMATION) {
    throw new Error(`Mutation confirmation required: --confirm ${CUSTODY_CONFIRMATION}`);
  }
  if (nodeEnv === 'production' && !allowProduction) {
    throw new Error('Production custody changes require the explicit --allow-production flag');
  }
}

export function assertCompromiseHasReplacement({ compromiseKid, rotateSigningKey }) {
  if (compromiseKid && !rotateSigningKey) {
    throw new Error('Marking a key compromised requires --rotate-signing-key so an active replacement is installed first');
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('v2:');
}

async function inventory(sql) {
  const webhooks = await sql`SELECT id, org_id, secret FROM webhooks ORDER BY id`;
  const signingKeys = await sql`SELECT kid, private_jwk, status FROM server_signing_keys ORDER BY created_at`;
  return {
    webhooks,
    signingKeys,
    plaintextWebhookCount: webhooks.filter((row) => !isEncrypted(row.secret)).length,
    plaintextSigningKeyCount: signingKeys.filter((row) => !isEncrypted(row.private_jwk)).length,
  };
}

async function rewriteLegacyMaterial(sql, snapshot, encrypt, webhookSecretAad) {
  let webhooksEncrypted = 0;
  let signingKeysEncrypted = 0;

  for (const row of snapshot.webhooks) {
    if (isEncrypted(row.secret)) continue;
    const encrypted = encrypt(row.secret, webhookSecretAad(row.org_id, row.id));
    const updated = await sql`
      UPDATE webhooks SET secret = ${encrypted}
      WHERE id = ${row.id} AND org_id = ${row.org_id} AND secret = ${row.secret}
      RETURNING id
    `;
    webhooksEncrypted += updated.length;
  }

  for (const row of snapshot.signingKeys) {
    if (isEncrypted(row.private_jwk)) continue;
    const encrypted = encrypt(row.private_jwk, `dashclaw:server-signing-key:${row.kid}`);
    const updated = await sql`
      UPDATE server_signing_keys SET private_jwk = ${encrypted}
      WHERE kid = ${row.kid} AND private_jwk = ${row.private_jwk}
      RETURNING kid
    `;
    signingKeysEncrypted += updated.length;
  }

  return { webhooksEncrypted, signingKeysEncrypted };
}

/**
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv, sql?: any }} [options]
 */
export async function runCustodyCommand({ argv = process.argv.slice(2), env = process.env, sql: suppliedSql } = {}) {
  const args = parseCustodyArgs(argv);
  assertCustodyMutationAuthorized({ ...args, nodeEnv: env.NODE_ENV || 'development' });
  assertCompromiseHasReplacement(args);

  const ownsSql = !suppliedSql;
  const sql = suppliedSql || (await import('./_db.mjs')).createSqlFromEnv();
  try {
    const snapshot = await inventory(sql);
    const result = {
      mode: args.apply ? 'apply' : 'plan',
      plaintext_webhooks: snapshot.plaintextWebhookCount,
      plaintext_signing_keys: snapshot.plaintextSigningKeyCount,
      webhooks_encrypted: 0,
      signing_keys_encrypted: 0,
      signing_key_rotated: false,
      compromised_key_marked: false,
    };

    if (!args.apply) return result;

    const { encrypt } = await import('../app/lib/encryption.ts');
    const { webhookSecretAad } = await import('../app/lib/repositories/webhooks.repository.ts');
    const { rotateSigningKey } = await import('../app/lib/repositories/signing-keys.repository.ts');
    const { generateSigningKey } = await import('../app/lib/integrity/keys.ts');

    const rewritten = await rewriteLegacyMaterial(sql, snapshot, encrypt, webhookSecretAad);
    result.webhooks_encrypted = rewritten.webhooksEncrypted;
    result.signing_keys_encrypted = rewritten.signingKeysEncrypted;

    if (args.rotateSigningKey) {
      const key = generateSigningKey();
      const rotatedAt = new Date().toISOString();
      const privateJwk = encrypt(
        JSON.stringify(key.privateKeyJwk),
        `dashclaw:server-signing-key:${key.kid}`,
      );
      result.signing_key_rotated = await rotateSigningKey(sql, {
        kid: key.kid,
        privateJwk,
        publicJwk: JSON.stringify(key.publicKeyJwk),
        rotatedAt,
        compromiseKid: args.compromiseKid,
        compromisedAt: args.compromiseKid ? rotatedAt : null,
      });
      result.compromised_key_marked = Boolean(args.compromiseKid && result.signing_key_rotated);
    }
    return result;
  } finally {
    if (ownsSql) await sql.end?.({ timeout: 5 });
  }
}

async function main() {
  try {
    const result = await runCustodyCommand();
    console.log(`[custody-keys] ${JSON.stringify(result)}`);
    if (result.mode === 'plan' && (result.plaintext_webhooks > 0 || result.plaintext_signing_keys > 0)) {
      console.log(`[custody-keys] Re-run with --apply --confirm ${CUSTODY_CONFIRMATION} after reviewing the deployment runbook.`);
    }
  } catch (error) {
    console.error(`[custody-keys] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();

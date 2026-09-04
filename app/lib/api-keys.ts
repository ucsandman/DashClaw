// Shared API key helpers: hashing for storage/lookup and generation of new
// raw keys. Node crypto only — see app/api/setup/ping/route.ts for the
// deliberately separate async WebCrypto variant.
import crypto from 'crypto';

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `oc_live_${random}`;
}

/**
 * JWKS-based JWT verifier for agent identity (Phase 2).
 *
 * Provider-agnostic: reads the issuer from the JWT's `iss` claim and fetches
 * JWKS from `{iss}/.well-known/jwks.json` (standard OIDC discovery path).
 *
 * Supported algorithms: EdDSA (Ed25519), RS256/384/512, ES256/384/512.
 *
 * Configuration (env vars — no YAML required):
 *   DASHCLAW_ALLOWED_ISSUER  — REQUIRED for verification (v3.7, 2026-07-04):
 *                              unset → every bearer token resolves `unverified`
 *                              (fail-closed; previously any issuer with a
 *                              reachable JWKS was accepted). Set it to enable
 *                              verified identity; other issuers → unknown_issuer
 *   DASHCLAW_JWT_AUDIENCE    — if set, the `aud` claim must include this value
 *
 * Resilience: 1-hour per-process JWKS cache, 3-failure/30s circuit breaker,
 * 5s fetch timeout, SSRF defense via app/lib/url-safety.js, fail-soft to
 * `unverified` on any infrastructure error.
 */

import { assertSafeFetchUrl } from './url-safety';
import { parseActBinding } from './act-binding';
import type { VerificationStatus } from './types/identity';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CB_FAILURE_THRESHOLD = 3;
const CB_OPEN_MS = 30_000; // 30 s
const FETCH_TIMEOUT_MS = 5_000; // 5 s

type Jwk = Record<string, unknown>;

interface CircuitBreakerState {
  open: boolean;
  openUntil: number;
  failures: number;
}

interface JwtVerificationResult {
  verification_status: VerificationStatus;
  agent_id: string | null;
  agent_name: string | null;
  issuer: string | null;
  jti: string | null;
  exp: number | null;
  act?: { typ: string; hash: string } | null;
  act_typ_supported?: boolean;
}

const jwksCache = new Map<string, { keys: Jwk[]; expiresAt: number }>();
const circuitBreakers = new Map<string, CircuitBreakerState>();

function getCircuitBreaker(issuer: string): CircuitBreakerState {
  return circuitBreakers.get(issuer) ?? { open: false, openUntil: 0, failures: 0 };
}

/** Fetch JWKS keys for a given issuer, with cache and circuit breaker. */
async function fetchJwks(issuer: string): Promise<Jwk[]> {
  const cb = getCircuitBreaker(issuer);
  if (cb.open && Date.now() < cb.openUntil) {
    throw Object.assign(new Error('circuit_open'), { code: 'CIRCUIT_OPEN' });
  }

  const cached = jwksCache.get(issuer);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.keys;
  }

  const jwksUrl = `${issuer}/.well-known/jwks.json`;

  // SSRF defense — assertSafeFetchUrl throws 'UNSAFE_URL' (treated as a
  // network-class failure → fail-soft to 'unverified').
  await assertSafeFetchUrl(jwksUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(jwksUrl, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    const keys: Jwk[] = body.keys ?? [];

    // Don't cache an empty key set: a rolling deploy that briefly returns
    // no keys would otherwise DoS verification for the cache TTL.
    if (keys.length > 0) {
      jwksCache.set(issuer, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    circuitBreakers.set(issuer, { open: false, openUntil: 0, failures: 0 });
    return keys;
  } catch (err) {
    const prev = getCircuitBreaker(issuer);
    const failures = prev.failures + 1;
    if (failures >= CB_FAILURE_THRESHOLD) {
      circuitBreakers.set(issuer, { open: true, openUntil: Date.now() + CB_OPEN_MS, failures });
    } else {
      circuitBreakers.set(issuer, { ...prev, failures });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Decode a base64url-encoded string to a Buffer. */
function b64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return Buffer.from(pad ? padded + '='.repeat(4 - pad) : padded, 'base64');
}

/** Split a JWT into its parsed header, payload, signature, and signing input. */
function parseJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signature: Buffer; signingInput: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid_jwt_format');
  const [p0, p1, p2] = parts as [string, string, string];

  const header = JSON.parse(b64urlDecode(p0).toString('utf8')) as Record<string, unknown>;
  const payload = JSON.parse(b64urlDecode(p1).toString('utf8')) as Record<string, unknown>;
  const signature = b64urlDecode(p2);
  const signingInput = Buffer.from(`${p0}.${p1}`);

  return { header, payload, signature, signingInput };
}

/** Import a JWK into a WebCrypto CryptoKey for verification. */
async function importJwk(jwk: Jwk, alg: string): Promise<CryptoKey> {
  const { subtle } = globalThis.crypto;

  if (alg === 'EdDSA' || jwk.crv === 'Ed25519') {
    return subtle.importKey('jwk', jwk as JsonWebKey, { name: 'Ed25519' }, false, ['verify']);
  }
  if (alg === 'RS256' || alg === 'RS384' || alg === 'RS512') {
    const hash = alg === 'RS256' ? 'SHA-256' : alg === 'RS384' ? 'SHA-384' : 'SHA-512';
    return subtle.importKey('jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  }
  if (alg === 'ES256' || alg === 'ES384' || alg === 'ES512') {
    const hash = alg === 'ES256' ? 'SHA-256' : alg === 'ES384' ? 'SHA-384' : 'SHA-512';
    const namedCurve = (jwk.crv as string | undefined) ?? (alg === 'ES256' ? 'P-256' : alg === 'ES384' ? 'P-384' : 'P-521');
    return subtle.importKey('jwk', jwk as JsonWebKey, { name: 'ECDSA', namedCurve }, false, ['verify']);
  }
  throw new Error(`unsupported_algorithm: ${alg}`);
}

/** Verify a JWT signature against an imported CryptoKey. */
async function verifySignature(key: CryptoKey, alg: string, signingInput: Buffer, signature: Buffer): Promise<boolean> {
  const { subtle } = globalThis.crypto;
  // Copy into fresh Uint8Arrays so the type is BufferSource (Uint8Array<ArrayBuffer>);
  // Node's Buffer<ArrayBufferLike> is not assignable to WebCrypto's BufferSource.
  const sig = new Uint8Array(signature);
  const data = new Uint8Array(signingInput);

  if (alg === 'EdDSA') {
    return subtle.verify('Ed25519', key, sig, data);
  }
  if (alg.startsWith('RS')) {
    return subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  }
  if (alg.startsWith('ES')) {
    const hash = alg === 'ES256' ? 'SHA-256' : alg === 'ES384' ? 'SHA-384' : 'SHA-512';
    return subtle.verify({ name: 'ECDSA', hash }, key, sig, data);
  }
  return false;
}

// Read env config at call time so tests can override process.env per-test.
function getAllowedIssuer(): string | null { return process.env.DASHCLAW_ALLOWED_ISSUER || null; }
function getJwtAudience(): string | null { return process.env.DASHCLAW_JWT_AUDIENCE || null; }

// Phase 2b: cap on accepted `exp`. Default 24h matches the Phase 2b design in #120.
function getMaxTtlSeconds(): number {
  const raw = parseInt(process.env.DASHCLAW_JTI_MAX_TTL_SECONDS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 86400;
}

// ±60s clock skew on the exp_too_far gate.
const CLOCK_SKEW_SECONDS = 60;

/**
 * Reset module-level cache and circuit breaker state.
 * Exported for unit tests only — do not call in production code.
 * @internal
 */
export function _resetStateForTesting(): void {
  jwksCache.clear();
  circuitBreakers.clear();
}

/**
 * Verify a JWT bearer token against JWKS.
 *
 * Returns `unverified` (not `failed`) whenever the failure is infrastructure-
 * related (network error, JWKS timeout, open circuit breaker).
 */
export async function verifyJwt(token: string): Promise<JwtVerificationResult> {
  let issuer: string | null = null;
  let jti: string | null = null;
  let exp: number | null = null;

  try {
    const { header, payload, signature, signingInput } = parseJwt(token);
    issuer = typeof payload.iss === 'string' ? payload.iss : null;
    jti = typeof payload.jti === 'string' ? payload.jti : null;
    exp = typeof payload.exp === 'number' ? payload.exp : null;

    const sub = (payload.sub as string | undefined) || null;
    const agentName = (payload.agent_name as string | undefined) || null;
    const alg = header.alg as string;

    // Issuer trust is opt-in and fail-closed (v3.7, 2026-07-04): with no
    // configured issuer there is no trust anchor, so no token can reach
    // `verified` — otherwise any party standing up a reachable JWKS could
    // mint "verified" identity for arbitrary agent_ids. Flipped while the
    // verified fleet was empty (same evidence as the v3.6 default flips), so
    // no existing traffic changed behavior. Enabling verification is the same
    // single env var it always was: DASHCLAW_ALLOWED_ISSUER.
    const allowedIssuer = getAllowedIssuer();
    if (!allowedIssuer) {
      return { verification_status: 'unverified', agent_id: null, agent_name: null, issuer, jti, exp };
    }
    if (issuer !== allowedIssuer) {
      return { verification_status: 'unknown_issuer', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    if (!issuer) {
      return { verification_status: 'failed', agent_id: null, agent_name: null, issuer: null, jti, exp };
    }

    // Check expiry before hitting JWKS — fast path, no network
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) {
      return { verification_status: 'expired', agent_id: sub, agent_name: agentName, issuer, jti, exp };
    }

    // Phase 2b: reject tokens with exp more than maxTtl in the future.
    if (typeof payload.exp === 'number' && payload.exp > now + getMaxTtlSeconds() + CLOCK_SKEW_SECONDS) {
      return { verification_status: 'exp_too_far', agent_id: sub, agent_name: agentName, issuer, jti, exp };
    }

    // Honor `nbf` (not-before).
    if (typeof payload.nbf === 'number' && payload.nbf > now) {
      return { verification_status: 'failed', agent_id: sub, agent_name: agentName, issuer, jti, exp };
    }

    // Fetch JWKS (cached; circuit breaker on repeated failures)
    const keys = await fetchJwks(issuer);

    // Filter to verification-capable keys before matching.
    const sigKeys = keys.filter((k) => k.use === 'sig' || !k.use);

    // Find the correct key — prefer matching by kid, fall back to alg.
    const jwk = header.kid
      ? sigKeys.find((k) => k.kid === header.kid)
      : sigKeys.find((k) => k.alg === header.alg);

    if (!jwk) {
      return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    // Verify cryptographic signature
    const cryptoKey = await importJwk(jwk, alg);
    const valid = await verifySignature(cryptoKey, alg, signingInput, signature);
    if (!valid) {
      return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    // Validate audience (optional — only when env var is set)
    const jwtAudience = getJwtAudience();
    if (jwtAudience) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(jwtAudience)) {
        return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
      }
    }

    // Phase 2c (issue #121): extract the action-binding claim now that the
    // signature is trusted.
    const { act, actTypSupported } = parseActBinding(payload);

    return {
      verification_status: 'verified',
      agent_id: sub,
      agent_name: agentName,
      issuer,
      jti,
      exp,
      act,
      act_typ_supported: actTypSupported,
    };
  } catch (err) {
    const e = err as { code?: string; name?: string; message?: string };
    // Infrastructure failures → unverified (fail-soft, not failed)
    if (
      e.code === 'CIRCUIT_OPEN' ||
      e.code === 'UNSAFE_URL' ||
      e.name === 'AbortError' ||
      e.code === 'ECONNREFUSED' ||
      e.code === 'ENOTFOUND' ||
      e.code === 'ECONNRESET' ||
      e.message?.includes('JWKS fetch failed')
    ) {
      return { verification_status: 'unverified', agent_id: null, agent_name: null, issuer, jti, exp };
    }

    // Token-level errors (bad format, bad signature) → failed
    console.warn('[JWKS] JWT verification failed:', e.message);
    return { verification_status: 'failed', agent_id: null, agent_name: null, issuer, jti, exp };
  }
}

/**
 * True when a bearer string is shaped like a JWT (three base64url segments).
 *
 * The Authorization header carries two different things in DashClaw: an agent
 * IDENTITY claim (a JWT the caller wants verified — `DashClawClient.authToken`)
 * and a plain CREDENTIAL (the built-in OAuth AS issues opaque `oat_` access
 * tokens, which `/api/mcp` forwards downstream for the Claude consumer-app
 * connector). Only the first is an identity claim, so only the first can
 * meaningfully fail verification: running an opaque credential through
 * `verifyJwt` can only ever return `failed` — the label reserved for a
 * REJECTED identity claim — which permanently mislabels every
 * OAuth-authenticated decision in the ledger.
 *
 * A JWT-shaped token that does not verify is still `failed`; an `alg: none`
 * token (empty signature segment) is a claim attempt and stays JWT-shaped.
 */
export function looksLikeJwt(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header = '', payload = '', signature = ''] = parts;
  const base64url = /^[A-Za-z0-9_-]*$/;
  return header.length > 0 && payload.length > 0
    && base64url.test(header) && base64url.test(payload) && base64url.test(signature);
}

/**
 * Extract the raw token string from an Authorization header value.
 * Returns null if the header is missing or not a Bearer token.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  return token !== undefined ? token.trim() : null;
}

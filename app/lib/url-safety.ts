/**
 * URL safety helpers for server-side outbound fetches.
 *
 * Used by any handler that fetches a URL whose host is influenced by
 * untrusted input (JWT `iss` claims, webhook URLs from settings, etc.).
 * Defends against SSRF to internal services (cloud metadata endpoints,
 * loopback, RFC1918 private networks, link-local) and DNS rebinding.
 *
 * Used by `app/api/settings/test/route.js` (connection tests) and
 * `app/lib/jwks-verifier.js` (JWT issuer JWKS fetch). This is the
 * single source of truth — never copy/paste the regex elsewhere.
 */

import dnsModule from 'node:dns/promises';
import net from 'node:net';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';

type DnsLookup = typeof dnsModule.lookup;

/** Error carrying the SSRF/URL-safety failure code. */
interface UnsafeUrlError extends Error {
  code?: string;
  cause?: unknown;
}

/**
 * Match common private / reserved IPv4 + IPv6 hostnames as literals.
 * Mirrors the regex in app/api/settings/test/route.js so behavior is
 * consistent across the codebase. NOTE: this is a literal-IP check —
 * it does NOT resolve hostnames. Combine with DNS resolution + per-IP
 * check to defeat DNS rebinding (see assertSafeFetchUrl below).
 */
const PRIVATE_HOSTNAME_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|localhost|::1|\[::1\])/i;

export function isPrivateIP(hostname: string): boolean {
  return PRIVATE_HOSTNAME_RE.test(hostname);
}

/**
 * Parse a URL and check protocol + hostname literal. Shared by
 * assertSafeFetchUrl and safeFetch so both apply the identical checks.
 */
function parseHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    const err: UnsafeUrlError = new Error('invalid_url');
    err.code = 'UNSAFE_URL';
    throw err;
  }

  if (parsed.protocol !== 'https:') {
    const err: UnsafeUrlError = new Error(`non_https_url: ${parsed.protocol}`);
    err.code = 'UNSAFE_URL';
    throw err;
  }

  if (isPrivateIP(parsed.hostname)) {
    const err: UnsafeUrlError = new Error(`private_hostname: ${parsed.hostname}`);
    err.code = 'UNSAFE_URL';
    throw err;
  }

  return parsed;
}

/**
 * DNS rebinding defense: resolve hostname and check every returned IP. A
 * malicious domain can be configured to resolve to 127.0.0.1 even though
 * its name doesn't look private. Returns the validated addresses so a
 * caller can pin a fetch's connect-time resolution to them (see safeFetch)
 * instead of letting fetch re-resolve the hostname itself.
 */
async function resolveSafeAddresses(hostname: string, dnsLookup: DnsLookup): Promise<string[]> {
  let addresses;
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch (err) {
    // DNS resolution failure is treated as unsafe — we cannot prove the
    // host is public. Tag with UNSAFE_URL so callers handle it uniformly.
    const e: UnsafeUrlError = new Error(`dns_lookup_failed: ${(err as Error).message}`);
    e.code = 'UNSAFE_URL';
    e.cause = err;
    throw e;
  }
  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      const err: UnsafeUrlError = new Error(`private_ip_after_dns: ${hostname} → ${address}`);
      err.code = 'UNSAFE_URL';
      throw err;
    }
  }
  return addresses.map(({ address }) => address);
}

/**
 * Assert that a URL is safe to fetch from a server-side handler.
 *
 *   - Protocol must be `https:` (rejects http:, file:, gopher:, data:, etc.)
 *   - Hostname literal must not be a private/reserved IP or loopback alias
 *   - DNS resolution must not return a private IP (DNS-rebinding defense)
 *
 * Throws an Error with `code: 'UNSAFE_URL'` on any failure. Callers that
 * need fail-soft behavior (e.g. the JWKS verifier) should catch and treat
 * UNSAFE_URL the same way they'd treat a network failure.
 *
 * NOTE: this only proves the hostname was safe to resolve *at call time*.
 * A caller that later does its own plain `fetch(url)` re-resolves DNS at
 * connect time and gets no rebinding protection from having called this
 * first — use `safeFetch` below, which pins the connection to the
 * addresses validated here.
 *
 * @param url
 * @param options
 *   `dnsLookup` is injectable for tests (so they don't hit real DNS).
 *   Defaults to `node:dns/promises`'s `lookup`.
 */
export async function assertSafeFetchUrl(
  url: string,
  { dnsLookup = dnsModule.lookup }: { dnsLookup?: DnsLookup } = {},
): Promise<void> {
  const parsed = parseHttpsUrl(url);
  await resolveSafeAddresses(parsed.hostname, dnsLookup);
}

/**
 * Build an undici dispatcher that pins DNS resolution to the pre-validated
 * IPs from resolveSafeAddresses. Local equivalent of buildPinnedDispatcher
 * in app/lib/webhooks.ts (that module owns webhook dispatch, not generic
 * URL safety, so this stays a self-contained copy rather than a cross-import).
 * Closes the DNS-rebinding window between our lookup and fetch's own
 * connect-time resolution — a short-TTL attacker-controlled DNS record
 * can't flip to a private address between the two calls because fetch
 * never re-resolves once the dispatcher is pinned.
 */
function buildPinnedDispatcher(validatedIps: string[]): UndiciAgent | undefined {
  if (validatedIps.length === 0) return undefined;
  // The undici `connect.lookup` override expects a net.LookupFunction; cast
  // through unknown to bridge our simpler implementation to that overloaded
  // signature without altering runtime behavior.
  const lookup = ((
    _hostname: string,
    options: { all?: boolean; family?: number } | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ): void => {
    if (options?.all) {
      callback(null, validatedIps.map((ip) => ({ address: ip, family: net.isIP(ip) || 4 })));
      return;
    }
    const first = validatedIps[0] as string;
    const family = net.isIP(first);
    callback(null, first, family || (options?.family ?? 4));
  }) as unknown as net.LookupFunction;

  return new UndiciAgent({ connect: { lookup } });
}

/**
 * Drop-in replacement for `fetch()` that validates the URL, then pins the
 * connection to the validated IPs and disables auto-redirect (so a 30x
 * response can't redirect to a private host that bypasses the check).
 *
 * Earlier version called assertSafeFetchUrl and then plain `fetch(url,
 * ...)`, which performs its OWN independent DNS resolution at connect
 * time — an attacker-controlled domain with a short TTL could pass the
 * validation lookup and then resolve to 127.0.0.1 or the cloud metadata
 * IP on fetch's own lookup a moment later. Pinning the dispatcher to the
 * addresses we already validated closes that window.
 *
 * Throws `code: 'UNSAFE_URL'` on any safety failure; otherwise returns
 * a Response object identical to native fetch.
 *
 * @param url
 * @param options
 */
export async function safeFetch(
  url: string,
  { dnsLookup = dnsModule.lookup, ...fetchOptions }: RequestInit & { dnsLookup?: DnsLookup } = {},
): Promise<Response> {
  const parsed = parseHttpsUrl(url);
  const addresses = await resolveSafeAddresses(parsed.hostname, dnsLookup);
  const dispatcher = buildPinnedDispatcher(addresses);

  return (await undiciFetch(url, {
    ...(fetchOptions as Record<string, unknown>),
    // Both set AFTER the caller's ...fetchOptions spread so a caller-supplied
    // `redirect` or `dispatcher` option can't override the SSRF defenses.
    redirect: 'manual', // Defense: prevent SSRF via redirect chain
    dispatcher,
  } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}

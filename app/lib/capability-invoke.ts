/**
 * Capability invocation engine.
 * Handles auth resolution, HTTP calls with timeout, retry with backoff,
 * and request/response mapping.
 */

import { mapRequest, mapResponse } from './mapping';
import { safeUrlWithIps, buildPinnedDispatcher } from './webhooks';
// Use undici's fetch rather than the Node global. The global fetch is backed by
// Node's *internal* undici (v5/v6 on Node < 24), a different instance than the
// standalone `undici` package that buildPinnedDispatcher's Agent comes from.
// Handing a v7 Agent to the global fetch as `dispatcher` throws a bare
// "TypeError: fetch failed" with no .cause — exactly the opaque error operators
// saw on "Run test". Importing fetch from undici keeps fetch + Agent on the
// same instance. Mirrors the existing undici import in webhooks.ts.
import { fetch } from 'undici';

export const RISK_SCORE_MAP: Record<string, number> = {
  low: 20,
  medium: 50,
  high: 75,
  critical: 95,
};

const DEFAULT_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Reject `work` as soon as `signal` fires. fetch resolves once the HEADERS
 * arrive — the body is still an open stream — so the invocation timeout has to
 * cover the body read as well, or an endpoint that answers 200 and then
 * trickles bytes hangs the call forever. webhooks.ts carries the same helper
 * for the delivery path; kept local here so this module's dependency on
 * webhooks stays the SSRF pair.
 */
function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fail = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', fail));
  });
}

interface AuthConfig {
  type?: string;
  token_setting?: string;
}

export function resolveAuth(auth: AuthConfig | null | undefined, settings: Record<string, string | undefined>): Record<string, string> {
  if (!auth || auth.type === 'none') return {};

  const tokenKey = auth.token_setting;
  if (!tokenKey) return {};

  const token = settings[tokenKey];
  if (!token) {
    const err = new Error(`auth_not_configured: setting '${tokenKey}' not configured for this capability`) as Error & { code?: string };
    err.code = 'auth_not_configured';
    throw err;
  }

  if (auth.type === 'bearer') {
    return { Authorization: `Bearer ${token}` };
  }
  if (auth.type === 'api_key') {
    return { 'x-api-key': token };
  }
  return {};
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateBackoffDelay(attempt: number, backoff: string | null | undefined, baseDelayMs: number, maxDelayMs: number): number {
  if (!backoff || backoff === 'none') return 0;
  if (backoff === 'fixed') return baseDelayMs;
  // exponential: base * 2^attempt with jitter, capped at max
  const delay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.1;
  return Math.min(Math.floor(delay + jitter), maxDelayMs);
}

interface AttemptResult {
  success: boolean;
  error?: string;
  status?: number;
  message?: string;
  data?: unknown;
  raw?: unknown;
  elapsed_ms: number;
  retry_metadata?: {
    total_attempts: number;
    retried: boolean;
    attempts: AttemptLogEntry[];
  };
}

interface AttemptLogEntry {
  attempt: number;
  success?: boolean;
  error?: string;
  status?: number;
  elapsed_ms: number;
}

interface RetryPolicy {
  max_retries?: number;
  backoff?: string;
  base_delay_ms?: number;
  max_delay_ms?: number;
  retryable_status_codes?: number[];
}

interface SingleAttemptParams {
  endpoint: string;
  method?: string;
  authHeaders?: Record<string, string>;
  body?: unknown;
  requestMapping?: unknown;
  responseMapping?: unknown;
  timeoutMs?: number;
}

interface InvokeCapabilityParams extends SingleAttemptParams {
  retryPolicy?: RetryPolicy | null;
}

export function isRetryableResult(result: AttemptResult, retryableStatusCodes: Set<number>): boolean {
  if (result.success) return false;
  if (result.error === 'capability_timeout') return true;
  if (result.error === 'capability_network_error') return true;
  if (result.error === 'capability_error' && result.status !== undefined && retryableStatusCodes.has(result.status)) return true;
  return false;
}

async function singleAttempt({
  endpoint,
  method,
  authHeaders,
  body,
  requestMapping,
  responseMapping,
  timeoutMs,
}: SingleAttemptParams): Promise<AttemptResult> {
  // body is the capability payload object at runtime; mapRequest passes it
  // through unchanged when there's no mapping.
  const mappedBody = mapRequest(body as Record<string, unknown>, requestMapping);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 60000);
  const start = Date.now();

  // GET and HEAD cannot carry a request body per the fetch/undici spec.
  // Attaching one causes an immediate "Request with GET/HEAD method cannot
  // have body" TypeError before the request ever leaves the process.
  const normalizedMethod = (method || 'POST').toUpperCase();
  const bodylessMethod = normalizedMethod === 'GET' || normalizedMethod === 'HEAD';

  try {
    // SSRF defense: capability endpoints come from operator-configured DB rows
    // (admins can PATCH them). Validate https://, reject private/loopback IPs,
    // and pin DNS resolution to a public IP so a rebinding attacker cannot swap
    // the address mid-flight. Mirrors the pattern used in webhooks.js.
    const validatedIps = await safeUrlWithIps(endpoint);
    const dispatcher = buildPinnedDispatcher(validatedIps);

    const response = await fetch(endpoint, {
      method: normalizedMethod,
      redirect: 'manual', // SECURITY: prevent SSRF via redirect chain
      headers: {
        ...(bodylessMethod ? {} : { 'Content-Type': 'application/json' }),
        ...authHeaders,
      },
      ...(bodylessMethod ? {} : { body: JSON.stringify(mappedBody) }),
      signal: controller.signal,
      dispatcher,
    } as Parameters<typeof fetch>[1]);

    // The timer stays armed through the body read: fetch resolves on headers,
    // so clearing it here left an endpoint that answers 200 and then trickles
    // body bytes able to hang the invocation forever (see withAbort above).
    const elapsedMs = Date.now() - start;

    if (!response.ok) {
      const errorText = await withAbort(response.text(), controller.signal).catch(() => 'Unknown error');
      return {
        success: false,
        error: 'capability_error',
        status: response.status,
        message: errorText.slice(0, 500),
        elapsed_ms: elapsedMs,
      };
    }

    // undici's fetch types response.json() as Promise<unknown> (the DOM global
    // typed it any); annotate so mapResponse still type-checks after the import.
    const rawData = await withAbort(response.json(), controller.signal)
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') throw err;
        return null;
      }) as Record<string, unknown> | null;
    if (rawData === null) {
      return {
        success: false,
        error: 'capability_response_invalid',
        message: 'Capability returned a non-JSON response',
        elapsed_ms: elapsedMs,
      };
    }
    const data = mapResponse(rawData, responseMapping);

    return {
      success: true,
      data,
      raw: rawData,
      elapsed_ms: elapsedMs,
    };
  } catch (err) {
    const elapsedMs = Date.now() - start;

    if ((err as Error)?.name === 'AbortError') {
      return {
        success: false,
        error: 'capability_timeout',
        message: `Capability timed out after ${timeoutMs || 60000}ms`,
        elapsed_ms: elapsedMs,
      };
    }

    // undici raises a bare "fetch failed" TypeError for any connection-layer
    // failure and puts the actionable detail on err.cause (ENOTFOUND /
    // ECONNREFUSED / ETIMEDOUT / UND_ERR_* / TLS cert errors). Surface it so
    // the operator sees WHY (DNS, egress, TLS) instead of an opaque message.
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const detail = cause?.code || cause?.message;
    const message = detail ? `${(err as Error).message} (${detail})` : (err as Error).message;
    return {
      success: false,
      error: 'capability_network_error',
      message,
      elapsed_ms: elapsedMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeCapability({
  endpoint,
  method,
  authHeaders,
  body,
  requestMapping,
  responseMapping,
  timeoutMs,
  retryPolicy,
}: InvokeCapabilityParams): Promise<AttemptResult | undefined> {
  const maxRetries = retryPolicy?.max_retries || 0;

  // Fast path: no retries configured — identical to previous behavior
  if (maxRetries === 0) {
    return singleAttempt({ endpoint, method, authHeaders, body, requestMapping, responseMapping, timeoutMs });
  }

  const backoff = retryPolicy!.backoff || 'none';
  const baseDelayMs = retryPolicy!.base_delay_ms || 1000;
  const maxDelayMs = retryPolicy!.max_delay_ms || 30000;
  const retryableStatusCodes = retryPolicy!.retryable_status_codes
    ? new Set(retryPolicy!.retryable_status_codes)
    : DEFAULT_RETRYABLE_STATUS_CODES;

  const attempts: AttemptLogEntry[] = [];
  const totalStart = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await singleAttempt({
      endpoint, method, authHeaders, body, requestMapping, responseMapping, timeoutMs,
    });

    attempts.push({
      attempt: attempt + 1,
      ...(result.success ? { success: true } : { error: result.error, status: result.status }),
      elapsed_ms: result.elapsed_ms,
    });

    if (result.success) {
      return {
        ...result,
        elapsed_ms: Date.now() - totalStart,
        retry_metadata: {
          total_attempts: attempt + 1,
          retried: attempt > 0,
          attempts,
        },
      };
    }

    // Last attempt or non-retryable — return failure
    if (attempt === maxRetries || !isRetryableResult(result, retryableStatusCodes)) {
      return {
        ...result,
        elapsed_ms: Date.now() - totalStart,
        retry_metadata: {
          total_attempts: attempt + 1,
          retried: attempt > 0,
          attempts,
        },
      };
    }

    // Wait before next attempt
    const delay = calculateBackoffDelay(attempt, backoff, baseDelayMs, maxDelayMs);
    if (delay > 0) {
      await sleep(delay);
    }
  }
  // Unreachable (the loop always returns on the final attempt); explicit for
  // noImplicitReturns. Matches the prior JS implicit-undefined return.
  return undefined;
}

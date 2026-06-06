/**
 * Webhook dispatch helpers.
 * HMAC signing, delivery with logging, and org-level dispatch.
 */

import crypto from 'crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent as UndiciAgent, fetch } from 'undici';
import { scanSensitiveData } from './security.js';

/** SQL client usable as a tagged template (Neon/postgres shape). */
type SqlClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
};

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  events: string | null;
  failure_count?: string | number | null;
}

interface DeliverWebhookArgs {
  webhookId: string;
  orgId: string;
  url: string;
  secret: string;
  eventType: string;
  payload: unknown;
  sql: SqlClient;
}

interface DeliverWebhookResult {
  success: boolean;
  status?: number | null;
  delivery_logged: boolean;
}

interface DeliverGuardWebhookArgs {
  url: string;
  policyId: string;
  orgId: string;
  payload: unknown;
  timeoutMs?: number;
  sql: SqlClient;
}

interface DeliverGuardWebhookResult {
  success: boolean;
  response: unknown;
  status: number | null;
  delivery_logged: boolean;
}

interface ApprovalAction {
  action_id?: string;
  agent_id?: string | null;
  action_type?: string | null;
  declared_goal?: string | null;
  risk_score?: number | null;
  status?: string | null;
  matched_policies?: unknown[];
  reason?: string | null;
  // Callers spread loose DB-derived action rows (createdAction / getActionSummary)
  // that carry extra columns; tolerate them without losing the named fields above.
  [key: string]: unknown;
}

/**
 * Build an undici dispatcher that pins DNS resolution to the pre-validated
 * IPs returned by assertSafeWebhookUrl. Closes the DNS-rebinding window
 * between our lookup and fetch's own connect-time resolution — a
 * short-TTL attacker-controlled DNS record cannot flip to a private
 * address between the two calls because fetch never re-resolves.
 * Falls back to identity lookup when no pinned IP is known.
 */
export function buildPinnedDispatcher(validatedIps: string[]): UndiciAgent | undefined {
  if (!Array.isArray(validatedIps) || validatedIps.length === 0) {
    return undefined;
  }
  // The undici `connect.lookup` override expects a net.LookupFunction. Our
  // implementation honors both the single-address and `all` callback contracts,
  // but TS can't unify the overloaded LookupFunction signature with this inline
  // body — cast the function (only) to bridge it without altering behavior.
  const lookup = ((
    _hostname: string,
    options: { all?: boolean; family?: number } | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ): void => {
    // Every entry in validatedIps was already proven public by
    // safeUrlWithIps, so connecting to ANY of them is safe. Honor the
    // dns.lookup `all` contract and return every validated address so
    // undici can fail over (multi-IP CDN hosts otherwise dead-end on a
    // single unreachable address).
    if (options?.all) {
      callback(null, validatedIps.map((ip) => ({ address: ip, family: net.isIP(ip) || 4 })));
      return;
    }
    // validatedIps.length > 0 is guaranteed by the early return above, so
    // index 0 is always present; the cast satisfies noUncheckedIndexedAccess
    // without changing runtime behavior (matches the original validatedIps[0]).
    const first = validatedIps[0] as string;
    const family = net.isIP(first);
    callback(null, first, family || (options?.family ?? 4));
  }) as unknown as net.LookupFunction;

  return new UndiciAgent({
    connect: {
      lookup,
    },
  });
}

export async function safeUrlWithIps(url: string): Promise<string[]> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Webhook URL must use https');
  if (parsed.username || parsed.password) throw new Error('Webhook URL must not include credentials');
  const host = parsed.hostname;
  if (!host) throw new Error('Webhook URL hostname is required');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Webhook URL cannot target private or loopback IPs');
    return [host];
  }
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(addrs) || addrs.length === 0) throw new Error('Webhook hostname did not resolve');
  for (const a of addrs) {
    if (isPrivateIp(a?.address)) throw new Error('Webhook hostname resolves to a private or loopback IP');
  }
  return addrs.map((a) => a.address).filter(Boolean);
}

function isPrivateIp(ip: string | undefined | null): boolean {
  if (!ip || typeof ip !== 'string') return true;

  const v = net.isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;

    const [a, b] = parts;
    if (a === 0) return true; // "this network"
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local

    // Defend against IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
    if (lower.startsWith('::ffff:')) {
      const ipv4Part = lower.substring(7);
      return isPrivateIp(ipv4Part);
    }

    return false;
  }

  // Not an IP literal (shouldn't happen here)
  return true;
}

async function assertSafeWebhookUrl(url: string): Promise<string | undefined> {
  const ips = await safeUrlWithIps(url);
  return ips[0];
}

/**
 * Sign a payload with HMAC-SHA256.
 */
export function signPayload(payload: crypto.BinaryLike, secret: crypto.BinaryLike | crypto.KeyObject): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function redactForStorage(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  return scanSensitiveData(value).redacted;
}

function signGuardWebhookPayload({
  timestamp,
  payload,
  secret,
}: {
  timestamp: string;
  payload: string;
  secret: crypto.BinaryLike | crypto.KeyObject;
}): string {
  const msg = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

/**
 * Deliver a webhook: POST payload to url, log result to webhook_deliveries.
 */
export async function deliverWebhook({
  webhookId,
  orgId,
  url,
  secret,
  eventType,
  payload,
  sql,
}: DeliverWebhookArgs): Promise<DeliverWebhookResult> {
  const deliveryId = `wd_${crypto.randomUUID()}`;
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = signPayload(payloadStr, secret);
  const now = new Date().toISOString();
  const start = Date.now();

  let status = 'failed';
  let responseStatus: number | null = null;
  let responseBody: string | null = null;

  try {
    // Validate URL is safe, capture every validated IP, and pin DNS resolution
    // to one of them so fetch's own lookup can't be swapped mid-flight by a
    // DNS-rebinding attacker. We fetch the original URL (for TLS SNI + cert
    // matching) but the connect-time resolution goes through the pinned
    // dispatcher instead of the system resolver.
    const validatedIps = await safeUrlWithIps(url);
    const dispatcher = buildPinnedDispatcher(validatedIps);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual', // SECURITY: prevent SSRF via redirects
      headers: {
        'Content-Type': 'application/json',
        'X-DashClaw-Signature': signature,
        'X-DashClaw-Event': eventType,
        'X-DashClaw-Delivery': deliveryId,
        'User-Agent': 'DashClaw-Webhooks/1.0',
      },
      body: payloadStr,
      signal: controller.signal,
      dispatcher,
    } as Parameters<typeof fetch>[1]);

    clearTimeout(timeout);
    responseStatus = res.status;

    if (res.status >= 300 && res.status < 400) {
      responseBody = 'Redirect blocked';
      status = 'failed';
    } else {
      responseBody = await res.text().catch(() => '');
      if (responseBody.length > 2000) responseBody = responseBody.substring(0, 2000);
      status = res.ok ? 'success' : 'failed';
    }
  } catch (err) {
    responseBody = (err as Error)?.message || 'Request failed';
    status = 'failed';
  }

  const durationMs = Date.now() - start;

  // Log delivery — await so the audit row is committed before we tell the
  // caller the delivery succeeded. A lost INSERT here would leave an
  // operator investigating a missed webhook alert with no delivery attempt
  // in the UI, unable to distinguish "never tried" from "tried and lost".
  const storedPayload = redactForStorage(payloadStr);
  const storedResponseBody = redactForStorage(responseBody);
  let deliveryLogged = true;
  try {
    await sql`
      INSERT INTO webhook_deliveries (id, webhook_id, org_id, event_type, payload, status, response_status, response_body, attempted_at, duration_ms)
      VALUES (${deliveryId}, ${webhookId}, ${orgId}, ${eventType}, ${storedPayload}, ${status}, ${responseStatus}, ${storedResponseBody}, ${now}, ${durationMs})
    `;
  } catch (err) {
    console.error('[WEBHOOK] Failed to log delivery:', (err as Error)?.message);
    deliveryLogged = false;
  }

  return { success: status === 'success', status: responseStatus, delivery_logged: deliveryLogged };
}

/**
 * Deliver a guard webhook: POST evaluation context to customer URL for custom decision logic.
 * No HMAC signing — guard webhooks are policy-based, not integration-based.
 */
export async function deliverGuardWebhook({
  url,
  policyId,
  orgId,
  payload,
  timeoutMs,
  sql,
}: DeliverGuardWebhookArgs): Promise<DeliverGuardWebhookResult> {
  const deliveryId = `wd_${crypto.randomUUID()}`;
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const now = new Date().toISOString();
  const start = Date.now();

  let status = 'failed';
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let parsedResponse: unknown = null;

  try {
    // Validate URL + capture validated IPs + pin DNS (see deliverWebhook).
    const validatedIps = await safeUrlWithIps(url);
    const dispatcher = buildPinnedDispatcher(validatedIps);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 5000);

    // Optional signing for guard webhooks (global secret).
    const guardSecret = process.env.GUARD_WEBHOOK_SECRET || '';
    const guardTs = String(Date.now());
    const guardSig = guardSecret
      ? signGuardWebhookPayload({ timestamp: guardTs, payload: payloadStr, secret: guardSecret })
      : null;

    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual', // SECURITY: prevent SSRF via redirects
      headers: {
        'Content-Type': 'application/json',
        'X-DashClaw-Event': 'guard.evaluation',
        'X-DashClaw-Delivery': deliveryId,
        ...(guardSig ? { 'X-DashClaw-Timestamp': guardTs, 'X-DashClaw-Signature': `v1=${guardSig}` } : {}),
        'User-Agent': 'DashClaw-Guard/1.0',
      },
      body: payloadStr,
      signal: controller.signal,
      dispatcher,
    } as Parameters<typeof fetch>[1]);

    clearTimeout(timeout);
    responseStatus = res.status;
    if (res.status >= 300 && res.status < 400) {
      responseBody = 'Redirect blocked';
      status = 'failed';
    } else {
      responseBody = await res.text().catch(() => '');
      if (responseBody.length > 2000) responseBody = responseBody.substring(0, 2000);
      status = res.ok ? 'success' : 'failed';

      if (res.ok) {
        try {
          parsedResponse = JSON.parse(responseBody);
        } catch { /* non-JSON response treated as no-op */ }
      }
    }
  } catch (err) {
    responseBody = (err as Error)?.name === 'AbortError' ? 'Request timed out' : ((err as Error)?.message || 'Request failed');
    status = 'failed';
  }

  const durationMs = Date.now() - start;

  // Log delivery (use policyId as webhook_id for guard webhooks). Await so
  // the audit row is committed before the caller acts on the response — a
  // lost INSERT would hide the guard decision from replay and forensics.
  const storedPayload = redactForStorage(payloadStr);
  const storedResponseBody = redactForStorage(responseBody);
  let deliveryLogged = true;
  try {
    await sql`
      INSERT INTO webhook_deliveries (id, webhook_id, org_id, event_type, payload, status, response_status, response_body, attempted_at, duration_ms)
      VALUES (${deliveryId}, ${policyId}, ${orgId}, ${'guard.evaluation'}, ${storedPayload}, ${status}, ${responseStatus}, ${storedResponseBody}, ${now}, ${durationMs})
    `;
  } catch (err) {
    console.error('[GUARD WEBHOOK] Failed to log delivery:', (err as Error)?.message);
    deliveryLogged = false;
  }

  return { success: status === 'success', response: parsedResponse, status: responseStatus, delivery_logged: deliveryLogged };
}

/**
 * Fire webhooks for an org when new signals are detected.
 * Loads active webhooks, filters by event subscription, delivers, manages failure_count.
 */
export async function fireWebhooksForOrg(
  orgId: string,
  signals: { type?: string }[] | null | undefined,
  sql: SqlClient,
): Promise<{ webhookId: string; success: boolean; signalCount: number }[]> {
  if (!signals || signals.length === 0) return [];

  const webhooks = (await sql`
    SELECT id, url, secret, events, failure_count
    FROM webhooks
    WHERE org_id = ${orgId} AND active = 1
  `) as unknown as WebhookRow[];

  if (webhooks.length === 0) return [];

  const results: { webhookId: string; success: boolean; signalCount: number }[] = [];

  for (const wh of webhooks) {
    let subscribedEvents: string[];
    try {
      subscribedEvents = JSON.parse(wh.events as string);
    } catch {
      subscribedEvents = ['all'];
    }

    // Filter signals this webhook cares about
    const relevantSignals = subscribedEvents.includes('all')
      ? signals
      : signals.filter((s) => subscribedEvents.includes(s.type as string));

    if (relevantSignals.length === 0) continue;

    const payload = {
      event: 'signals.detected',
      org_id: orgId,
      timestamp: new Date().toISOString(),
      signals: relevantSignals,
    };

    const result = await deliverWebhook({
      webhookId: wh.id,
      orgId,
      url: wh.url,
      secret: wh.secret,
      eventType: 'signals.detected',
      payload,
      sql,
    });

    if (result.success) {
      // Reset failure count on success
      sql`UPDATE webhooks SET failure_count = 0, last_triggered_at = ${new Date().toISOString()} WHERE id = ${wh.id} AND org_id = ${orgId}`.catch((err) => {
        console.warn(`[Webhooks] Failed to reset failure_count for webhook ${wh.id}:`, (err as Error)?.message);
      });
    } else {
      const newCount = (parseInt(wh.failure_count as string, 10) || 0) + 1;
      if (newCount >= 10) {
        // Disable webhook after 10 consecutive failures
        sql`UPDATE webhooks SET failure_count = ${newCount}, active = 0, last_triggered_at = ${new Date().toISOString()} WHERE id = ${wh.id} AND org_id = ${orgId}`.catch((err) => {
          console.warn(`[Webhooks] Failed to disable webhook ${wh.id} after ${newCount} failures:`, (err as Error)?.message);
        });
      } else {
        sql`UPDATE webhooks SET failure_count = ${newCount}, last_triggered_at = ${new Date().toISOString()} WHERE id = ${wh.id} AND org_id = ${orgId}`.catch((err) => {
          console.warn(`[Webhooks] Failed to update failure_count for webhook ${wh.id}:`, (err as Error)?.message);
        });
      }
    }

    results.push({ webhookId: wh.id, success: result.success, signalCount: relevantSignals.length });
  }

  return results;
}

/**
 * Fire webhooks for approval-related events (pending, granted, denied).
 */
export async function fireWebhooksForApproval(
  orgId: string,
  eventType: string,
  action: ApprovalAction,
  sql: SqlClient,
): Promise<void> {
  try {
    const webhooks = (await sql`
      SELECT id, url, secret, events FROM webhooks
      WHERE org_id = ${orgId} AND active = 1
    `) as unknown as WebhookRow[];

    const baseUrl = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const payload = {
      event: eventType,
      org_id: orgId,
      timestamp: new Date().toISOString(),
      action: {
        action_id: action.action_id,
        agent_id: action.agent_id,
        action_type: action.action_type,
        declared_goal: action.declared_goal,
        risk_score: action.risk_score,
        status: action.status,
        matched_policies: action.matched_policies || [],
        reason: action.reason || '',
      },
      approval_url: `${baseUrl}/api/approvals/${action.action_id}`,
      replay_url: `${baseUrl}/replay/${action.action_id}`,
    };

    for (const wh of webhooks) {
      // Guard the JSON.parse: a single malformed `events` column would
      // throw and short-circuit all remaining webhooks for this approval.
      // Mirrors the per-iteration try/catch in fireWebhooksForOrg.
      let events: string[];
      try {
        events = JSON.parse(wh.events || '["all"]');
      } catch {
        events = ['all'];
      }
      if (!events.includes('all') && !events.includes(eventType)) continue;
      deliverWebhook({
        webhookId: wh.id,
        orgId,
        url: wh.url,
        secret: wh.secret,
        eventType,
        payload,
        sql,
      }).catch((err) =>
        console.error(`[WEBHOOK] Delivery failed for ${wh.id}:`, (err as Error)?.message)
      );
    }
  } catch (err) {
    console.error('[WEBHOOK] fireWebhooksForApproval error:', (err as Error)?.message);
  }
}

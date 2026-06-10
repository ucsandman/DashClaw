import { getSettings } from './repositories/settings.repository.js';
import { decrypt } from './encryption.js';
import { shouldAutoEncrypt } from './repositories/settings.repository.js';
import { getDefaultProviderModel } from './providers/providerRegistry.js';
import { safeUrlWithIps, buildPinnedDispatcher } from './webhooks.js';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

type HealthStatus = 'healthy' | 'degraded' | 'error' | 'not_configured';

interface HealthResult {
  status: HealthStatus;
  message: string;
}

type Creds = Record<string, string | null | undefined>;

type HealthChecker = (creds: Creds) => Promise<HealthResult>;

const HEALTH_TIMEOUT = 8000;

async function healthFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Each checker: (creds) => { status: 'healthy'|'degraded'|'error'|'not_configured', message: string }
const HEALTH_CHECKERS: Record<string, HealthChecker> = {
  openai: async (creds) => {
    const key = creds.OPENAI_API_KEY;
    if (!key) return { status: 'not_configured', message: 'No API key' };
    const res = await healthFetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { status: 'healthy', message: 'API key valid' };
    if (res.status === 401) return { status: 'error', message: 'Invalid or expired API key' };
    return { status: 'degraded', message: `Unexpected status ${res.status}` };
  },

  anthropic: async (creds) => {
    const key = creds.ANTHROPIC_API_KEY;
    if (!key) return { status: 'not_configured', message: 'No API key' };
    const res = await healthFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getDefaultProviderModel('anthropic', 'predictive_risk') || 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    // 400 = bad request but key is valid; 401 = key invalid
    if (res.ok || res.status === 400) return { status: 'healthy', message: 'API key valid' };
    if (res.status === 401) return { status: 'error', message: 'Invalid or expired API key' };
    return { status: 'degraded', message: `Unexpected status ${res.status}` };
  },

  slack: async (creds) => {
    const token = creds.SLACK_BOT_TOKEN;
    if (!token) return { status: 'not_configured', message: 'No bot token' };
    const res = await healthFetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const data = (await res.json()) as { ok?: boolean; user?: string; error?: string };
    if (data.ok) return { status: 'healthy', message: `Connected as ${data.user || 'bot'}` };
    return { status: 'error', message: data.error || 'Auth failed' };
  },

  discord: async (creds) => {
    const url = creds.DISCORD_WEBHOOK_URL;
    if (!url) return { status: 'not_configured', message: 'No webhook URL' };
    let dispatcher;
    try {
      const validatedIps = await safeUrlWithIps(url);
      dispatcher = buildPinnedDispatcher(validatedIps);
    } catch (err) {
      return { status: 'error', message: `Webhook URL rejected: ${(err as Error).message}` };
    }
    const res = await healthFetch(url, { dispatcher } as RequestInit);
    if (res.ok) return { status: 'healthy', message: 'Webhook URL valid' };
    return { status: 'error', message: `Webhook returned ${res.status}` };
  },

  linear: async (creds) => {
    const key = creds.LINEAR_API_KEY;
    if (!key) return { status: 'not_configured', message: 'No API key' };
    const res = await healthFetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
    });
    if (res.ok) return { status: 'healthy', message: 'API key valid' };
    if (res.status === 401) return { status: 'error', message: 'Invalid API key' };
    return { status: 'degraded', message: `Unexpected status ${res.status}` };
  },

  github: async (creds) => {
    const token = creds.GITHUB_TOKEN;
    if (!token) return { status: 'not_configured', message: 'No token' };
    const res = await healthFetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'DashClaw-Health' },
    });
    if (res.ok) return { status: 'healthy', message: 'Token valid' };
    if (res.status === 401) return { status: 'error', message: 'Invalid or expired token' };
    return { status: 'degraded', message: `Unexpected status ${res.status}` };
  },

  neon: async (creds) => {
    const key = creds.NEON_API_KEY;
    if (!key) return { status: 'not_configured', message: 'No API key' };
    const res = await healthFetch('https://console.neon.tech/api/v2/projects', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { status: 'healthy', message: 'API key valid' };
    if (res.status === 401) return { status: 'error', message: 'Invalid API key' };
    return { status: 'degraded', message: `Unexpected status ${res.status}` };
  },

  resend: async (creds) => {
    const key = creds.RESEND_API_KEY;
    if (!key) return { status: 'not_configured', message: 'No API key' };
    const res = await healthFetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { status: 'healthy', message: 'API key valid' };
    if (res.status === 401) return { status: 'error', message: 'Invalid API key' };
    return { status: 'degraded', message: `Unexpected status ${res.status}` };
  },

  stripe: async (creds) => {
    const key = creds.STRIPE_SECRET_KEY;
    if (!key) return { status: 'not_configured', message: 'No secret key' };
    const res = await healthFetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Basic ${Buffer.from(key + ':').toString('base64')}` },
    });
    if (res.ok) return { status: 'healthy', message: 'Key valid' };
    if (res.status === 401) return { status: 'error', message: 'Invalid key' };
    return { status: 'degraded', message: `Unexpected status ${res.status}` };
  },
};

interface SettingRow {
  key: string;
  value: string | null;
  encrypted?: boolean | null;
}

/**
 * Decrypt settings values for health checking.
 * Mirrors the decryption logic in GET /api/settings.
 */
function decryptSettings(settings: SettingRow[], orgId: string): Creds {
  const creds: Creds = {};
  for (const s of settings) {
    let val = s.value;
    if (s.encrypted && val) {
      const decrypted = decrypt(val, `${orgId}:${s.key}`);
      if (decrypted) val = decrypted;
    }
    creds[s.key] = val;
  }
  return creds;
}

interface IntegrationHealthEntry extends HealthResult {
  checked_at: string;
}

// Module-level TTL cache so request paths (the operations feed) never await
// live external probes. Same pattern as the middleware apiKeyCache.
const HEALTH_CACHE_TTL_MS = 5 * 60_000;
const healthCache = new Map<string, { results: Record<string, IntegrationHealthEntry>; expires: number }>();
const inflightRefresh = new Map<string, Promise<Record<string, IntegrationHealthEntry>>>();

/**
 * Check health of all configured integrations for an org.
 * Probes run in parallel; the result refreshes the module cache.
 * Returns: { [provider]: { status, message, checked_at } }
 */
export async function checkAllIntegrations(
  orgId: string,
  sql: SqlClient,
): Promise<Record<string, IntegrationHealthEntry>> {
  const settings = await getSettings(sql, orgId, { category: 'integration' });
  const creds = decryptSettings(settings as unknown as SettingRow[], orgId);

  const entries = await Promise.all(
    Object.entries(HEALTH_CHECKERS).map(async ([provider, checker]): Promise<[string, IntegrationHealthEntry]> => {
      try {
        return [provider, { ...await checker(creds), checked_at: new Date().toISOString() }];
      } catch (err) {
        return [provider, { status: 'error', message: (err as Error).message || 'Check failed', checked_at: new Date().toISOString() }];
      }
    }),
  );
  const results = Object.fromEntries(entries);
  healthCache.set(orgId, { results, expires: Date.now() + HEALTH_CACHE_TTL_MS });
  return results;
}

/**
 * Cache-only read for hot request paths. Returns the last-known results
 * immediately (or {} when never checked) and, when the cache is stale or
 * empty, kicks off ONE non-awaited background refresh per org.
 */
export function getCachedIntegrationHealth(
  orgId: string,
  sql: SqlClient,
): Promise<Record<string, IntegrationHealthEntry>> {
  const entry = healthCache.get(orgId);
  if (entry && entry.expires > Date.now()) return Promise.resolve(entry.results);
  if (!inflightRefresh.has(orgId)) {
    const refresh = checkAllIntegrations(orgId, sql)
      .catch(() => entry?.results ?? {})
      .finally(() => inflightRefresh.delete(orgId));
    inflightRefresh.set(orgId, refresh);
  }
  return Promise.resolve(entry?.results ?? {});
}

/** Test-only: clear the module cache between cases. */
export function __resetIntegrationHealthCache(): void {
  healthCache.clear();
  inflightRefresh.clear();
}

export { HEALTH_CHECKERS };

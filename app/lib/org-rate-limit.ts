// Org-keyed rate limiting for the guard and record paths (hosted paid tier,
// G5 — docs/decisions/2026-08-09-hosted-paid-tier.md). Keyed by org id, not
// IP, so a tenant behind corporate NAT is never throttled by neighbors and a
// fleet spread across many IPs is still bounded as one org. Redis-backed
// (fixed window via INCR + PEXPIRE on REDIS_URL) so counts survive serverless
// cold starts; falls back to a per-instance in-memory window when Redis is
// absent or unreachable — degraded, never unlimited. The per-IP limiter in
// middleware.js stays as the pre-auth fallback and is untouched.
//
// Node runtime only (node-redis is a TCP client): call from route handlers,
// never from Edge middleware.

interface MemoryEntry {
  count: number;
  resetAt: number;
}

export interface OrgRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  backend: 'redis' | 'memory' | 'disabled';
}

type RedisLike = {
  incr: (key: string) => Promise<number>;
  pExpire: (key: string, ms: number) => Promise<unknown>;
};

const MEMORY_MAX_ENTRIES = 10000;
const REDIS_RETRY_COOLDOWN_MS = 30000;

let memoryCounters = new Map<string, MemoryEntry>();
let redisClientPromise: Promise<RedisLike | null> | null = null;
let redisFailedAt = 0;

/** Test helper: clears counters and cached Redis state. */
export function __resetOrgRateLimit(): void {
  memoryCounters = new Map();
  redisClientPromise = null;
  redisFailedAt = 0;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function redisUrl(): string {
  return process.env.REDIS_URL || process.env.REALTIME_REDIS_URL || '';
}

async function getRedisClient(): Promise<RedisLike | null> {
  const url = redisUrl();
  if (!url) return null;
  if (redisFailedAt && Date.now() - redisFailedAt < REDIS_RETRY_COOLDOWN_MS) return null;
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const mod = await import('redis');
      const client = mod.createClient({ url });
      // Without an error listener node-redis throws unhandled on disconnects.
      client.on('error', () => {});
      await client.connect();
      return client as unknown as RedisLike;
    })().catch((err) => {
      console.warn('[org-rate-limit] Redis connect failed, using memory fallback:', err?.message || err);
      redisFailedAt = Date.now();
      redisClientPromise = null;
      return null;
    });
  }
  return redisClientPromise;
}

function checkMemory(key: string, limit: number, windowMs: number, now: number): OrgRateLimitResult {
  if (memoryCounters.size > MEMORY_MAX_ENTRIES) {
    for (const [k, entry] of memoryCounters) {
      if (entry.resetAt <= now) memoryCounters.delete(k);
    }
  }
  let entry = memoryCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryCounters.set(key, entry);
  }
  entry.count += 1;
  return buildResult(entry.count, limit, entry.resetAt - now, 'memory');
}

function buildResult(
  count: number,
  limit: number,
  msUntilReset: number,
  backend: OrgRateLimitResult['backend'],
): OrgRateLimitResult {
  const allowed = count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterMs: allowed ? 0 : Math.max(1, msUntilReset),
    backend,
  };
}

/**
 * Fixed-window check-and-increment for one org. Every call counts as one
 * request. Callers should 429 with Retry-After when `allowed` is false.
 */
export async function checkOrgRateLimit(orgId: string): Promise<OrgRateLimitResult> {
  const limit = parsePositiveInt(process.env.DASHCLAW_ORG_RATE_LIMIT_MAX, 600);
  const windowMs = parsePositiveInt(process.env.DASHCLAW_ORG_RATE_LIMIT_WINDOW_MS, 60000);

  // Same escape hatch as the middleware IP limiter: dev/test convenience,
  // deliberately ignored in production.
  if (
    String(process.env.DASHCLAW_DISABLE_RATE_LIMIT || '').toLowerCase() === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    return { allowed: true, limit, remaining: limit, retryAfterMs: 0, backend: 'disabled' };
  }

  const now = Date.now();
  const windowIndex = Math.floor(now / windowMs);
  const key = `dc:orl:${orgId}:${windowIndex}`;
  const msUntilReset = (windowIndex + 1) * windowMs - now;

  const client = await getRedisClient();
  if (client) {
    try {
      const count = await client.incr(key);
      if (count === 1) {
        // Grace second so the key outlives its window even under clock skew.
        await client.pExpire(key, windowMs + 1000);
      }
      return buildResult(count, limit, msUntilReset, 'redis');
    } catch (err) {
      console.warn('[org-rate-limit] Redis check failed, using memory fallback:', (err as Error)?.message || err);
      redisFailedAt = now;
    }
  }

  return checkMemory(key, limit, windowMs, now);
}

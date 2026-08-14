import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRedisClient, mockCreateClient } = vi.hoisted(() => {
  const mockRedisClient = {
    connect: vi.fn(async () => {}),
    on: vi.fn(),
    incr: vi.fn(async () => 1),
    pExpire: vi.fn(async () => true),
    disconnect: vi.fn(async () => {}),
  };
  return { mockRedisClient, mockCreateClient: vi.fn(() => mockRedisClient) };
});

vi.mock('redis', () => ({ createClient: mockCreateClient }));

import { checkOrgRateLimit, __resetOrgRateLimit } from '@/lib/org-rate-limit.js';

describe('checkOrgRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));
    __resetOrgRateLimit();
    delete process.env.REDIS_URL;
    delete process.env.REALTIME_REDIS_URL;
    delete process.env.DASHCLAW_DISABLE_RATE_LIMIT;
    process.env.DASHCLAW_ORG_RATE_LIMIT_MAX = '3';
    process.env.DASHCLAW_ORG_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('memory fallback (no Redis configured)', () => {
    it('allows requests up to the limit and reports the backend', async () => {
      for (let i = 0; i < 3; i++) {
        const result = await checkOrgRateLimit('org_a');
        expect(result.allowed).toBe(true);
        expect(result.backend).toBe('memory');
      }
    });

    it('blocks the request over the limit with a positive retryAfterMs', async () => {
      for (let i = 0; i < 3; i++) await checkOrgRateLimit('org_a');
      const result = await checkOrgRateLimit('org_a');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000);
    });

    it('allows again after the window rolls over', async () => {
      for (let i = 0; i < 4; i++) await checkOrgRateLimit('org_a');
      vi.setSystemTime(new Date('2026-08-09T12:01:01Z'));
      const result = await checkOrgRateLimit('org_a');
      expect(result.allowed).toBe(true);
    });

    it('limits each org independently', async () => {
      for (let i = 0; i < 4; i++) await checkOrgRateLimit('org_a');
      const result = await checkOrgRateLimit('org_b');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Redis-backed (REDIS_URL set)', () => {
    beforeEach(() => {
      process.env.REDIS_URL = 'redis://localhost:6379';
    });

    it('uses Redis INCR keyed by org and window and allows under the limit', async () => {
      mockRedisClient.incr.mockResolvedValue(1);
      const result = await checkOrgRateLimit('org_a');
      expect(result.allowed).toBe(true);
      expect(result.backend).toBe('redis');
      expect(mockRedisClient.incr).toHaveBeenCalledTimes(1);
      const key = mockRedisClient.incr.mock.calls[0][0];
      expect(key).toContain('org_a');
    });

    it('sets an expiry when the window key is first created', async () => {
      mockRedisClient.incr.mockResolvedValue(1);
      await checkOrgRateLimit('org_a');
      expect(mockRedisClient.pExpire).toHaveBeenCalledTimes(1);
    });

    it('blocks when the Redis count exceeds the limit', async () => {
      mockRedisClient.incr.mockResolvedValue(4);
      const result = await checkOrgRateLimit('org_a');
      expect(result.allowed).toBe(false);
      expect(result.backend).toBe('redis');
    });

    it('fails over to the memory limiter when Redis errors (never to unlimited)', async () => {
      mockRedisClient.incr.mockRejectedValue(new Error('redis down'));
      for (let i = 0; i < 3; i++) {
        const result = await checkOrgRateLimit('org_a');
        expect(result.allowed).toBe(true);
        expect(result.backend).toBe('memory');
      }
      const blocked = await checkOrgRateLimit('org_a');
      expect(blocked.allowed).toBe(false);
    });

    it('falls back to the memory limiter when Redis connect never settles (bounded, no hang)', async () => {
      // Reproduces the production hang: a stalled/unreachable endpoint where
      // client.connect() never resolves or rejects. The governance path must
      // still return within a bounded amount of (virtual) time, degraded to
      // the in-memory backend rather than pending until the 30s client timeout.
      mockRedisClient.connect.mockImplementationOnce(() => new Promise(() => {}));

      const backend = await Promise.race([
        checkOrgRateLimit('org_a').then((r) => r.backend),
        // Drain the entire client-timeout window of virtual time. If connect
        // was left unbounded, checkOrgRateLimit is still pending here and this
        // sentinel wins — a clean, fast failure instead of a real 30s hang.
        vi.advanceTimersByTimeAsync(30000).then(() => 'PENDING'),
      ]);

      expect(backend).toBe('memory');
    });

    it('destroys the timed-out client so a stalled socket cannot leak', async () => {
      mockRedisClient.connect.mockImplementationOnce(() => new Promise(() => {}));

      const promise = checkOrgRateLimit('org_a');
      await vi.advanceTimersByTimeAsync(30000);
      await promise;

      expect(mockRedisClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it('falls back to the memory limiter when a Redis command never settles (bounded, no hang)', async () => {
      // The connect-time hang was fixed in #222; this is the same failure mode
      // one layer later: connect() succeeded on a warm instance, then the
      // socket went half-open (serverless NAT idle-drop — no FIN, no error
      // event, no reconnect) and INCR never settles. The governance path must
      // still return within bounded time, degraded to memory.
      mockRedisClient.incr.mockImplementationOnce(() => new Promise(() => {}));

      const backend = await Promise.race([
        checkOrgRateLimit('org_a').then((r) => r.backend),
        vi.advanceTimersByTimeAsync(30000).then(() => 'PENDING'),
      ]);

      expect(backend).toBe('memory');
    });

    it('discards the stalled client after a command timeout so the cooldown retry reconnects', async () => {
      mockRedisClient.incr.mockImplementationOnce(() => new Promise(() => {}));

      const first = await Promise.race([
        checkOrgRateLimit('org_a'),
        vi.advanceTimersByTimeAsync(30000).then(() => null),
      ]);
      expect(first?.backend).toBe('memory');
      // The half-open client is torn down, not left cached: without this, the
      // post-cooldown retry reuses the dead socket and hangs on every window.
      expect(mockRedisClient.disconnect).toHaveBeenCalledTimes(1);

      // Past the 30s retry cooldown a NEW client must be created and Redis
      // resumes as the backend.
      await vi.advanceTimersByTimeAsync(31000);
      mockRedisClient.incr.mockResolvedValue(1);
      const recovered = await checkOrgRateLimit('org_a');
      expect(recovered.backend).toBe('redis');
      expect(mockCreateClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('disable escape hatch', () => {
    it('honors DASHCLAW_DISABLE_RATE_LIMIT outside production', async () => {
      process.env.DASHCLAW_DISABLE_RATE_LIMIT = 'true';
      for (let i = 0; i < 10; i++) {
        const result = await checkOrgRateLimit('org_a');
        expect(result.allowed).toBe(true);
        expect(result.backend).toBe('disabled');
      }
    });

    it('ignores the escape hatch in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      process.env.DASHCLAW_DISABLE_RATE_LIMIT = 'true';
      for (let i = 0; i < 3; i++) await checkOrgRateLimit('org_a');
      const result = await checkOrgRateLimit('org_a');
      expect(result.allowed).toBe(false);
    });
  });
});

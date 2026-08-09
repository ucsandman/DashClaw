import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRedisClient, mockCreateClient } = vi.hoisted(() => {
  const mockRedisClient = {
    connect: vi.fn(async () => {}),
    on: vi.fn(),
    incr: vi.fn(async () => 1),
    pExpire: vi.fn(async () => true),
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

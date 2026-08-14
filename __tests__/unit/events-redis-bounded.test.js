import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same failure class as org-rate-limit (#222/#223), one module over: the
// realtime publisher in app/lib/events.ts. All hot-path publishes are void or
// inside after(), so an unbounded Redis await here can't block a response —
// but it pins serverless invocations open and silently loses events. These
// tests pin the bounded-connect / bounded-command / cooldown behavior.

const { mockRedisClient, mockCreateClient } = vi.hoisted(() => {
  const mockRedisClient = {
    connect: vi.fn(async () => {}),
    on: vi.fn(),
    sendCommand: vi.fn(async () => '1-1'),
    publish: vi.fn(async () => 1),
    ping: vi.fn(async () => 'PONG'),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
  return { mockRedisClient, mockCreateClient: vi.fn(() => mockRedisClient) };
});

vi.mock('redis', () => ({ createClient: mockCreateClient }));

// Backend selection happens at module load from env, so every test imports a
// fresh copy of the module with the redis backend forced on.
async function loadEventsModule() {
  vi.resetModules();
  return import('@/lib/events.js');
}

describe('RedisRealtimeBackend bounded Redis usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks does NOT drop persistent mockImplementations from earlier
    // tests — restore the healthy defaults so a pending connect can't leak
    // into the next test.
    mockRedisClient.connect.mockImplementation(async () => {});
    mockRedisClient.sendCommand.mockImplementation(async () => '1-1');
    mockRedisClient.publish.mockImplementation(async () => 1);
    mockRedisClient.ping.mockImplementation(async () => 'PONG');
    mockRedisClient.subscribe.mockImplementation(async () => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
    vi.stubEnv('REALTIME_BACKEND', 'redis');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('publishes via Redis when the connection is healthy', async () => {
    const { publishOrgEvent } = await loadEventsModule();
    await publishOrgEvent('action.created', { orgId: 'org_a', action_id: 'a1' });
    expect(mockRedisClient.sendCommand).toHaveBeenCalledTimes(1);
    expect(mockRedisClient.publish).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory delivery when connect never settles (bounded, no hang)', async () => {
    // The remaining KNOWN issue from the 2026-08-14 incident: a stalled
    // endpoint where connect() never resolves. The publish must settle in
    // bounded (virtual) time via the memory fallback instead of pinning the
    // invocation open.
    mockRedisClient.connect.mockImplementation(() => new Promise(() => {}));
    const { publishOrgEvent } = await loadEventsModule();

    const outcome = await Promise.race([
      publishOrgEvent('action.created', { orgId: 'org_a' }).then(() => 'SETTLED'),
      vi.advanceTimersByTimeAsync(30000).then(() => 'PENDING'),
    ]);

    expect(outcome).toBe('SETTLED');
    expect(mockRedisClient.disconnect).toHaveBeenCalledTimes(1);
    // Redis never got the event; nothing should have been sent on a client
    // that never finished connecting.
    expect(mockRedisClient.sendCommand).not.toHaveBeenCalled();
    expect(mockRedisClient.publish).not.toHaveBeenCalled();
  });

  it('does not hand a second concurrent caller the not-yet-connected client', async () => {
    // Old bug: this.publisher was cached BEFORE connect() resolved, so a
    // concurrent publish got an offline-queue client and its commands pended.
    // With promise-caching, both callers wait on the same bounded connect and
    // both settle.
    mockRedisClient.connect.mockImplementation(() => new Promise(() => {}));
    const { publishOrgEvent } = await loadEventsModule();

    const first = publishOrgEvent('action.created', { orgId: 'org_a' });
    const second = publishOrgEvent('action.updated', { orgId: 'org_a' });

    const outcome = await Promise.race([
      Promise.all([first, second]).then(() => 'SETTLED'),
      vi.advanceTimersByTimeAsync(30000).then(() => 'PENDING'),
    ]);

    expect(outcome).toBe('SETTLED');
    // One connect attempt shared by both callers — not one client per caller.
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('bounds a publish command that never settles and drops the stalled client', async () => {
    // Warm-instance half-open socket: connect() succeeded earlier, then the
    // socket died silently (NAT idle-drop) and XADD/PUBLISH never settle.
    mockRedisClient.sendCommand.mockImplementationOnce(() => new Promise(() => {}));
    mockRedisClient.publish.mockImplementationOnce(() => new Promise(() => {}));
    const { publishOrgEvent } = await loadEventsModule();

    const outcome = await Promise.race([
      publishOrgEvent('action.created', { orgId: 'org_a' }).then(() => 'SETTLED'),
      vi.advanceTimersByTimeAsync(30000).then(() => 'PENDING'),
    ]);

    expect(outcome).toBe('SETTLED');
    // The half-open client is torn down, not left cached.
    expect(mockRedisClient.disconnect).toHaveBeenCalled();
  });

  it('enters a failure cooldown after a connect failure and reconnects after it', async () => {
    mockRedisClient.connect.mockImplementationOnce(() => new Promise(() => {}));
    const { publishOrgEvent } = await loadEventsModule();

    const first = publishOrgEvent('action.created', { orgId: 'org_a' });
    await vi.advanceTimersByTimeAsync(30000);
    await first;
    expect(mockCreateClient).toHaveBeenCalledTimes(1);

    // Inside the cooldown: no new connect attempt, straight to memory.
    await publishOrgEvent('action.updated', { orgId: 'org_a' });
    expect(mockCreateClient).toHaveBeenCalledTimes(1);

    // Past the cooldown: a NEW client is created and Redis publishing resumes.
    await vi.advanceTimersByTimeAsync(31000);
    await publishOrgEvent('action.updated', { orgId: 'org_a' });
    expect(mockCreateClient).toHaveBeenCalledTimes(2);
    expect(mockRedisClient.publish).toHaveBeenCalledTimes(1);
  });

  it('health check reports degraded (not hang) when ping never settles', async () => {
    mockRedisClient.ping.mockImplementationOnce(() => new Promise(() => {}));
    const { getRealtimeHealth } = await loadEventsModule();

    const health = await Promise.race([
      getRealtimeHealth(),
      vi.advanceTimersByTimeAsync(30000).then(() => null),
    ]);

    expect(health).not.toBeNull();
    expect(health.status).toBe('degraded');
  });

  it('SSE subscribe falls back to memory when the subscriber connect never settles', async () => {
    mockRedisClient.connect.mockImplementation(() => new Promise(() => {}));
    const { subscribeOrgEvents } = await loadEventsModule();

    const outcome = await Promise.race([
      subscribeOrgEvents('org_a', () => {}).then(() => 'SETTLED'),
      vi.advanceTimersByTimeAsync(30000).then(() => 'PENDING'),
    ]);

    expect(outcome).toBe('SETTLED');
    expect(mockRedisClient.subscribe).not.toHaveBeenCalled();
  });

  it('replay falls back to memory when XRANGE never settles', async () => {
    mockRedisClient.sendCommand.mockImplementation(() => new Promise(() => {}));
    const { replayOrgEvents } = await loadEventsModule();

    const outcome = await Promise.race([
      replayOrgEvents('org_a', { limit: 10 }).then((events) => ({ events })),
      vi.advanceTimersByTimeAsync(30000).then(() => 'PENDING'),
    ]);

    expect(outcome).not.toBe('PENDING');
    expect(Array.isArray(outcome.events)).toBe(true);
  });
});

import { EventEmitter } from 'events';
import crypto from 'crypto';

export const EVENTS = {
  ACTION_CREATED: 'action.created',
  ACTION_UPDATED: 'action.updated',
  ACTION_COST_EXCEEDED: 'action.cost_exceeded',
  SIGNAL_DETECTED: 'signal.detected',
  TOKEN_USAGE: 'token.usage',
  MESSAGE_CREATED: 'message.created',
  POLICY_UPDATED: 'policy.updated',
  TASK_ASSIGNED: 'task.assigned',
  TASK_COMPLETED: 'task.completed',
  DECISION_CREATED: 'decision.created',
  GUARD_DECISION_CREATED: 'guard.decision.created',
  LOOP_CREATED: 'loop.created',
  LOOP_UPDATED: 'loop.updated',
  GOAL_CREATED: 'goal.created',
  GOAL_UPDATED: 'goal.updated',
};

interface EventEnvelope {
  id: string;
  org_id: string;
  event: string;
  timestamp: string;
  version: string;
  payload: Record<string, unknown>;
  cursor?: string;
}

interface ReplayOptions {
  afterCursor?: string;
  limit?: number;
}

const EVENT_VERSION = 'v1';
const ORG_CHANNEL_PREFIX = 'dashclaw:org';
const requestedBackend = (process.env.REALTIME_BACKEND || 'memory').toLowerCase();
const redisUrl = process.env.REDIS_URL || process.env.REALTIME_REDIS_URL || '';
const enforceRedisCutover = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.REALTIME_ENFORCE_REDIS || '').toLowerCase()
);
const replayWindowSeconds = Math.max(60, parseInt(process.env.REALTIME_REPLAY_WINDOW_SECONDS || '600', 10) || 600);
const replayWindowMs = replayWindowSeconds * 1000;
const replayBufferMax = Math.max(200, parseInt(process.env.REALTIME_REPLAY_MAX_EVENTS || '1000', 10) || 1000);
const memoryMaxListeners = (() => {
  const raw = process.env.REALTIME_MEMORY_MAX_LISTENERS || process.env.REALTIME_MAX_LISTENERS || '1000';
  const n = parseInt(raw, 10);
  // 0 means unlimited in Node's EventEmitter.
  if (Number.isFinite(n) && n >= 0) return n;
  return 1000;
})();

class MemoryRealtimeBackend {
  emitter: EventEmitter;
  replayByOrg: Map<string, EventEnvelope[]>;
  cursorByOrg: Map<string, number>;

  constructor() {
    this.emitter = new EventEmitter();
    // Many concurrent SSE connections are normal. Raise the default limit to avoid false-positive warnings.
    this.emitter.setMaxListeners(memoryMaxListeners);
    this.replayByOrg = new Map();
    this.cursorByOrg = new Map();
  }

  channelForOrg(orgId: string): string {
    return `${ORG_CHANNEL_PREFIX}:${orgId}:events`;
  }

  nextCursor(orgId: string): string {
    const next = (this.cursorByOrg.get(orgId) || 0) + 1;
    this.cursorByOrg.set(orgId, next);
    return `mem-${next}`;
  }

  parseCursor(cursor: string | undefined | null): number | null {
    if (!cursor || typeof cursor !== 'string' || !cursor.startsWith('mem-')) return null;
    const value = parseInt(cursor.slice(4), 10);
    return Number.isNaN(value) ? null : value;
  }

  prune(orgId: string): EventEnvelope[] {
    const now = Date.now();
    const cutoff = now - replayWindowMs;
    const existing = this.replayByOrg.get(orgId) || [];
    const byTime = existing.filter((evt) => {
      const ts = Date.parse(evt.timestamp || '');
      return Number.isNaN(ts) || ts >= cutoff;
    });
    const trimmed = byTime.slice(-replayBufferMax);
    this.replayByOrg.set(orgId, trimmed);
    return trimmed;
  }

  async publish(envelope: EventEnvelope): Promise<EventEnvelope> {
    const withCursor = {
      ...envelope,
      cursor: envelope.cursor || this.nextCursor(envelope.org_id),
    };
    const current = this.replayByOrg.get(envelope.org_id) || [];
    current.push(withCursor);
    this.replayByOrg.set(envelope.org_id, current);
    this.prune(envelope.org_id);
    this.emitter.emit(this.channelForOrg(withCursor.org_id), withCursor);
    return withCursor;
  }

  async subscribe(orgId: string, handler: (envelope: EventEnvelope) => void): Promise<() => Promise<void>> {
    const channel = this.channelForOrg(orgId);
    const listener = (envelope: EventEnvelope) => handler(envelope);
    this.emitter.on(channel, listener);
    return async () => {
      this.emitter.off(channel, listener);
    };
  }

  async replay(orgId: string, { afterCursor, limit = 200 }: ReplayOptions = {}): Promise<EventEnvelope[]> {
    const safeLimit = Math.min(Math.max(limit, 1), replayBufferMax);
    const events = this.prune(orgId);
    if (!afterCursor) {
      return events.slice(-safeLimit);
    }

    const numericAfter = this.parseCursor(afterCursor);
    if (numericAfter != null) {
      const replay = events.filter((evt) => {
        const cur = this.parseCursor(evt.cursor);
        return cur != null && cur > numericAfter;
      });
      return replay.slice(0, safeLimit);
    }

    const index = events.findIndex((evt) => evt.cursor === afterCursor);
    if (index === -1) {
      return [];
    }
    return events.slice(index + 1, index + 1 + safeLimit);
  }
}

class RedisRealtimeBackend {
  url: string;
  publisher: any;
  createClient: any;

  constructor(url: string) {
    this.url = url;
    this.publisher = null;
    this.createClient = null;
  }

  channelForOrg(orgId: string): string {
    return `${ORG_CHANNEL_PREFIX}:${orgId}:events`;
  }

  streamKeyForOrg(orgId: string): string {
    return `${ORG_CHANNEL_PREFIX}:${orgId}:stream`;
  }

  async loadRedisClientFactory(): Promise<any> {
    if (this.createClient) return this.createClient;
    const mod = await import('redis');
    this.createClient = mod.createClient;
    return this.createClient;
  }

  async getPublisher(): Promise<any> {
    if (this.publisher) return this.publisher;
    const createClient = await this.loadRedisClientFactory();
    this.publisher = createClient({ url: this.url });
    this.publisher.on('error', (err: any) => {
      console.error('[REALTIME] Redis publisher error:', err?.message || err);
    });
    await this.publisher.connect();
    return this.publisher;
  }

  async publish(envelope: EventEnvelope): Promise<EventEnvelope> {
    const publisher = await this.getPublisher();
    let withCursor = envelope;

    try {
      const streamId = await publisher.sendCommand([
        'XADD',
        this.streamKeyForOrg(envelope.org_id),
        'MAXLEN',
        '~',
        String(replayBufferMax),
        '*',
        'data',
        JSON.stringify(envelope),
      ]);
      withCursor = { ...envelope, cursor: streamId };
    } catch (err) {
      console.error('[REALTIME] Redis XADD failed:', (err as any)?.message || err);
    }

    await publisher.publish(this.channelForOrg(withCursor.org_id), JSON.stringify(withCursor));
    return withCursor;
  }

  async ping(): Promise<boolean> {
    const publisher = await this.getPublisher();
    const pong = await publisher.ping();
    return String(pong || '').toUpperCase() === 'PONG';
  }

  async subscribe(orgId: string, handler: (envelope: EventEnvelope) => void): Promise<() => Promise<void>> {
    const createClient = await this.loadRedisClientFactory();
    const subscriber = createClient({ url: this.url });
    subscriber.on('error', (err: any) => {
      console.error('[REALTIME] Redis subscriber error:', err?.message || err);
    });
    await subscriber.connect();

    const channel = this.channelForOrg(orgId);
    await subscriber.subscribe(channel, (message: string) => {
      try {
        const parsed = JSON.parse(message);
        handler(parsed);
      } catch (err) {
        console.error('[REALTIME] Failed to parse Redis event message:', (err as any)?.message || err);
      }
    });

    return async () => {
      try {
        await subscriber.unsubscribe(channel);
      } catch (err) {
        console.warn('[REALTIME] Redis unsubscribe failed during teardown:', (err as any)?.message || err);
      }
      try {
        await subscriber.quit();
      } catch (err) {
        console.warn('[REALTIME] Redis quit failed during teardown:', (err as any)?.message || err);
      }
    };
  }

  parseStreamData(fields: unknown): string | null {
    if (Array.isArray(fields)) {
      for (let i = 0; i < fields.length - 1; i += 2) {
        if (fields[i] === 'data') return fields[i + 1];
      }
      return null;
    }

    if (fields && typeof fields === 'object') {
      return (fields as { data?: string | null }).data || null;
    }

    return null;
  }

  async replay(orgId: string, { afterCursor, limit = 200 }: ReplayOptions = {}): Promise<EventEnvelope[]> {
    const publisher = await this.getPublisher();
    const safeLimit = Math.min(Math.max(limit, 1), replayBufferMax);
    const start = afterCursor ? `(${afterCursor}` : '-';
    const streamKey = this.streamKeyForOrg(orgId);
    const now = Date.now();
    const cutoff = now - replayWindowMs;

    let raw;
    try {
      raw = await publisher.sendCommand([
        'XRANGE',
        streamKey,
        start,
        '+',
        'COUNT',
        String(safeLimit),
      ]);
    } catch (err) {
      // If cursor is invalid for redis stream, treat as no replay available.
      if (afterCursor) return [];
      throw err;
    }

    if (!Array.isArray(raw)) return [];

    const out: EventEnvelope[] = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const streamId = entry[0];
      const dataRaw = this.parseStreamData(entry[1]);
      if (!dataRaw) continue;
      try {
        const parsed = JSON.parse(dataRaw);
        const ts = Date.parse(parsed.timestamp || '');
        if (!Number.isNaN(ts) && ts < cutoff) continue;
        out.push({
          ...parsed,
          cursor: parsed.cursor || streamId,
        });
      } catch {
        // Ignore malformed replay records
      }
    }
    return out;
  }
}

const memoryBackend = new MemoryRealtimeBackend();
let selectedBackendName = 'memory';
let selectedBackend: MemoryRealtimeBackend | RedisRealtimeBackend = memoryBackend;

if (requestedBackend === 'redis') {
  if (redisUrl) {
    selectedBackendName = 'redis';
    selectedBackend = new RedisRealtimeBackend(redisUrl);
  } else {
    console.warn('[REALTIME] REALTIME_BACKEND=redis but REDIS_URL is missing. Falling back to memory backend.');
  }
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[realtime] WARNING: Using in-memory event backend in production. SSE events will be lost between serverless invocations. Set REDIS_URL (Upstash free tier works) for persistent realtime events.');
}

function createEventEnvelope(event: string, orgId: string, payload: Record<string, unknown>): EventEnvelope {
  return {
    id: `evt_${crypto.randomUUID()}`,
    org_id: orgId,
    event,
    timestamp: new Date().toISOString(),
    version: EVENT_VERSION,
    payload,
  };
}

export function getRealtimeBackendName(): string {
  return selectedBackendName;
}

export function getRealtimeConfig() {
  return {
    requested_backend: requestedBackend,
    selected_backend: selectedBackendName,
    redis_configured: Boolean(redisUrl),
    enforce_redis_cutover: enforceRedisCutover,
    replay_window_seconds: replayWindowSeconds,
    replay_max_events: replayBufferMax,
  };
}

export async function getRealtimeHealth() {
  const config = getRealtimeConfig();

  if (config.enforce_redis_cutover && config.selected_backend !== 'redis') {
    return {
      status: 'unhealthy',
      reason: 'REALTIME_ENFORCE_REDIS is enabled but redis backend is not active',
      ...config,
    };
  }

  if (config.selected_backend !== 'redis') {
    return {
      status: 'healthy',
      reason: 'memory backend active',
      ...config,
    };
  }

  try {
    const redisOk = await (selectedBackend as RedisRealtimeBackend).ping();
    if (!redisOk) {
      return {
        status: config.enforce_redis_cutover ? 'unhealthy' : 'degraded',
        reason: 'redis ping failed',
        ...config,
      };
    }

    return {
      status: 'healthy',
      reason: 'redis backend active and reachable',
      ...config,
    };
  } catch (err) {
    return {
      status: config.enforce_redis_cutover ? 'unhealthy' : 'degraded',
      reason: `redis health check failed: ${(err as any)?.message || err}`,
      ...config,
    };
  }
}

export async function publishOrgEvent(
  event: string,
  { orgId, ...payload }: { orgId?: string; [key: string]: unknown } = {}
): Promise<void> {
  if (!orgId) return;
  const envelope = createEventEnvelope(event, orgId, payload);

  if (selectedBackendName === 'memory') {
    await memoryBackend.publish(envelope);
    return;
  }

  // Redis is selected. Publish *only* to Redis so memory-backend subscribers
  // that survived a transient Redis outage don't also receive the event via
  // the in-process EventEmitter — that was the source of the duplicate-frame
  // bug on the SSE live stream. Redis handles its own durability and replay.
  try {
    await selectedBackend.publish(envelope);
  } catch (err) {
    console.error('[REALTIME] Redis publish failed; falling back to local memory delivery:', (err as any)?.message || err);
    try {
      await memoryBackend.publish(envelope);
    } catch (memErr) {
      console.error('[REALTIME] Local memory delivery also failed:', (memErr as any)?.message || memErr);
    }
  }
}

export async function subscribeOrgEvents(
  orgId: string | undefined | null,
  handler: (envelope: EventEnvelope) => void
): Promise<() => Promise<void>> {
  if (!orgId) {
    return async () => {};
  }

  if (selectedBackendName === 'memory') {
    return memoryBackend.subscribe(orgId, handler);
  }

  try {
    return await selectedBackend.subscribe(orgId, handler);
  } catch (err) {
    if (enforceRedisCutover) {
      throw err;
    }
    console.error('[REALTIME] Redis subscribe failed; falling back to memory backend:', (err as any)?.message || err);
    return memoryBackend.subscribe(orgId, handler);
  }
}

export async function replayOrgEvents(
  orgId: string | undefined | null,
  { afterCursor, limit = 200 }: ReplayOptions = {}
): Promise<EventEnvelope[]> {
  if (!orgId) return [];

  if (selectedBackendName === 'memory') {
    return memoryBackend.replay(orgId, { afterCursor, limit });
  }

  try {
    return await selectedBackend.replay(orgId, { afterCursor, limit });
  } catch (err) {
    if (enforceRedisCutover) {
      throw err;
    }
    console.error('[REALTIME] Redis replay failed; falling back to memory replay:', (err as any)?.message || err);
    return memoryBackend.replay(orgId, { afterCursor, limit });
  }
}

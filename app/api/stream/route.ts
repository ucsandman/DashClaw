import { getOrgId } from '../../lib/org';
import {
  EVENTS,
  getRealtimeBackendName,
  getRealtimeHealth,
  replayOrgEvents,
  subscribeOrgEvents,
} from '../../lib/events';

export const dynamic = 'force-dynamic';

type Envelope = {
  event?: string;
  payload?: Record<string, unknown> | null;
  cursor?: string | null;
  id?: string | null;
};

export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const realtimeHealth = await getRealtimeHealth();
    if (realtimeHealth.status === 'unhealthy') {
      return new Response('Realtime backend unavailable', { status: 503 });
    }
    const lastEventId =
      request.headers.get('last-event-id') ||
      (request as { nextUrl?: { searchParams?: URLSearchParams } }).nextUrl?.searchParams?.get('lastEventId') ||
      null;

    // Create a TransformStream for the SSE response
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    let isClosed = false;

    // Helper to send SSE messages
    const send = async (event: string, data: unknown, id: string | null = null) => {
      if (isClosed) return;
      const message = `${id ? `id: ${id}
` : ''}event: ${event}
data: ${JSON.stringify(data)}

`;
      try {
        await writer.write(encoder.encode(message));
      } catch {
        isClosed = true;
      }
    };

    const MAX_SEEN = 10000;
    const seen = new Set<string>();
    let bufferingLiveEvents = true;
    const liveQueue: Envelope[] = [];

    const toSseData = (envelope: Envelope) => {
      if (envelope.event === EVENTS.ACTION_CREATED || envelope.event === EVENTS.ACTION_UPDATED) {
        return envelope.payload?.action || null;
      }
      if (envelope.event === EVENTS.MESSAGE_CREATED) {
        return envelope.payload?.message || null;
      }
      if (envelope.event === EVENTS.POLICY_UPDATED) {
        return envelope.payload || null;
      }
      if (envelope.event === EVENTS.TASK_ASSIGNED || envelope.event === EVENTS.TASK_COMPLETED) {
        return envelope.payload || null;
      }
      if (envelope.event === EVENTS.DECISION_CREATED) {
        return envelope.payload?.decision || null;
      }
      if (envelope.event === EVENTS.GUARD_DECISION_CREATED) {
        return envelope.payload?.decision || null;
      }
      if (envelope.event === EVENTS.LOOP_CREATED || envelope.event === EVENTS.LOOP_UPDATED) {
        return envelope.payload?.loop || null;
      }
      if (envelope.event === EVENTS.GOAL_CREATED || envelope.event === EVENTS.GOAL_UPDATED) {
        return envelope.payload?.goal || null;
      }
      if (envelope.event === EVENTS.SIGNAL_DETECTED) {
        return envelope.payload?.signal || null;
      }
      if (envelope.event === EVENTS.TOKEN_USAGE) {
        return envelope.payload || null;
      }
      return envelope.payload || null;
    };

    const emitEnvelope = async (envelope: Envelope) => {
      if (!envelope || !envelope.event) return;
      const cursor = envelope.cursor || envelope.id || null;
      if (cursor && seen.has(cursor)) return;
      if (cursor) {
        if (seen.size >= MAX_SEEN) seen.clear();
        seen.add(cursor);
      }
      await send(envelope.event, toSseData(envelope), cursor);
    };

    const unsubscribe = await subscribeOrgEvents(orgId, (envelope: Envelope) => {
      if (bufferingLiveEvents) {
        liveQueue.push(envelope);
        return;
      }
      void emitEnvelope(envelope);
    });

    // IMPORTANT: run replay/flush asynchronously after the Response is returned.
    // Awaiting writer writes before returning can deadlock on stream backpressure.
    const startPump = async () => {
      let replayed = 0;
      let replayError = null;
      try {
        if (lastEventId) {
          const replay = await replayOrgEvents(orgId, { afterCursor: lastEventId, limit: 200 } as { afterCursor?: string; limit?: number });
          for (const envelope of replay) {
            await emitEnvelope(envelope);
            replayed += 1;
          }
        }
      } catch (err) {
        replayError = (err as Error)?.message || String(err);
      } finally {
        bufferingLiveEvents = false;
        for (const envelope of liveQueue) {
          await emitEnvelope(envelope);
        }
        liveQueue.length = 0;

        await send('connected', {
          status: 'ok',
          orgId,
          backend: getRealtimeBackendName(),
          realtimeStatus: realtimeHealth.status,
          replayed,
          lastEventId,
          replayError,
        });
      }
    };

    // Keepalive heartbeat — prevents proxies/load balancers from killing idle connections.
    // SSE comments (lines starting with ':') are ignored by clients per the spec.
    const HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    // Clean up on close (when the request is aborted by client)
    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      void unsubscribe();
      writer.close().catch(() => { /* best-effort: peer already closed the stream */ });
    };

    heartbeatTimer = setInterval(async () => {
      if (isClosed) { if (heartbeatTimer) clearInterval(heartbeatTimer); return; }
      try {
        await writer.write(encoder.encode(': heartbeat\n\n'));
      } catch {
        cleanup();
      }
    }, HEARTBEAT_INTERVAL_MS);

    request.signal.addEventListener('abort', cleanup);

    // SECURITY: Server-side max connection duration to prevent resource exhaustion
    const MAX_SSE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
    // Capture the timer id so cleanup can clear it on early disconnect —
    // otherwise every aborted SSE connection leaves a 30-minute pending
    // timer, which leaks on long-lived (non-Vercel) deployments.
    const maxDurationTimer = setTimeout(cleanup, MAX_SSE_DURATION_MS);
    request.signal.addEventListener('abort', () => clearTimeout(maxDurationTimer));

    queueMicrotask(() => {
      void startPump();
    });

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('SSE Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

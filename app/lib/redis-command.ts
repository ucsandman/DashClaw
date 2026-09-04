export class RedisCommandTimeout extends Error {}

/** Race a Redis command against a timer so it can never pend unbounded. */
export function withCommandTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RedisCommandTimeout(`Redis command exceeded ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Forcibly release a client whose connect failed/timed out or whose socket is
// half-open. Best-effort: never throws, never blocks the fallback (node-redis
// v4 exposes disconnect(); v5 adds destroy()).
export function safeDisconnect(client: { destroy?: () => void; disconnect?: () => Promise<unknown> }): void {
  try {
    if (typeof client.destroy === 'function') {
      client.destroy();
    } else if (typeof client.disconnect === 'function') {
      void Promise.resolve(client.disconnect()).catch(() => {});
    }
  } catch {
    // teardown is best-effort
  }
}

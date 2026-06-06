/**
 * Pure connection-state derivation for the widget. Separated from the hook so
 * it is unit-testable without React. The widget polls /api/widget/summary every
 * 30s and also refetches on realtime events; this maps "time since last good
 * fetch + current error" to a glanceable connection indicator.
 */

export type ConnectionState = 'live' | 'reconnecting' | 'offline';

/** Older than this since the last success → not "live" anymore (poll is 30s, so >2 intervals). */
export const STALE_AFTER_MS = 70_000;
/** No success for this long → treat as offline. */
export const OFFLINE_AFTER_MS = 90_000;

export interface DeriveConnectionInput {
  /** Timestamp (ms) of the last successful fetch, or null if none yet. */
  lastSuccessTs: number | null;
  now: number;
  /** Whether the most recent fetch attempt errored. */
  hasError: boolean;
}

export function deriveConnection({ lastSuccessTs, now, hasError }: DeriveConnectionInput): ConnectionState {
  if (lastSuccessTs == null) {
    // Never succeeded: erroring → offline; still trying → reconnecting.
    return hasError ? 'offline' : 'reconnecting';
  }
  const age = now - lastSuccessTs;
  if (age >= OFFLINE_AFTER_MS) return 'offline';
  if (hasError || age >= STALE_AFTER_MS) return 'reconnecting';
  return 'live';
}

/**
 * Stable per-INSTANCE dismissal key for a risk signal.
 *
 * Including `detected_at` is load-bearing: it makes a dismissal suppress only that specific
 * occurrence. The old key (type:agent:action:loop:assumption, no timestamp) meant dismissing
 * "agent heartbeat lost: ps-qa" once suppressed that agent's signal FOREVER — including a fresh
 * silence weeks later (new `last_heartbeat_at`) — while the live ops feed (which never filtered
 * dismissals) still showed it CRITICAL. With the timestamp, a new occurrence produces a new key
 * and re-fires, and the feed can hide the exact instances the user dismissed.
 *
 * Used by every dismissal site: the security-page write, the SystemStatusBar
 * posture reads, and attached to operations-feed signal items as `dismiss_key`.
 * All sites MUST use this one function or the keys won't match.
 */
export function signalDismissKey(s: {
  type?: string | null;
  signal_type?: string | null;
  agent_id?: string | null;
  action_id?: string | null;
  loop_id?: string | null;
  assumption_id?: string | null;
  detected_at?: string | Date | null;
}): string {
  // pg drivers hand computeSignals a Date for timestamptz columns, while the
  // browser computes this key from the JSON-serialized signal (ISO string).
  // Normalize to the ISO form so both sides mint the identical key — a raw
  // Date in join() would stringify as "Thu Aug 14 2026 …" and never match.
  const detectedAt = s.detected_at instanceof Date ? s.detected_at.toISOString() : s.detected_at;
  return [
    s.type || s.signal_type || '',
    s.agent_id || '',
    s.action_id || '',
    s.loop_id || '',
    s.assumption_id || '',
    detectedAt || '',
  ].join(':');
}

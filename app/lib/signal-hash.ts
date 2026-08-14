/**
 * Signal types whose `detected_at` is a SAMPLING time, not an event time.
 *
 * These are rolling-window aggregates: `detected_at` is a MAX()/MIN() over a moving window, or
 * the timestamp of the health check that observed the condition. It advances on its own every
 * time the underlying fleet does anything — which made the occurrence key below churn on every
 * sweep, so a dismissal could never match twice and the signal was UNDISMISSABLE.
 *
 * Measured on production 2026-08-14: `autonomy_spike` for one agent was dismissed three times in
 * 23 minutes (17:00:33, 17:03:10, 17:23:24 — three different keys), and `session_stalled` had
 * accumulated 293 dead dismissal rows. For a condition that is CONTINUOUSLY true, a
 * per-occurrence dismissal is meaningless; the honest semantic is a durable mute on
 * (type, agent), undone from the panel's Restore control.
 *
 * Types NOT listed here keep per-occurrence semantics, which is correct for them: they are
 * anchored to a specific entity (`action_id`, `assumption_id`) or to a genuine event time, so a
 * new occurrence is genuinely new and SHOULD re-fire.
 */
export const SAMPLED_TIME_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'autonomy_spike',
  'repeated_failures',
  'assumption_drift',
  'session_stalled',
  'mcp_degraded',
]);

/**
 * Every signal type `app/lib/signals.ts` can mint. Used to shape-check dismiss
 * keys arriving from a browser before they are persisted — a key whose first
 * slot is not a real signal type can never match a computed signal, so storing
 * it is pure garbage. Kept here rather than in `signals.ts` because the panel
 * (a client component) needs it too and cannot import the server module.
 */
export const SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'agent_silent',
  'approval_backlog',
  'approval_flood',
  'assumption_drift',
  'autonomy_spike',
  'branch_stale',
  'executed_despite_block',
  'green_insufficient',
  'high_impact_low_oversight',
  'integration_mismatch',
  'mcp_degraded',
  'observe_mode',
  'repeated_failures',
  'session_stalled',
  'stale_assumption',
  'stale_running_action',
  'ungoverned_scope',
]);

/**
 * Cheap shape check for a dismiss key handed to us by a client.
 *
 * The minted key is six colon-joined slots, and the last slot (`detected_at`)
 * is an ISO timestamp that itself contains colons — so the test is "at least
 * five separators", not "exactly six parts". Paired with a known type prefix
 * that is enough to reject anything that could never match a real signal.
 */
export function isWellFormedDismissKey(key: string): boolean {
  const parts = key.split(':');
  if (parts.length < 6) return false;
  return SIGNAL_TYPES.has(parts[0] ?? '');
}

/**
 * Stable per-INSTANCE dismissal key for a risk signal.
 *
 * Including `detected_at` is load-bearing for event-time signals: it makes a dismissal suppress
 * only that specific occurrence. The old key (type:agent:action:loop:assumption, no timestamp)
 * meant dismissing "agent heartbeat lost: ps-qa" once suppressed that agent's signal FOREVER —
 * including a fresh silence weeks later (new `last_heartbeat_at`) — while the live ops feed
 * (which never filtered dismissals) still showed it CRITICAL. With the timestamp, a new
 * occurrence produces a new key and re-fires, and the feed can hide the exact instances the
 * user dismissed.
 *
 * The timestamp is deliberately OMITTED for `SAMPLED_TIME_SIGNAL_TYPES` above, where that same
 * property made the signal impossible to clear.
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
  mcp_server?: string | null;
}): string {
  const type = s.type || s.signal_type || '';
  // pg drivers hand computeSignals a Date for timestamptz columns, while the
  // browser computes this key from the JSON-serialized signal (ISO string).
  // Normalize to the ISO form so both sides mint the identical key — a raw
  // Date in join() would stringify as "Thu Aug 14 2026 …" and never match.
  const rawDetectedAt = s.detected_at instanceof Date ? s.detected_at.toISOString() : s.detected_at;
  // Sampled-time types mute durably on (type, agent): their timestamp advances
  // on its own, so including it made the dismissal un-matchable forever after.
  const detectedAt = SAMPLED_TIME_SIGNAL_TYPES.has(type) ? '' : rawDetectedAt;
  // `mcp_degraded` is minted once per MCP SERVER, not per agent: the `agent_id`
  // on it is whichever decision row happened to observe that server first
  // (ORDER BY created_at DESC LIMIT 20). Keying on (type, agent) therefore did
  // two wrong things at once — muting server A also muted server B, and the
  // mute stopped matching as soon as a different agent's row was the one seen.
  // Its identity is the server name, carried in the otherwise-empty
  // `detected_at` slot so the six-slot format, and every already-persisted key
  // of every other signal type, stays byte-identical.
  const isMcp = type === 'mcp_degraded';
  return [
    type,
    isMcp ? '' : s.agent_id || '',
    s.action_id || '',
    s.loop_id || '',
    s.assumption_id || '',
    isMcp ? s.mcp_server || '' : detectedAt || '',
  ].join(':');
}

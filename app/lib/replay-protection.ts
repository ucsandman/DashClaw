// JTI replay-protection mode (Phase 2b, issue #120). One getter shared by the
// guard route (store wiring) and the guard engine (block decision) so the
// default can never drift between the two — the duplicated literal it replaces
// is exactly what a default flip could have missed.

export type JtiReplayMode = 'off' | 'best_effort' | 'required';

const MODES = ['off', 'best_effort', 'required'] as const;

/**
 * Enforcement mode. Default `required` (v3.6, 2026-07-04): the mode only
 * touches JWKS-verified traffic — API-key callers resolve `not_applicable`
 * and are never blocked by it — and the verified fleet was empty at flip
 * time, so issuers onboard against the full contract (jti + exp present,
 * store outage fails closed) from day one. Rollback is this one env var.
 * Invalid values fall back to the default (the act-binding convention).
 */
export function getJtiReplayMode(): JtiReplayMode {
  const raw = (process.env.DASHCLAW_JTI_REPLAY_PROTECTION || 'required').toLowerCase();
  return (MODES as readonly string[]).includes(raw) ? (raw as JtiReplayMode) : 'required';
}

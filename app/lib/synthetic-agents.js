// Shared synthetic-agent-id registry (v5.11 cleanup task 1).
// Extracted from calibration-mining.js so the delete-filter / list-controls
// features (actions repository, DELETE /api/actions, identities page) share
// the exact same family list instead of re-deriving it.

// Synthetic-traffic filter (roadmap v2.6). The platform's own verification
// traffic is DESIGNED to trip policies (inflated client scores, deliberate
// blocks/denials), so mining it would calibrate the scorer against a fiction.
// Explicit families, one per generator in this repo — keep in sync with:
//   smoke-*              scripts/policy-smoke.mjs (agentFor -> `smoke-{tag}-{run}`)
//   ci-smoke             .github/workflows/up-smoke.yml
//   sdk-live-test-agent* .github/workflows/sdk-live.yml
//   demo-e2e-verifier    scripts/verify-demo-e2e.mjs
//   test, test-*         scripts/test-full-api.mjs, scripts/test-actions.mjs, dev suites
//   loadtest-*           scripts/guard-load.mjs (AGENT = `loadtest-{run}`)
//   bench-agent-*        scripts/bench-guard-hotpath.mjs
//   guide-capture-agent  scripts/regen-platform-guide-examples.mjs (recreated every release)
// The last three exact ids are the homepage LiveDemo presets
// (app/lib/homepageDemoActions.ts): on a session/trial-cookie-authenticated
// instance the demo's "Evaluate" click POSTs a REAL /api/guard, so its rows
// exist in the ledger (by design — the visitor sees them on /decisions) but
// are browser clicks, not agent traffic. Discovered 2026-07-26 when the
// hosted funnel counted one as an agent-door first action.
export const SYNTHETIC_AGENT_RE = /^(smoke-|ci-smoke$|sdk-live-test-agent|demo-e2e-verifier$|guide-capture-agent$|test$|test-|loadtest-|bench-agent-|analytics-agent$|openai-deployer-1$|rogue-agent$)/;

// SQL-side mirror of SYNTHETIC_AGENT_RE for consumers that must exclude
// synthetic rows BEFORE aggregation or LIMIT (posture repository, v3.1).
// A unit test pins regex↔patterns agreement so the two can't drift.
export const SYNTHETIC_AGENT_LIKE_PATTERNS = [
  'smoke-%', 'ci-smoke', 'sdk-live-test-agent%', 'demo-e2e-verifier', 'guide-capture-agent', 'test', 'test-%', 'loadtest-%',
  'bench-agent-%', 'analytics-agent', 'openai-deployer-1', 'rogue-agent',
];
// Synthetic action-type families (v4.1 widened from the single `smoke.%`):
//   smoke.*     scripts/policy-smoke.mjs (run-unique types)
//   loadtest.*  scripts/guard-load.mjs
//   liveproof.* ad-hoc ship-verification traffic recorded during live proofs
export const SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS = ['smoke.%', 'loadtest.%', 'liveproof.%'];

export function isSyntheticAgentId(agentId) {
  return typeof agentId === 'string' && SYNTHETIC_AGENT_RE.test(agentId);
}

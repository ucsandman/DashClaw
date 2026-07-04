# v4.1 — Own-fleet interruption noise (spec)

Roadmap: `docs/plans/owner-roadmap.md` v4.1. Drafted 2026-07-04 from live
ledger evidence (read-only diagnosis; queries preserved in the session
scratchpad, results summarized here).

## Incident

The live org showed an approval-flood banner ("~1,802 interrupts in
window") against both Claude Code Mode `rate_limit` policies, the posture
approval dimension read 0, posture sat at 34/100, and session digests
opened with red flood warnings. The v4 roadmap drafted this item on the
hypothesis that the policies were "wrong at volume against our own
sessions."

## What the ledger actually says (2026-07-04 diagnosis)

- **The flood source was the guard-load harness, not real sessions.**
  `loadtest-mr6y5eev` (spawned by `scripts/guard-load.mjs` during the
  v3.7 SLO calibration) made 2,502 guard evaluations in one hour. It
  crossed the runaway ceiling (650/60m), after which every subsequent
  evaluation correctly returned `require_approval` — 1,802 of them, all
  `loadtest.read`. The run ended 22:42 UTC; the flood was residue, not an
  ongoing loop.
- **The runaway valve worked as designed.** A genuine 2,500-actions/hour
  loop got paused. No policy misconfiguration; `650/60m` and `250/30m`
  are not the defect.
- **The defect is classification.** The shared synthetic predicate
  (`SYNTHETIC_AGENT_LIKE_PATTERNS` / `SYNTHETIC_ACTION_TYPE_LIKE` in
  `app/lib/calibration-mining.js`) knows `smoke-*` agents and `smoke.%`
  action types but not the load harness (`loadtest-*` agents,
  `loadtest.%` actions) or the live-proof families (`liveproof.%`).
  24h predicate coverage: 2,749 rows leaking as "real," 1,676 actually
  real, 159 correctly excluded. The leak poisons every consumer of the
  predicate: approval-flood counting (v3.5's fix missed these families),
  posture findings ("loadtest.read is not fully governed", 318 obs, plus
  two `liveproof.*` findings), session digests, and the approval
  dimension.
- **No cleanup debt:** the 1,802 loadtest approvals already expired via
  v2.3 lifecycle expiry; the pending backlog is zero.
- **The approval dimension's 0 is NOT flood fallout.** The dimension is
  fed by capability units with category `approval`/`review`; the org has
  exactly one — `ps-qa:review_artifact`, a stale May-era Practical
  Systems capability with no covering policy (weight 1, grade 0 →
  dimension 0). `approvalFollowThrough` is a constant 1 (deferred). The
  remediation is operator-driven (cover or retire the stale capability
  via the posture queue), not code. The v4 roadmap's "approval dimension
  recovers" acceptance line was written on the flood hypothesis and is
  corrected in the same commit as this spec.
- **The real interrupt volume is small and reveals the actual
  wrong-interrupt class:** ~150 `apply` interrupts over 7 days, all from
  `[Claude Code Mode] Protect governance / auth / secrets paths`
  (protected_path on `sdk/**`, `schema/**`, `drizzle/**`, …), and the
  resolved ones are **100% approved, 0 rejected**. A pattern approved
  every time is a wrong interrupt (MAINTAINER thesis). The 15
  `security`-type blocks are the block layer working; not in scope.

## Verdicts

1. **BUILD — extend the shared synthetic predicate.**
   `app/lib/calibration-mining.js`: add `loadtest-` to
   `SYNTHETIC_AGENT_RE` + `loadtest-%` to `SYNTHETIC_AGENT_LIKE_PATTERNS`;
   generalize the action-type side from the single `smoke.%` pattern to
   `['smoke.%','loadtest.%','liveproof.%']` and update all SQL consumers
   (`guardrails.repository` flood counting, `posture.repository` ×2,
   `tightening.repository`) plus `isSyntheticEvent`. The regex↔LIKE
   agreement test extends to pin the new families.
2. **NO CHANGE — the `rate_limit` evaluator in `app/lib/guard.ts`.**
   Per-agent scoping already isolates harness agents (unique
   `loadtest-<run>` ids); excluding synthetic traffic there would let a
   genuinely runaway harness run unbounded and touches the guard hot
   path for zero human-facing benefit. The valve tripping on the load
   harness is correct behavior; only its *visibility to humans* was
   wrong.
3. **NO CHANGE — the two rate_limit policy configs.** The ledger shows
   they never fired on a real session this era (7d require_approvals by
   real agents: protected-path only). Policy edits are Wes's to ratify
   (§3), and none is warranted by evidence.
4. **RECORD, DON'T FIX — protected-path over-breadth.** The 100%-approved
   `apply` interrupt pattern is the loosening direction's first live
   evidence. Per §2 (the maintainer never tunes a policy that interrupts
   its own sessions) this ships as recorded evidence for v4.5, which
   builds the human-ratified loosening-proposal path. No policy change in
   this ship.
5. **NO SCORER VECTORS this ship.** Neither wrong-interruption class
   found is a risk-scoring error (one is harness classification, one is
   policy shape). Forcing a golden vector would be mechanical compliance,
   not calibration. Recorded here as the explicit verdict the roadmap
   acceptance line requires.
6. **NO NEW UI SURFACE (explicit decision).** The fix restores the
   truthfulness of existing surfaces (flood banner, posture score +
   findings, session digest); there is nothing new for a human to
   operate. HUMAN-EXPERIENCE gate satisfied by the surfaces clearing.

## Acceptance

- Unit: predicate agreement test pins `loadtest-*`/`loadtest.%`/
  `liveproof.%` as synthetic in both regex and LIKE forms;
  `isSyntheticEvent` covers the new action-type prefixes.
- Flood: `getRecentApprovalCountsByPolicy` excludes the new families
  (test); the `?include_synthetic=1` diagnostic view still sees them
  (smoke positive control unchanged).
- Live proof after deploy: flood state clears via hysteresis on the next
  evaluation (banner + digest warnings gone); posture loses the
  `loadtest.read`/`liveproof.*` findings; re-running the diagnosis query
  with the shipped patterns shows the leak bucket at zero. (The approval
  dimension stays 0 until the stale `ps-qa:review_artifact` capability is
  covered or retired by the operator — see diagnosis.)
- Gates: lint, full vitest, `next build` (app/** touched), doc-counts.

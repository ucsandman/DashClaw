# /explain Claims Audit — does the runtime deliver what the page promises?

**Date started:** 2026-07-01
**Status:** IN PROGRESS — recon phase
**Method:** every testable claim on `public/explain/index.html` (and the runtime-api doc it mirrors) is listed below, mapped to implementing code, mapped to existing test coverage, then proven against a LIVE local instance with real policies via the policy smoke harness. Verdicts: `VERIFIED-LIVE` (proven against running server), `VERIFIED-UNIT` (existing automated coverage, not live-proven), `GAP-UNTESTED` (no proof either way), `GAP-BROKEN` (live test failed), `OVERPROMISE` (page claims semantics the runtime does not have).

## The claims ledger

### A. Guard decision semantics
- A1. `POST /api/guard` returns exactly one of `allow | warn | block | require_approval`.
- A2. Risk is computed server-side from structured fields (`action_type`, `reversible`, `systems_touched`, `declared_goal`); agent-supplied `risk_score` is advisory.
- A3. Effective risk = max(server-computed, agent-supplied); response carries both `risk_score` and `agent_risk_score`.
- A4. Risk bands 40 (elevated/warn) and 70 (high) drive decisions.
- A5. Blocks are absolute — a `block` is never downgraded by any approval.
- A6. Operator-approval grant: a `require_approval` decision is downgraded to `allow` when an identical action (same `agent_id`, same exact `declared_goal`) was human-approved within the last 15 minutes; `builtin:operator_approval` appears in `matched_policies`.
- A7. Prompt-injection scanning on `declared_goal` can reject with 400.

### B. Policy semantics (what the /explain policy playground implies a policy can do)
- B1. A policy can block specific action types (playground: "Blocked action types" → block).
- B2. A policy can enforce a SPEND CAP in USD — actions whose spend exceeds the cap do not proceed unmediated (playground: `$X exceeds the $Y cap` → require_approval). **← the user's named worry; never tested.**
- B3. A policy can require approval at/above a risk threshold (playground: `risk ≥ threshold` → require_approval).
- B4. Policies compose with precedence (blocked-type beats spend beats risk-threshold; playground row 6/7 behavior).
- B5. Policies are org-scoped, created via the API/dashboard, and take effect on the next guard call (cache invalidated on write).

### C. Record / ledger semantics
- C1. `POST /api/actions` runs guard internally; a policy-blocked action returns 403 AND leaves a `blocked` action record.
- C2. Approval-required actions are created with `status: "pending_approval"`.
- C3. Idempotency: same `(org_id, idempotency_key)` returns the existing action with `idempotent_replay: true` — no duplicate.

### D. Outcome finality
- D1. `POST /api/actions/:id/outcome` accepts `completed | partial | failed` only.
- D2. First terminal outcome wins; a later POST returns `409 { error: "outcome already set" }`.
- D3. `failed` requires `error_message`; `partial` requires `progress`.

### E. Assumptions
- E1. `POST /api/assumptions` with unknown `action_id` → 404; with a valid one → `asm_*` id returned.

### F. Approval flow
- F1. An approval posted to `/api/approvals/:actionId` flips a `pending_approval` action so `waitForApproval` resolves; rejection resolves it as rejected.

### G. Page-copy specifics that must stay true
- G1. The four integration snippets compile/run against the real SDKs (Node camelCase, Python dict-arg `guard`/`derive_idempotency_key` — fixed 2026-07-01 after the whole-branch review caught the kwargs bug).
- G2. "Fail closed" best-practice card: non_fabrication blocks on any error/malformed source-of-truth.
- G3. The simulator/playground are labeled illustrative — they need not match guard math, but they MUST NOT imply policy TYPES that don't exist (see B2).

### H. Agent's-advocate section (added 2026-07-02, roadmap item 4)
- H1. Every governed action's detail record (`GET /api/actions/:id`) carries an `agent_defense` rollup: declared fields, assumption counts, the FK-linked guard decision, and shield outcomes.
- H2. The linked decision in `agent_defense` is joined by `action_records.guard_decision_id` — the exact decision that governed the action, not a timestamp correlation.
- H3. The prompt-injection scan's outcome (`clean | warned | blocked | disabled`) is persisted with the decision (`context._shields`); rows from before this ship render as `not_recorded` — the surface never fabricates a "clean".
- H4. Assumptions recorded against the action appear in the rollup's counts (the alibi).
- H5. Spend-gate claims stay x402-scoped (inherits the B2 boundary; the advocate copy names x402 explicitly).

## Code map (from recon, 2026-07-01)

**Engine:** 15 policy types dispatched via `POLICY_EVALUATORS` (`app/lib/guard.ts:1480-1558`), 1:1 with the `/policies` UI picker (`app/policies/lib/policyFormModel.js:48-62`). Kill switch, deadline degradation, replay protection, prompt-injection scan are additional non-policy gates.

Claim-relevant findings:
- **A3 CONFIRMED** — effective risk = max(server, template, agent-clamped) at `guard.ts:846-889`, plus predictive adjustment; `risk_threshold` policies evaluate the final adjusted score.
- **A5/A6 CONFIRMED exactly** — `OPERATOR_APPROVAL_WINDOW_MINUTES = 15` (`guard.ts:580`); downgrade only from `require_approval`, exact `agent_id` + `declared_goal` match, `block` never touched (`guard.ts:592-623`).
- **B1 CONFIRMED** — `block_action_type` with `rules.action_types[]` (`guard.ts:1493-1494`).
- **B3 CONFIRMED** — `risk_threshold` with `rules.threshold` + `rules.action` (default 80/block) (`guard.ts:1481-1490`).
- **B2 NARROWER THAN THE PAGE IMPLIES** — the only guard-time monetary gate is `x402_spend_limit` (`guard.ts:1443-1477`): fires ONLY for `action_type === 'x402_purchase'` (reached via `POST /api/x402/purchases`), reads `cost_estimate`, `rules.max_spend_usd` → block, `rules.approval_threshold` → require_approval. NO generic USD cap on arbitrary action types; NO cumulative/monthly budget gate; `cost_estimate` on `/api/guard` + `/api/actions` is analytics-only. The /explain playground shows a cap catching generic `payment.create` rows → as illustrated, the runtime would not gate those.
- **A4 NUANCE** — 40/70 live in `riskThresholds.ts` as canonical *labeling* bands (UI color/filter only); guard decision thresholds come from `risk_threshold` policy rows and vary by mode (claude-code: warn 85 / block 100; enterprise-strict: warn 70 / block 90). The simulator's "real 40/70 thresholds" phrasing oversells bands as decision gates.
- **B5 MOSTLY CONFIRMED** — POST + PATCH `/api/policies` call `invalidateGuardPolicyCache` (`route.ts:82,169`); **DELETE does not** (`route.ts:182-226`) → deleted policy can keep firing for up to 30s (`GUARD_CACHE_TTL_MS`). Candidate one-line fix.
- x402 spend never emits `warn` — only block / require_approval / pass.

## Existing coverage map (from recon, 2026-07-01)

Unit-covered (mocked SQL, real logic): A1/A2 severity+decisions (`guard-engine`, `guard-characterization`), A3 max-of-scores (`guard-engine` + `authoritative-risk-persistence`), A5/A6 operator approval incl. 15-min interval SQL + blocks-absolute (`guard-operator-approval`), B1 block_action_type, B2* x402_spend_limit evaluator (`x402-guard-policy` — evaluator only, never through a live server), C1/C2 (`actions.route`), C3 idempotency (`actions.route`, `guard-route-idempotency`, `idempotency-golden`), D1-D3 (`action-outcome.route`), E1 (`assumptions-route`), F1 both sides (`hitl`, `approvals-route`), G2 non-fabrication fail-closed (`guard-non-fabrication`).

Gaps:
- **40/70 as decision thresholds: no coverage because it isn't a real behavior** (bands are UI labels; decisions come from risk_threshold policies, default 80).
- **rate_limit / "runaway loop": zero evaluateGuard coverage at the 650/60 config**, and the remembered "blocks HIGH-RISK only" behavior does not exist — the evaluator counts ALL actions, no risk filter; the claude-code preset compiles to require_approval, not block. (Stale project memory — correct it.)
- **Live-server coverage: exactly one test** (`__tests__/integration/hosted/end-to-end.test.js`), gated by `INTEGRATION_DATABASE_URL`, skipped in `npm test`. Everything else mocks the DB. Auth recipe it uses: `POST /api/hosted/workspaces` → fresh `oc_live_...` API key → `x-api-key` header. **No live test creates a policy and observes guard enforcement end-to-end. This is the hole the policy smoke harness fills.**

## Live harness results (2026-07-01, local dev server + local Postgres, org_default via operator key)

`node scripts/policy-smoke.mjs http://localhost:3211` → **24 checks, 24 passed, 0 failed.**

Every check creates real policies (agent-scoped, run-unique) over HTTP, fires real guard/actions/x402/approvals/outcome/assumptions calls, and cleans up after itself. Highlights of what is now LIVE-proven for the first time: x402 spend cap ($3 pass / $10 require_approval / $25+ block), operator-approval downgrade with `builtin:operator_approval`, blocks-absolute, pending_approval → human allow → running, idempotent replay, outcome 409 finality, instant policy deactivation via PATCH.

## Verdicts & fixes

| Claim | Verdict | Notes |
|---|---|---|
| A1 decision vocabulary | VERIFIED-LIVE | |
| A2/A3 server-side risk, max() blend | VERIFIED-LIVE | inflate honored, lowball masked |
| A4 40/70 bands | OVERPROMISE → FIXED | bands are labels, not decision gates; simulator lede now says so |
| A5 blocks absolute | VERIFIED-LIVE | |
| A6 15-min operator approval | VERIFIED-LIVE | `builtin:operator_approval` observed |
| B1 block_action_type | VERIFIED-LIVE | |
| B2 spend cap | VERIFIED-LIVE for x402; OVERPROMISE for generic payments → FIXED | playground rows/copy now x402-scoped; B2-NEG probe pins the boundary |
| B3 risk_threshold approval | VERIFIED-LIVE | |
| B5 cache invalidation on write | VERIFIED-LIVE (PATCH) + **BUG FIXED**: DELETE didn't invalidate (`app/api/policies/route.ts`) — now does, both single and bulk |
| C1/C2/C3 record semantics | VERIFIED-LIVE | 403+blocked record; pending_approval; idempotent_replay |
| D1-D3 outcome finality | VERIFIED-LIVE | 400s + 409 |
| E1 assumptions | VERIFIED-LIVE | |
| F1 approval flow | VERIFIED-LIVE | allow → running |
| G1 SDK snippets | VERIFIED vs sdk sources (Python dict-arg fix already shipped) |
| G2 non-fabrication fail-closed | VERIFIED-UNIT (guard-non-fabrication tests) |

**Known gaps flagged (not fixed here, need a product decision):**
1. ~~**Per-org API keys cannot authenticate on self-hosted local Postgres**~~ — **RESOLVED (2026-07-01).** `middleware.js resolveApiKey` used the Neon HTTP driver unconditionally, so DB-minted keys 401'd on TCP-only Postgres. Fixed by keeping the inline Neon path for hosted/Neon (byte-identical) and, on non-Neon self-host, delegating resolution to an internal Node route (`app/api/internal/resolve-key`, operator-key-guarded, self-host/non-Neon-gated) that uses the runtime-aware TCP driver. Edge middleware itself cannot open a TCP socket, and switching it to the Node runtime would move hosted/Vercel middleware off Edge — hence the internal-route hop rather than a runtime switch.
2. **No cumulative/monthly budget gate** — `x402_spend_limit` caps per-purchase amounts only. If marketing ever says "budget", that's not built.
3. **Wire-format quirk**: ~~`POST /api/policies` requires `rules`/`agent_ids` as JSON strings and `active` as an integer~~ — **FIXED 2026-07-01**: `validatePolicy` now normalizes object `rules`, boolean `active`, and array `agent_ids` to the stored forms; legacy string/integer forms unchanged. Pinned by unit tests and by the smoke harness, which now sends the natural shapes on every CI run.
4. **Runaway-loop lore correction**: `rate_limit` counts ALL agent actions (no high-risk filter) and the claude-code 650/60 preset emits require_approval, not block. Project memory corrected 2026-07-01.

**How to re-run this any time:** `npm run dev`, then `node scripts/policy-smoke.mjs` (defaults to :3000). Exits non-zero on any failure. Needs `DASHCLAW_API_KEY` + `DATABASE_URL` in `.env.local`.

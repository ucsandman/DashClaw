# DashClaw Hardening — Baseline, Threat Model & Findings Report

> Companion to `docs/plans/dashclaw-hardening.md`. Living artifact for the hardening goal run.
> **Status:** Phase 1 complete; Phase 2 audits synthesizing. Sections marked _(pending audit merge)_ fill in from the parallel audit workflow.

## 1. Baseline (Phase 1)

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD commit | `28c58a85` (`docs: surface FinOps Spend subsystem + x402 …`) |
| App version | `4.1.1` (platform + both SDKs unified) |
| Node | v24.15.0 |
| Working tree (other sessions — **do not touch**) | modified `.impeccable.md`; untracked `DESIGN.md`, `PRODUCT.md`, `docs/rfcs/0001-…`, `docs/superpowers/…x402…`. Hardening docs live under untracked `docs/plans/`. |

### Baseline verification results

| Command | Result |
|---|---|
| `npm run lint` | ✅ pass (12s) |
| `npx vitest run` | ✅ **2797 passed / 5 skipped / 0 failed** (372 files, 41s) |
| `npm run build` | ✅ pass (compiled + 76/76 static pages) |
| `npm run docs:check` | ✅ pass |
| `npm run contracts:check` | ✅ pass |
| `npm run openapi:check` | ✅ pass |
| `npm run api:inventory:check` | ✅ pass |
| `npm run route-sql:check` | ✅ pass (total 83 == baseline 83) |
| `npm run version:sync:check` | ✅ pass |
| `npm run scripts:check-syntax` | ✅ pass (133 files) |
| `npm run startup:smoke` | ⚠️ **pre-existing env failure** — `spawn EINVAL` at `scripts/startup-smoke.mjs:44` (Windows + Node v24 `child_process.spawn` without `shell:true`). Not a code defect. |
| `npm run test:api` | ⚠️ **needs live server** — `Cannot reach http://localhost:3000` (not runnable headless). |

**Baseline verdict:** clean. The two non-green commands are environmental (live server / Windows spawn quirk), not code defects, and are not attributable to any change made in this run.

## 2. Architecture map — governed-action lifecycle

Two governed-action entry paths share the same engine but diverge on identity/risk persistence:

```
                         ┌─────────────── middleware.js (edge) ───────────────┐
client ── x-api-key ───► │ default-deny /api/*; SHA-256 key→org_id; OAuth      │
        / Bearer / sess  │ bearer; rate-limit (ip:path); strips inbound        │
                         │ x-org-id/x-org-role/x-user-id; injects trusted ones │
                         └───────────────────────┬─────────────────────────────┘
                                                 ▼  (ORG boundary established; AGENT identity NOT)
   POST /api/guard ─────────► resolves identity (JWKS verify → sub overrides body), replay (jti),
   (read-only eval)           act-binding → evaluateGuard() → returns decision + authoritative risk
                                                 │
                              evaluateGuard(): computeRiskScore (server) ; effective = max(server, client) ;
                              +predictive → adjustedRiskScore ; persists guard_decisions  ◄─ FIRE-AND-FORGET
                                                 │
   POST /api/actions ───────► validateActionRecord → evaluateGuard → createActionRecord/Blocked
                              stores risk = data.risk_score||0  ◄─ CLIENT value, NOT guard's authoritative
                                                 │
   POST /api/x402/purchases ► presence-check only → evaluateGuard → createActionRecord (risk=body||0)
                              → createPurchase (no tx, no provider/endpoint/amount/currency validation)
                                                 │
                              approval: POST /api/approvals/[id] (admin, atomic CAS pending→running/failed)
                              outcome:  POST /api/actions/[id]/outcome (one-shot CAS pending→terminal)
                              x402 outcome: setPurchaseOutcome() exists but NO ROUTE CALLS IT
                                                 │
                              analytics/FinOps: getCostAggregation (excludes x402_purchase) +
                              getX402SpendAggregation → getFleetSpend (= agent + x402)
```

### Boundary trust table

| Boundary | Trust source | Tenant source | Identity source | Persistence guarantee | Failure mode |
|---|---|---|---|---|---|
| Auth (middleware) | API key / OAuth / session | `x-org-id` (injected) | org-level only | n/a | prod fail-closed if no key ✅ |
| Guard eval | server policies | `org_id` arg (throws if missing ✅) | JWKS-verified `sub` overrides body ✅ | **guard_decisions = fire-and-forget ❌** | DB error swallowed |
| Action create | API-key boundary | `getOrgId` (header) | **self-asserted `agent_id` ❌** (optional sig, off by default) | awaited INSERT ✅ | unique→409 |
| x402 purchase | API-key boundary | `getOrgId` | **self-asserted `agent_id` ❌** (no sig, no JWT) | action + purchase, **no tx/compensation ❌** | raw 500 |
| Approval | admin role ✅ | `org_id` | user (session) | atomic CAS ✅ | 409 race ✅ |
| Outcome | org-scoped (not agent) | `org_id` | none | one-shot CAS ✅ | 409 conflict ✅ |
| FinOps | read-only agg | `org_id` ✅ | n/a | no writes ✅ | 500 on error |

## 3. Threat model — confirmed (first-hand) issues vs. invariants

| # | Invariant (plan §3/§4) | Status | Evidence |
|---|---|---|---|
| T1 | Verified identity overrides self-asserted; self-asserted marked explicitly | **VIOLATED** | `/api/actions` & `/api/x402/purchases` never call JWKS verify; trust body `agent_id`. Only `/api/guard` verifies. |
| T2 | Authoritative server risk stored consistently everywhere | **VIOLATED** | `actions.repository.js:273,349` store `data.risk_score||0`; guard's `adjustedRiskScore` only in `guard_decisions`. x402 stores `body.risk_score||0`. |
| T3 | Required guard audit evidence durable before success | **VIOLATED** | `guard.js:401` `void sql\`INSERT INTO guard_decisions…\`.catch()` — explicit fire-and-forget; serverless can drop it. |
| T4 | x402 amounts finite & non-negative; currency explicit | **VIOLATED** | x402 route `Number(...)||0` passes Infinity & negatives; `currency: body.currency` no allow-list; repo `spend_amount ?? 0`. |
| T5 | x402 provider/endpoint integrity + tenant isolation + disabled-provider | **VIOLATED** | `createPurchase` stores `provider_id`/`endpoint_id` with no existence/org/enabled/provider-match checks; no DB FK. |
| T6 | x402 action+purchase consistency (no partial write) | **VIOLATED** | route creates action then purchase in 2 awaits; no tx (Neon HTTP) / compensation → orphan on partial failure. |
| T7 | x402 purchase outcome consistent with action outcome | **VIOLATED** | `setPurchaseOutcome` called by no route; `execution_status` stuck at pending/approved; action outcome updates only `action_records`. |
| T8 | Wallet/payment references treated as sensitive | **VIOLATED** | x402 route + repo store `wallet_reference`/`payment_reference` raw; `scanSensitiveData` doesn't match wallet addresses. |
| T9 | x402 purchase idempotency / no duplicates | **VIOLATED (medium)** | fresh `act_…` id per call → every POST = new purchase; no idempotency key. |
| T10 | Agent LLM Spend excludes `x402_purchase` | **HOLDS** ✅ | `getCostAggregation` `AND action_type <> 'x402_purchase'`. |
| T11 | Fleet = Agent LLM + x402 | **HOLDS** ✅ | `getFleetSpend` sum. |
| T12 | FinOps read-only, no repricing | **HOLDS** ✅ | aggregates stored cost; `billing.js` canonical; parity test green. |
| T13 | x402 spend counts only real spend | **QUESTION (medium)** | `getX402SpendAggregation` sums all rows incl. pending/failed `execution_status` → may overstate. Semantic — flag for operator. |
| T14 | Server risk may be increased by client, never reduced | **HOLDS for decision** ✅ | `effectiveRiskScore = max(server, client)` — but stored value (T2) is wrong. |

### Parent-owned shared-contract decisions (to implement in Phase 4)

1. **Shared identity resolver** `resolveAgentIdentity(request, body, sql)` — extract guard's inline JWKS+replay+act block into `app/lib/identity-resolution.js` (or extend `app/lib/identity.js`); return `{ agent_id, agent_name, verification_status, replay_status, act_status, act_hash, jti }`. Guard keeps current behavior; `/api/actions` & `/api/x402/purchases` adopt it. Verified `sub` overrides body; absent JWT → `unverified` (explicit). Backward compatible (no JWT = today's behavior).
2. **Authoritative risk propagation** — thread `guardDecision.risk_score` into `createActionRecord`/`createBlockedActionRecord` (new `riskScore` payload field; falls back to `data.risk_score||0` when absent so other callers are unaffected). Store `max(authoritative, clientClamped)`. One value flows to action_records, alerts, analytics, dashboard.
3. **Durable guard evidence** — make the required `guard_decisions` INSERT awaited; on failure, surface explicitly (the engine already throws on missing org). Keep best-effort for the SSE event + learning enrichment. Add a tested DB-failure path. (Neon HTTP has no multi-statement tx; a single awaited INSERT is the durability unit.)
4. **x402 hardening** — a Zod-or-equivalent schema for purchase input: finite non-negative `spend_amount`, `currency` allow-list, provider exists+active+org, endpoint exists+enabled+belongs-to-provider+org. Authoritative risk + shared identity. Compensating cleanup if purchase-detail insert fails after action insert (delete/mark the orphan action; idempotent). Optional idempotency key. Redact wallet/payment references at rest (keep last4 for reconciliation). **No payment execution, no wallet custody.**
5. **FinOps** — keep invariants; add drift-guard regression tests; decide T13 (pending/failed inclusion) with operator.

## 4. Prioritized findings (Phase 2 — 12/12 audits, 82 findings)

**Severity totals:** 0 critical · 25 high · 31 medium · 16 low · 10 info. Independent corroboration was strong: the three plan-headline concerns were each independently flagged by 3–7 of the 12 audits. The 25 highs collapse to ~11 distinct root issues. Full raw set: workflow journal (`…/wf_b2b9c132-632/findings.json`).

### Confirmed high-severity root issues (dedup of the 25 highs)

| # | Root issue | Corroborating audit IDs | Key file:line |
|---|---|---|---|
| R1 | **Authoritative risk not persisted** — `action_records`/`x402_purchases` store the client `risk_score` (or 0); guard's authoritative `adjustedRiskScore` lives only in `guard_decisions`. Ledger/alerts/analytics/dashboard show a forgeable number. | Lifecycle-A2, B1, A1(A), A1(D), G1, J1, I-T1 | `actions.repository.js:273,349`; `actions/route.js:247`; `x402/purchases/route.js:80` |
| R2 | **Guard audit evidence is fire-and-forget** — required `guard_decisions` INSERT is `void sql\`…\`.catch()`; serverless freeze drops it. | Lifecycle-A1, C1, I-T2 (+B3,A3,G10 med) | `guard.js:398-424` |
| R3 | **Identity asymmetry** — `/api/actions` & `/api/x402/purchases` never run JWKS verification and never persist a verification flag; self-asserted `agent_id` is indistinguishable from verified at the record layer. | A1(A), G3 (+A4 med) | `x402/purchases/route.js:50-101`; `actions/route.js:163-194` |
| R4 | **x402 spend amount unbounded/negative/non-finite** — `Number(x)||0` lets Infinity & negatives through; bypasses `x402_spend_limit` and corrupts Fleet Spend. | D-X1, H1 (+G6 med) | `x402/purchases/route.js:53`; `x402.repository.js:99-115` |
| R5 | **x402 provider/endpoint integrity + cross-tenant** — `provider_id`/`endpoint_id` accepted from body with no existence/org/enabled/belongs-to-provider check; no FK. | A2(A), G4 (+X2 med) | `x402/purchases/route.js:87`; `x402.repository.js:99` |
| R6 | **`x402_spend_limit` matches provider NAME but record stores `provider_id`** — allow/block lists silently never match. | B2, G2 (+X3 med) | `guard.js:850-863`; `x402/purchases/route.js:48-55` |
| R7 | **x402 action+purchase partial-write** — two non-transactional INSERTs, no compensation → orphan action on failure. | C2 (+G8 med) | `x402/purchases/route.js:71-101` |
| R8 | **x402 outcome drift** — `setPurchaseOutcome` has zero callers; `execution_status` never leaves pending/approved; outcome route updates only `action_records`. | C3, G5 (+E4,B2-lifecycle med) | `x402.repository.js:129`; `actions/[id]/outcome/route.js:115` |
| R9 | **Wallet/payment references stored raw + echoed in response** — unlike `/api/actions`, x402 runs no redaction; `scanSensitiveData` doesn't match wallet addresses anyway. | F1 (+G11 low, F5 low) | `x402/purchases/route.js:87-103`; `x402.repository.js:99` |
| R10 | **Outcome endpoint ignores lifecycle status** — agent can fabricate a `completed` outcome on a blocked/denied/not-yet-approved action (gate is only `outcome_status='pending'`). | E1 | `actions/[id]/outcome/route.js:115`; `actions.repository.js:582` |
| R11 | **Outcome reporting: no role gate, no agent binding** — any org member/token can finalize any agent's action. | E2 | `actions/[id]/outcome/route.js:59` |
| RT | **Test gaps** for R1–R3 + jti concurrency + x402 validation + tenant isolation + FinOps equation (existing suite is heavily mocked; ON-CONFLICT/table-name bugs slipped past before). | I-T1..T7, J | `__tests__/**` |

### Notable mediums/lows folded into the fixes
- **B5** `x402_spend_limit` absent from `validate.js` POLICY_TYPES → can't be authored via the validated `/api/policies` route (even though the engine enforces it).
- **F2/G12** x402 free-text (`declared_goal`/`purchase_reason`/`context_gap`) bypasses DLP redaction, prompt-injection scan, and length caps that `/api/actions` applies.
- **J2/V1** 44/242 routes (incl. all x402 + finops + approvals) bypass `apiErrorResponse` → bare 500s hide schema-not-init.
- **A6/C5** x402 stores agent-claimed `spend_amount` with no server recomputation vs `endpoint.default_price` (deeper reconciliation — noted, not in scope this run).
- **K1** README SDK counts stale (104/203 vs live 125/223); **K2** CHANGELOG behind (4.0.2 vs 4.1.1); **K3** `schema.js` missing x402/reputation/registry tables; **K4** `.env.example` missing `DASHCLAW_ALLOWED_ISSUER`/`DASHCLAW_JWT_AUDIENCE`; **K6** OpenAPI `info.version` hardcoded 2.0.0.

### Rejected / confirmed-non-issues (no action)
- FinOps core invariants **hold** (Agent LLM excludes `x402_purchase`; Fleet = Agent + x402; no repricing; rate-card parity green) — H/B/I audits verified end-to-end.
- jti in-line sweep fire-and-forget is **acceptable** (not an audit-durability path) — C6.
- Middleware tenant boundary, header-stripping, prod fail-closed, SSRF on webhooks/JWKS — **sound**.

## 5. Remediation plan, ownership, approval gates (Phase 3)

**Execution model:** the core fixes (R1–R10) are tightly interdependent across `guard.js`, `actions.repository.js`, the shared identity helper, and the 3 routes — per plan §21.3 "do not delegate the immediate parent critical path," the **parent implements R1–R12 directly, test-first (TDD)**. Independent, non-overlapping work (docs P16) may be delegated. Phase 6 adversarial review runs as a workflow.

| Packet | Root | Files (write) | Verification |
|---|---|---|---|
| P1 Shared identity resolver | R3 | new `app/lib/identity-resolution.js` (extract guard's JWKS+replay+act block); `actions/route.js`, `x402/purchases/route.js` adopt it; persist `verified` truthfully | unit: verified JWT sub overrides body; no JWT → unverified; cross-tenant sub rejected |
| P2 Authoritative risk propagation | R1 | `guard.js` (already returns `risk_score`); `actions.repository.js` createActionRecord/Blocked accept `riskScore`; `actions/route.js`, `x402/purchases/route.js` pass `guardDecision.risk_score` | unit: stored risk == max(authoritative, client); deploy+`rm -rf` reports 0 → stored ≥ server score |
| P3 Durable guard evidence | R2 | `guard.js` await required INSERT; explicit failure; keep best-effort SSE/learning | unit: INSERT rejection surfaces (no silent loss); existing guard tests still pass |
| P4 x402 input validation | R4, B5, F2/G12 | `validate.js` (new `validateX402Purchase` + add `x402_spend_limit` to POLICY_TYPES); `x402/purchases/route.js` | unit: negative/NaN/Infinity → 400; currency format; length caps; DLP redaction |
| P5 x402 provider/endpoint integrity | R5, R6 | `x402/purchases/route.js` resolve+verify provider (org+active) & endpoint (org+enabled+belongs); pass provider name to guard ctx | unit: cross-tenant/missing/disabled → 400/404; spend-limit allow/block now matches |
| P6 x402 consistency + outcome | R7, R8 | `x402/purchases/route.js` compensating cleanup on purchase failure; `actions/[id]/outcome/route.js` syncs `setPurchaseOutcome` | unit: purchase-insert failure removes orphan action; outcome updates execution_status |
| P7 Reference redaction | R9 | `x402/purchases/route.js`/`x402.repository.js` redact wallet/payment refs at rest + response (keep last4) | unit: raw ref not stored/echoed |
| P8 Outcome lifecycle gate | R10 (R11 partial) | `actions.repository.js setActionOutcome` / outcome route gate on lifecycle `status` | unit: completed-on-blocked/pending_approval → 409/400 |
| P9 Error contract | J2 (x402 subset) | x402 + finops routes adopt `apiErrorResponse` | schema-not-init returns 503 |
| P10 Regression tests | RT | `__tests__/unit/*` for all above + tenant isolation + FinOps equation | `npx vitest run` green |
| P11 Docs/deploy | K1,K2,K4,K6 | README counts, CHANGELOG, `.env.example`, OpenAPI version | `docs:check`, `version:*`, `openapi:check` |

### Approval-gate analysis

**All P1–P11 are scoped to avoid every approval gate** (no DB schema-semantic change, no money representation/precision change, no currency-behavior allow-list, no cross-table FK, no payment execution/wallet custody, no historical repricing, no framework/db change, no commit/push/deploy). Validation tightening that returns 400 for previously-accepted malformed x402 input is **mandated** by plan §9.5/§9.7 ("do not weaken validation to preserve invalid callers"), not gated. `action_records.risk_score` keeps its column/type/meaning — storing the authoritative value is a correctness fix, not a contract change.

**Deferred — require explicit operator approval (NOT done this run):**
1. Richer `verification_status` enum column on `action_records` (migration) — using existing `verified` boolean instead.
2. Hard currency allow-list (currency-behavior gate) — using format validation instead.
3. Excluding pending/failed purchases from Fleet Spend aggregation (money-figure semantics) — fixing `execution_status` accuracy only; aggregation math unchanged.
4. Server reconciliation of `spend_amount` vs `endpoint.default_price` (A6) and x402 purchase idempotency key (G9).
5. Per-org JWKS issuer binding (A5); `apiErrorResponse` `detail` leak hardening (D-E1) behind a flag.
6. `schema.js` x402/reputation/registry table defs (K3) — drizzle source-of-truth; deferred to the TS-migration to avoid drizzle-kit drift risk now.

## 6. Implementation (Phase 4 — completed, TDD)

All fixes were written test-first (RED → GREEN), parent-implemented (the core fixes are too interdependent to delegate per plan §21.3). Nothing committed.

| Root | Change | Files | Tests |
|---|---|---|---|
| R1 | `createActionRecord`/`createBlockedActionRecord` persist an authoritative `riskScore` (clamped 0-100), legacy-fallback to client value; both routes pass `max(guard score, clientClamped)` | `actions.repository.js`, `actions/route.js`, `x402/purchases/route.js` | `authoritative-risk-persistence.test.js`, `actions.route.test.js` (R1 ×3), `x402-purchases-hardening.route.test.js` |
| R2 | Guard `guard_decisions` INSERT is now **awaited** with explicit failure (`GUARD_AUDIT_PERSIST_FAILED`) — no more fire-and-forget | `guard.js` | `guard-audit-durability.test.js` |
| R3 | New shared `resolveAgentIdentity()`; adopted by `/api/actions` (+ JWT verified flag) and `/api/x402/purchases` (verified sub overrides body; self-asserted stays explicitly unverified) | new `identity-resolution.js`, `actions/route.js`, `x402/purchases/route.js` | `identity-resolution.test.js`, route tests (R3) |
| R4 | `validateX402Purchase`: rejects missing rationale, negative/NaN/Infinity spend, malformed currency, oversized text | `validate.js`, `x402/purchases/route.js` | `validate-x402.test.js`, hardening route test |
| R5 | x402 route verifies provider (org+active) & endpoint (org+enabled+belongs-to-provider) when ids supplied; endpoints route verifies parent provider | `x402/purchases/route.js`, `x402/providers/[id]/endpoints/route.js` | hardening route test (R5 ×3), endpoints route test (X2) |
| R6 | Guard context carries resolved provider **name + id**; `x402_spend_limit` matches lists against both | `x402/purchases/route.js` (guard ctx) | hardening route test |
| R7 | Partial-write compensation: orphan action deleted if purchase-detail insert fails | `x402/purchases/route.js` | hardening route test (R7) |
| R8 | Outcome route syncs `setPurchaseOutcome` (completed→succeeded, partial→partial, failed→failed) for x402 actions | `actions/[actionId]/outcome/route.js` | `action-outcome.route.test.js` (R8) |
| R9 | wallet/payment references masked at rest + in response (keep last 4) | `x402/purchases/route.js` | hardening route test (R9) |
| R10 | Outcome route rejects outcomes on `blocked`/`pending_approval`/`cancelled`/`failed` actions | `actions/[actionId]/outcome/route.js` | `action-outcome.route.test.js` (R10 ×3) |
| B5 | `x402_spend_limit` added to POLICY_TYPES + validator case + full policy-form-model support (picker/compile/decompile/summary) | `validate.js`, `app/policies/lib/policyFormModel.js` | `validate-x402.test.js`, `policy-types-coverage.test.js` |
| F2 | x402 free text DLP-redacted (`redactAny`) before storage, matching `/api/actions` | `x402/purchases/route.js` | (covered by route flow) |
| J2 | x402 provider/endpoint/purchase routes adopt `apiErrorResponse` | `x402/**` routes | provider/endpoint route tests |

**New tests:** `authoritative-risk-persistence.test.js`, `identity-resolution.test.js`, `validate-x402.test.js`, `guard-audit-durability.test.js`, `x402-purchases-hardening.route.test.js` (+ additions to `actions.route.test.js`, `action-outcome.route.test.js`, `x402-provider-endpoints.route.test.js`, `x402-guard-policy.test.js`, `policy-types-coverage.test.js`).

**Two self-caught refinements during review:**
- **R1 consistency:** initially stored `max(guardDecision.risk_score, clientClamped)`, which could diverge from `guard_decisions` when predictive risk lowers the score below a client report. Changed to store `guardDecision.risk_score` verbatim (the engine already folds the client raise into `effectiveRiskScore = max(server, client)`), so `action_records.risk_score == guard_decisions.risk_score` exactly (plan §3.3 consistency).
- **R6 completion:** the route resolves+passes provider name **and** `provider_id`; `guard.js` `x402_spend_limit` now matches allow/block lists against **both** (was name-only), so lists keyed by id work.

**Deferred (documented, not done — see §5 approval gates):** R11 agent-identity binding on outcome (org-scope kept; lifecycle gate closes the exploit); guard-route code-level convergence onto `resolveAgentIdentity` (semantics already consistent; defer to TS migration); hard currency allow-list; spend-aggregation status filter; `endpoint.default_price` reconciliation; x402 idempotency key; K1 README SDK-count drift (pre-existing 4.1.0, multi-surface) and K6 OpenAPI version (cascades to regenerated artifacts).

## 7. Adversarial review (Phase 6) — 12 independent reviewers

Verdicts: **1 holds, 10 partial, 1 broken** (the "broken" was the policy-UI no-op, now fixed). Reviewers were instructed to DISPROVE each fix. **5 confirmed critical/high actionable findings** surfaced; all resolved:

| Finding | Severity | Resolution |
|---|---|---|
| x402 `expected_value` / `alternatives_considered` (and `agent_name`) stored un-redacted | high | **Fixed** — `redactAny` now covers all stored x402 free text |
| x402 spend aggregation counts failed/retried purchases (overstates Fleet spend) | high | **Fixed (operator-approved)** — `getX402SpendAggregation` excludes `execution_status = 'failed'`; idempotency deferred per operator |
| R6: `x402_spend_limit` ignores `provider_id` (×2 reviewers) | high | **Already fixed** before review finished — `guard.js` `inList()` matches name OR id (the reviewers read pre-fix code); verified + tested |
| `x402_spend_limit` selectable in UI but renders no inputs → no-op policy | high | **Fixed** — added rule-builder section (max spend, approval threshold, allow/block providers) |

**Mediums also fixed:** R5 endpoint-without-provider skipped provider-active check; R7 outer-catch could orphan a purchase row (now nulls the compensation marker after success); fractional `risk_score` → integer column (now `Math.round`'d); guard audit row recorded `unverified` for verified actions (now threads `verification_status` into the guard context on both routes).

**Verified-and-accepted / documented (not changed):**
- **R1 on other guard-running routes** (capabilities invoke/test, workflows execute/resume): they persist a **server-derived** risk (`RISK_SCORE_MAP[risk_level]`, hardcoded constants) — **not** client-forgeable — so the R1 *high* doesn't apply; threading the guard's value for full action↔guard consistency is a documented follow-up.
- **Verified-JWT replay on `/api/actions` & `/api/x402/purchases`**: `resolveAgentIdentity` does JWKS verification but not jti-replay recording (replay protection remains guard-flow-specific to avoid double-counting the same jti across guard→action). Accepted scope; documented.
- **MCP edge fail-closed**: the server now fails *loud* (500, no `decision`) on audit-persist failure; whether the MCP client/skill treats a missing decision as fail-closed is a client concern — documented as a skill follow-up.
- **Tenant isolation**: reviewer verdict **holds** across all changed paths (every repo call org-scoped; middleware strips inbound org headers).
- **FinOps**: core invariants intact; the only change is the approved failed-exclusion filter.

## 8. Final report

**Baseline:** `main @ 28c58a85`, version `4.1.1`, Node 24. Baseline suite green (2797 tests); pre-existing non-green: `startup:smoke` (Windows+Node24 `spawn EINVAL`) and `test:api` (needs live server) — environmental, not code, unchanged by this work.

**Architecture & threat model:** §2–§3. **Findings:** §4 (82 findings: 0 critical, 25 high, 31 medium, 16 low, 10 info). **Confirmed vs rejected:** §4 (FinOps invariants, jti in-line sweep, middleware boundary confirmed sound — not issues).

**Changes implemented:** §6 (R1–R10, B5, F2, J2) + §7 (post-review hardening). **Files modified (production):** `app/lib/guard.js`, `app/lib/validate.js`, `app/lib/repositories/actions.repository.js`, `app/lib/repositories/x402.repository.js`, `app/lib/identity-resolution.js` (new), `app/api/actions/route.js`, `app/api/actions/[actionId]/outcome/route.js`, `app/api/x402/purchases/route.js`, `app/api/x402/providers/route.js`, `app/api/x402/providers/[id]/route.js`, `app/api/x402/providers/[id]/endpoints/route.js`, `app/policies/lib/policyFormModel.js`, `app/policies/components/PolicyRuleBuilderSection.jsx`; docs: `.env.example`, `CHANGELOG.md`, `docs/plans/dashclaw-hardening-report.md`.

- **Identity & tenant changes:** shared `resolveAgentIdentity` on actions+x402 (verified JWT overrides body; `verified` persisted); endpoints route verifies parent provider; tenant scoping unchanged (already sound) and re-verified.
- **Risk & audit changes:** `action_records.risk_score` = guard authoritative score (consistent with `guard_decisions`); guard audit INSERT awaited + fail-loud; `adjustedRiskScore` rounded.
- **x402 changes:** strict input validation (amount/currency/text); provider/endpoint integrity + active/enabled/belongs checks; provider name+id policy matching; partial-write compensation; wallet/payment reference masking; outcome→execution_status sync; `x402_spend_limit` authorable end-to-end; failed purchases excluded from spend.
- **FinOps changes:** only the approved `execution_status <> 'failed'` filter; equation and exclusions otherwise intact.
- **Money/currency decisions:** no precision/representation/repricing change; currency = format validation (no hard allow-list — gated, deferred); failed-spend exclusion = explicit operator approval.

**Tests added:** 6 new files + extensions (see §6). New + existing suite green.

**Remaining risks / deferred (require approval or a later milestone):** richer `verification_status` column (migration); hard currency allow-list; spend `default_price` reconciliation; x402 idempotency key (operator: defer); per-org JWKS issuer binding; R1 consistency on the 4 server-derived guard routes; MCP fail-closed skill guidance; K1 README SDK-count drift + K6 OpenAPI version (pre-existing 4.1.0, cascade to regenerated artifacts); guard-route convergence onto `resolveAgentIdentity`; `schema.js` x402/reputation/registry table defs.

**Recommended TypeScript-migration follow-up (per `docs/plans/typescript-migration.md`):** type the now-shared identity/risk/x402 contracts (`AuthenticatedAgentContext`, `RiskScore`, `X402PurchaseInput`, `SpendAmount`, `CurrencyCode`); make `verification_status` a typed enum persisted on `action_records` (the migration that closes the deferred column item); unify pricing behind `@claw/engine`; convert `guard.js`/`x402.repository.js`/`finops.repository.js` first (pure, high-value).

## 9. Verification results (final gate — all green)

| Command | Result |
|---|---|
| `npm run lint` | ✅ pass |
| `npx vitest run` | ✅ **2839 passed / 5 skipped / 0 failed** (378 files; +42 over baseline 2797) |
| `npx next build` | ✅ compiled successfully |
| `npm run docs:check` | ✅ docs validation passed |
| `npm run contracts:check` | ✅ contracts check passed |
| `npm run openapi:check` | ✅ pass (no route contract drift) |
| `npm run api:inventory:check` | ✅ pass |
| `npm run route-sql:check` | ✅ pass (current 83 == baseline 83 — no new direct route SQL) |
| `npm run version:sync:check` | ✅ pass |
| `npm run scripts:check-syntax` | ✅ pass (133 files) |
| `npm run test:api` | ⚠️ needs live server (pre-existing/environmental) |
| `npm run startup:smoke` | ⚠️ Windows+Node24 `spawn EINVAL` (pre-existing/environmental) |

Nothing committed/pushed/deployed. All work is local and reversible.

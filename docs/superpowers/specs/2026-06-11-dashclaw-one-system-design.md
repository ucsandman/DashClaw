# DashClaw: One System — Missing Organs Design

**Date:** 2026-06-11 · **Status:** Approved direction (trust-first sequence), spec pending user review
**Decided by:** Wes, in brainstorm session grounded in all FABLE5 audit docs (Jun 9–10) + live re-verification of DashClaw v4.14.0 on Jun 11.

---

## 1. The vision (confirmed by Wes)

The portfolio's ~116 directories are puzzle pieces of **one system, in three layers**:

1. **Proof layer — the trustworthy autonomous company.** A self-running AI business that builds, ships, sells, contacts, and spends — made viable because every action is governed and every claim is provable.
2. **Product layer — agent trust infrastructure.** The capabilities everyone else's agents will need: identity, governed action, signed receipts, verified work, governed money and communication. **This is DashClaw. DashClaw is the spine.**
3. **Endgame layer — the public commons.** A free, account-free, verify-by-hash layer (the TrueName concept) where anyone, on any device, can ask "is this real, and who vouches for it?" about anything an AI produced or did.

Explicit decisions made in this session:
- **The 30-day no-new-repos rule is overridden for this program** (Wes: "this is the exception"). In practice the program barely needs the exception — every organ lives inside the existing DashClaw repo.
- **Sequence: trust-first (option A)** — fix the spine's reflexes before hanging new organs on it; build the unique conscience piece next; make its receipts public third; then hands, mouth, wallet.
- Borrowed from option B: organ 4's first dogfood job is Wes's own remaining launch tails, so the layer-1 proof arrives mid-program.

## 2. Ground truth (verified 2026-06-11 against DashClaw main, v4.14.0)

DashClaw has moved past the Jun 9–10 audit: `dashclaw install claude` ships (`cli/bin/dashclaw.js:486-495`), finops spend attribution and approval-flood work landed, version is 4.14.0. **All file:line references in the FABLE5 audit docs are stale; each phase must re-ground against current code before editing.**

Probed and confirmed missing today:
- No verified-completion / shipped-as-claimed code anywhere in `app/`, `cli/`, `hooks/`, `mcp-server/`.
- No `dashclaw verify` command; receipt verification only via POST to the issuing instance.
- `app/lib/guard.ts`: zero `deadline`/`AbortSignal` hits; no kill-switch/pause route under `app/api`.
- No outbound/communication module, no treasury/spend-policy/x402 module in `app/lib`.

## 3. The six missing organs

| # | Organ | Role in the body | Build order |
|---|---|---|---|
| 3 | Guard enforcement contract | Reflexes — the spine must fail closed | **Phase 1** |
| 1 | Verified completion receipts | Conscience — "done" must be proven | **Phase 2** |
| 2 | Public verify-by-hash | Public eye — anyone can check the proof | **Phase 3** |
| 4 | Governed launch-tail execution | Hands — the company can actually ship | **Phase 4** |
| 5 | Governed outbound | Mouth — contact humans without breaking the law | **Phase 5** |
| 6 | Governed spend | Wallet — spend money under policy | **Phase 6** |

### Phase 1 — Guard enforcement contract (lean cut, ~3–4 days)

A trust spine that fails open isn't a trust spine. From the deep-sweep findings (re-verify each against v4.14.0):

- **Deadline:** bounded guard evaluation (~3.5s Promise.race) in `/api/guard`; on deadline, return a degraded `require_approval`, never hang the hook into its 5s timeout → exit-2 brick.
- **Fail-closed defaults:** flip webhook `on_timeout` default and semantic-fallback default from `'allow'` to fail-closed; escape hatch `DASHCLAW_GUARD_FALLBACK` env var for self-hosters.
- **MCP parity:** MCP client errors map to fail-closed (behind the same env var); MCP guard context expanded to match the hook's field set so protected-path/secret-scan/content policies actually fire on MCP.
- **Idempotency:** clients derive idempotency keys (tool_use_id-based) so blind retries stop duplicating the audit ledger; guard dedupe.
- **Kill switch:** an org-level pause ("halt all agents") endpoint + honored by hook and MCP paths.
- **Mirror-pipeline hardening (corrected 2026-06-12):** hook mirroring is already automated — livingcode regenerates `plugins/dashclaw/hooks/*.py` from canonical `hooks/*.py` on every pre-commit (`scripts/livingcode-refresh.mjs`). Edit canonical `hooks/` only; the real gaps are the stage-artifacts list (mirrors sometimes land in follow-up commits) and one hook missing from the post-merge regen manifest.

Acceptance: full vitest green; new tests for each inversion; a webhook-timeout simulation returns `require_approval` within the deadline; kill switch verified end-to-end on hook + MCP.

### Phase 2 — Verified completion receipts ("shipped-as-claimed", ~1–2 weeks)

The piece nobody ships and Wes has unique data for (dataclaw: 679 correction turns; rule #1: "Never report success you haven't verified — needs a Stop-hook/enforcement, not just prose").

- **Stop-hook verification gate:** at session end, extract the agent's completion claims, recompute evidence fail-closed:
  - working tree vs claims (supergoal repo-state comparison pattern — files claimed shipped actually changed),
  - commands claimed run actually ran with exit 0 (transcript tool results),
  - optional check modules harvested from git-intelligence's immune system (tests, secret-scan, regression).
- **Verdict:** `SHIPPED_AS_CLAIMED | UNVERIFIED | CONTRADICTED`, fail-closed semantics. **Observe-mode default** (recap line, no blocking); enforce mode opt-in.
- **Signed completion receipt:** issue an Ed25519 receipt through the existing integrity layer per verified session — the first production receipt issuer on the Claude Code path (today: zero receipts ever issued on the wedge).
- **Surface:** `dashclaw receipts` CLI list; receipt linked from the session view; Stop-hook recap line extended ("verdict: shipped-as-claimed — receipt a1b2c3").

Acceptance: a session that claims a file change it didn't make is flagged `CONTRADICTED`; a clean verified session yields a signed receipt that validates via the existing `/api/integrity/verify` endpoint (Phase 3 adds the offline path); no prompt content in receipts; hook stacks identical.

### Phase 3 — Public verify-by-hash: the TrueName seed (~1 week)

Makes Phase 2's receipts (and all integrity receipts) checkable by anyone — the embryo of the commons.

- **`dashclaw verify <receipt-file|hash>`:** zero-dependency offline verifier (fetch JWKS, check Ed25519 signature + canonical hash). Packaging check first: confirm what `@dashclaw/cli` actually publishes.
- **`dashclaw-receipt/v1` spec:** one page, public, in-repo docs — the issuing convention others can adopt.
- **Public lookup:** account-free GET — content-addressed receipt retrieval at `/.well-known/dashclaw/receipt/<hash>` + a no-login verify page.
- **Architecture decision (records the TrueName open question):** v1 transport is **HTTPS `.well-known` + JWKS, not DNS.** The concept review's load-bearing question ("why DNS once the cache-smear is dropped?") is answered: it isn't, yet. Content-addressed naming is designed so a DNS TXT mirror can be added later without breaking the spec. The TrueName guardrail carries over: **the verify path is public, free, and account-free — non-negotiable.**
- Fatten the signed compliance bundle with full decision rows (deep-sweep Cut 1 leftover).

Acceptance: a receipt issued in Phase 2 verifies offline on a machine with no DashClaw account; tampering one byte fails verification; the spec doc exists and matches the implementation.

### Phase 4 — Governed launch-tail execution (~1–2 weeks)

The audit's central finding ("revenue is structurally switched off; the launch tail is the bottleneck; nothing ever crosses the live switch") turned into a capability. The hands already exist — the dashclaw-local/offlocal MCP (Stripe, DNS, Vercel, Neon, Resend, Twilio, plus `simulate_action`/`check_policy`/`approve_action`). The missing piece is the governed runbook around them:

- **Declarative launch runbook:** a tail (DNS record, Stripe price, env var, deploy, domain) expressed as steps; each step runs simulate → guard → approval-if-required → execute → record → **signed receipt**.
- **Human gates are surfaced, never bypassed** (10DLC forms, live-mode activations, anything irreversible without approval).
- **First dogfood job:** Wes's own remaining revenue tails (per SUPERGOAL_REVENUE_TAILS.md — verify live state first; some are already done). The system's first autonomous act is shipping the portfolio's launch tails under governance, with publicly verifiable receipts. That is the layer-1 proof.

Acceptance: one real launch tail executed end-to-end by the system with zero ungoverned mutations, an approval exercised, and a receipt chain a stranger can verify via Phase 3.

### Phase 5 — Governed outbound (~1 week)

Safe outbound was built six times; leak-autopilot's `canSendReal()` is crowned canonical. DashClaw gets the policy surface:

- Outbound policy types guard can evaluate: consent-required, quiet-hours, channel-registration (10DLC), rate caps, suppression-list.
- A `safe-outbound-starter` policy pack mirroring `canSendReal()`'s checks.
- leak-autopilot integration: its send path records through DashClaw (guard + receipt per outbound action) — the public case study ("AI outbound that can never message the wrong person"), now with verifiable receipts.

Acceptance: a simulated send violating quiet hours is blocked by policy; a clean send yields a receipt; leak-autopilot integration behind a flag, its own test suite stays green.

### Phase 6 — Governed spend (~1 week)

- Spend policies: budget caps per agent/org/period, approval thresholds, vendor allowlists; signed spend receipts.
- Harvest TreasuryClaw's spend-policy/receipt primitives and Reputation-Oracle's x402 middleware (per-call metered payments) as the payment rail option.
- Marketing artifact: the picoclaw "$22.85 in one ungoverned session" post, now with the fix shipping.

Acceptance: an agent exceeding its budget cap gets `require_approval`; spend actions emit verifiable receipts; x402 path demonstrated against a test endpoint.

## 4. What this program is NOT

- **No new repos.** Every organ lives in `C:\Projects\DashClaw` (Phase 5 touches leak-autopilot's integration only). The override of the no-new-repos rule is for the *program*, not for scaffolding.
- **No billing flip.** Stripe stays parked per Wes's standing direction; `/pricing` stays 404.
- **No enterprise positioning, no new experimental routes** — the ~226 frozen routes stay frozen; each organ adds the minimum route surface.
- **No prompt-content in receipts or ingest** — metadata only, content opt-in (standing rule).
- **No DNS layer in v1** of the public verify path — decision recorded in Phase 3; revisit only after the wedge is live.
- **No re-litigating killed projects.** Harvests (TreasuryClaw, x402, immune-system, repo-state pattern) are reads of archived code, not revivals.

## 5. Risks

1. **Maintenance surface growth on a solo-maintained 300-route monolith.** Mitigation: each organ behind a capability flag, minimum new routes, full command gate per phase (typecheck, lint, FULL vitest, build, doctor, doc-counts).
2. **Phase 1 touches the safety-critical path.** Mitigation: fail-closed flips behind `DASHCLAW_GUARD_FALLBACK`, observe-mode rollouts, both hook stacks kept byte-identical, deadline behavior tested under simulated slow webhooks.
3. **Stale audit ground truth.** v4.14.0 ≠ v4.7.10. Every phase starts with a re-grounding pass against current code; audit line numbers are leads, not facts.
4. **Displacement risk (the audits' named failure mode: building instead of shipping).** Mitigation: every phase ends with an outward-facing artifact — a published CLI version, a public spec, a blog-able receipt demo, an executed launch tail. Phase 4 *is* the launch-tail work the audits demanded, executed by the system itself.
5. **The revenue tails still matter.** This program doesn't replace SUPERGOAL_REVENUE_TAILS.md; Phase 4 absorbs and executes what remains of it.

## 6. Success criteria for the program

- Every phase passes DashClaw's full command gate from a clean tree.
- End state: an agent session produces a signed completion receipt (P2) that any stranger can verify offline with no account (P3), issued under a fail-closed guard (P1); the system has executed at least one real launch tail end-to-end under governance (P4); outbound and spend actions are policy-gated and receipted (P5–6).
- That end state **is** layer 1 (the company acts and proves it), layer 2 (DashClaw sells every one of these as capabilities), and layer 3's seed (the public verify path is live, free, account-free).

# v3.7 — Deferred-debt triage

**Status:** Ratified (maintainer, under the MAINTAINER.md delegation) · 2026-07-04
**Roadmap item:** v3.7 (`docs/plans/owner-roadmap.md`) — v1's item-6 pattern applied
to this era's parked queue: build or kill, each with a written verdict.

Evidence base: five parallel read-only sweeps over the deferral sources
(retro-audit punch list, v2.6c spec, load-harness scope doc, hardening report
§5, advocate v2a spec, calibration specs, PLUGIN_PARITY) plus one empirical
probe of the installed Codex CLI. Verdict rule: a kill must cite the reason
and, where honest, the revival trigger; a build ships in this release with its
own proof.

## Verdict ledger

| # | Item | Verdict |
|---|------|---------|
| 1 | /decisions risk-composition hint | **KILL** |
| 2a | Degradation `by_day` render-or-drop | **BUILD (render)** |
| 2b | Degradation per-policy split | **KILL** |
| 3 | Expired approvals show expiry timestamp | **BUILD** |
| 4a | Guard-load SLO calibration | **BUILD (calibrate the number)** |
| 4b | Guard-load CI wiring | **KILL** |
| 4c | LLM slow-path load scenario | **KILL** |
| 5a | `verification_status` enum | **KILL** (+ ride-along fix, below) |
| 5b | x402 currency allow-list | **BUILD** |
| 5c | Per-org JWKS issuer binding | **SPLIT: BUILD fail-closed default / KILL per-org migration** |
| 5d | x402 idempotency key | **BUILD** |
| 5e | `apiErrorResponse` detail-leak flag | **BUILD** |
| 6 | Codex SessionStart digest parity | **BUILD (lifecycle VERIFIED)** |
| 7 | Assumption contradiction detection | **KILL** |
| 8 | Calibration follow-ups (dup detection, in-UI rename) | **KILL both** |
| 9 | Dependabot EOVERRIDE untangle | **BUILT** (own commit, pre-release) |

## Kills, with reasons

**1 — /decisions risk-composition hint.** `GET /api/actions` is the single most
shared read path in the app (13 callers, several polling or SSE-refetching);
joining `guard_decisions` and JSON-parsing its TEXT `context` per row there is
a real regression risk for a cosmetic list-row hint whose full value is one
click away (row expand → detail fetch already renders the breakdown). The
v2.6c deferral reasoning ("its own change", "only if the list payload already
carries the data") still holds — the payload doesn't carry it. Revival shape
recorded: an explicit `?include=risk_hint` opt-in scoped to `/decisions` only,
batched (not joined), on the next /decisions touch.

**2b — per-policy degradation split.** Degradation is a deadline/timing
artifact of the evaluation, not a per-policy property — the degraded predicate
has no policy dimension, and one degraded decision implicates N matched
policies. The aggregation is genuinely new work for a "minor" retro-audit
note with zero operator demand. Killed as v2.1 scope creep.

**4b — guard-load CI wiring.** Deferred in the scope doc for a stated,
still-valid architectural reason: load tests need a live DB and are
slow/variable — a flaky gate is worse than none. The acute problem the
harness was built around (the predictive-LLM amplifier recruiting every
`apply`) was diagnosed and fixed in the same v2.1 ship, with no recurrence in
the maintainer log since. Revival trigger: the already-shipped `/policies`
degradation surface showing a recurrence.

**4c — LLM slow-path scenario.** The harness authors called an unseeded
version "theatre" (`scripts/guard-load.mjs:29-33`), and a seeded version
means fixture history plus real LLM provider calls inside a load loop — new
cost and nondeterminism guarding a path that is not currently regressing.
Same revival trigger as 4b.

**5a — `verification_status` enum.** The column is written from exactly one
file (`app/lib/jwks-verifier.ts`) through a narrow TS union; a DB CHECK
constraint buys defense only against a future bug in that one file, at the
price of a migration in the fresh-vs-legacy drift minefield. Killed as a
standalone project; if the TS migration ever touches the table, add the CHECK
as a one-line rider. **Ride-along fixed instead (the real bug the sweep
found):** the `CRITICAL_TABLES_DDL` fallback in `app/api/setup/migrate/route.ts`
was a stale pre-Phase-2 snapshot of `guard_decisions` — missing
`verification_status`, `replay_status`, `jti`, `act_status`, `act_hash`,
`evidence`, `degraded`, `agent_name` — so any deploy that ever took the
fallback branch would hard-fail the required, awaited audit INSERT
(`42703`). Fixed and pinned with a drift gate: a unit test now compares every
`CRITICAL_TABLES_DDL` table's column set against `schema/schema.js`, so the
fallback can never silently rot again.

**5c (kill half) — full per-org issuer binding.** A real limitation only for
hosted multi-tenant bring-your-own-IdP — a product stage with zero external
orgs today (same evidence that killed team/RBAC-first in the v3 shaping).
Needs an `organizations` migration and org-context threading through
verification. Revisit when a hosted org actually asks for its own issuer.

**7 — assumption contradiction detection.** The v2a spec gated this on "a
false-positive budget it doesn't have yet"; no FP-measurement infrastructure
exists for textual contradiction (calibration mining measures risk scores,
not NLI). The only LLM-free techniques (embedding similarity, negation
keywords) systematically conflate *related* with *opposed*, and the two hard
constraints in this exact path — advisory hot-path may never recruit an LLM
(v2a spec), and nothing in DashClaw breaks without an LLM key (`app/lib/llm.ts`
design principle) — rule out the technique that would work. Revival shape
recorded: narrow same-thread negation *suggestion* (operator-confirmed badge,
never auto-invalidation), S-effort, only if a real missed-contradiction
incident is logged.

**8 — calibration follow-ups.** Both were deferred with explicit, load-bearing
rationale that has not aged: shape-matching is fuzzy and "the human reviewing
the proposal is the dedupe step" (two independent specs), and in-UI rename had
the trigger "only if real use demands it" — corpus at 34 vectors, zero
duplicate incidents, zero rename friction recorded since v4.34.0 shipped
Ratify/Dismiss. Re-open on a recorded incident of either.

## Builds

**2a — degradation `by_day` sparkline** (`/policies` tuning cockpit). The data
is computed, shipped in the payload, and typed on the client — only the render
was missing. A quiet bar-per-day strip beside the existing sentence; UI-only,
zero backend change. (Render beats drop: dropping the field means touching the
repository, route contract, client type, docs contract line, and a
policy-smoke assertion — more churn to delete truth than to show it.)

**3 — expired approvals expiry timestamp** (`/approvals`). `approval_expires_at`
is stamped at request time, indexed, preserved by the expiry sweep, and
exposed on the detail endpoint — the list SELECT simply never included it, and
the Expired section renders an *unlabeled request time* under a heading that
says "Expired", which is actively misleading. Add the column to
`listActionsViaTaggedSql`, label both timestamps.

**4a — SLO calibration.** Run the existing harness (`npm run guard:load`)
against a warmed local production build and replace the placeholder
`P99_GATE_MS = 2000` with a number derived from observed reality (observed
warm p99 × headroom), recorded in the scope doc. The gate stays an on-demand
script by design (see kill 4b).

**5b — x402 currency allow-list.** Format-only validation
(`/^[A-Za-z0-9]{2,16}$/`) lets any junk currency through, and the spend
aggregation sums `spend_amount` with **no currency partition** — every row
counts 1:1 against USD budget ceilings, so a fabricated currency corrupts
budget-limit bookkeeping. This is budget integrity, not hygiene. Closed set:
`DASHCLAW_X402_CURRENCIES` (comma list, default `USDC`); unknown currency →
400. Validation tightening is mandated, not gated, per the hardening report's
own rule.

**5c (build half) — JWKS fail-closed when no issuer is configured.** Today an
unset `DASHCLAW_ALLOWED_ISSUER` means any issuer with a reachable JWKS
verifies — so a malicious API-key holder can mint "verified" identity claims
for any agent_id, defeating agent-scoped policies that trust verification.
v3.6 logic applies exactly: the verified fleet is empty, so flipping to
fail-closed is free — a bearer token with no configured issuer now resolves
`unverified` (never `verified`) with an explicit reason. Rollback/enable is
the same single env var it always was: set `DASHCLAW_ALLOWED_ISSUER`. The
`/setup` enforcement-posture card gains a fourth row stating whether verified
identity is enabled (issuer configured) — value withheld, consistent with the
card's disclosure rule.

**5d — x402 idempotency key.** `/api/actions` and `/api/guard` both already
short-circuit duplicate `(org_id, idempotency_key)` submissions; x402
purchases — the money route — is the one sibling without it, so a client
retry mints two action ids and two purchase rows, both counted toward spend
(the R11 TOCTOU re-verify flips the second only if it *breaches* budget).
Additive `idempotency_key` column on `x402_purchases` + lookup-before-insert,
mirroring the proven pattern.

**5e — `apiErrorResponse` detail redaction.** The shared handler (219 call
sites) returns raw `err.message` to any API-key/JWT holder — i.e. to governed
agents, the exact population this product keeps at arm's length. In
production, `detail` and `code` are now redacted unless
`DASHCLAW_EXPOSE_ERROR_DETAIL=true`; development keeps full detail. The
curated 503 branches (schema-not-initialized, DB unreachable) are unchanged —
they are safe by construction. Same-pattern fix applied to
`app/api/setup/migrate/route.ts`'s independent raw `err.message` return
(public route).

**6 — Codex SessionStart digest parity.** The parity doc's condition — "wire
it only after confirming the event fires" — is now met with evidence: the
installed codex-cli 0.139.0 binary's hook-event enum contains `SessionStart`
(alongside the Pre/Post/Stop events DashClaw already proves fire), and this
machine's live `~/.codex/config.toml` carries a trusted, enabled
`session_start` hook registered by an unrelated tool. Wire it: add
`dashclaw_session_digest.py` to the installer's `HOOK_FILES`, emit the
`[[hooks.SessionStart]]` stanza in `buildConfigTomlBlock`, pin both in the
installer test (the exact test shape that caught the v2.7 dead-ingest bug),
update PLUGIN_PARITY.

**9 — Dependabot EOVERRIDE.** Built pre-release as its own quiet commit
(`fca42a34`), per the roadmap's "never mid-ship": removed the duplicate
`postcss` devDependency; `overrides.postcss` remains the single source of
truth for the GHSA-qx2v-qp2m-jg93 pin; `dompurify`/`uuid` overrides untouched.
Verified: one hoisted postcss@8.5.14, audit 0.

## Human surface (HUMAN-EXPERIENCE.md)

1. **SEE it:** `/approvals` Expired section gains labeled Requested/Expired
   timestamps; `/policies` tuning cockpit gains the by-day degradation strip;
   `/setup` enforcement-posture card gains the verified-identity row. All
   three are existing pages humans already visit; no new deep URLs.
2. **Discoverable:** all changes enrich surfaces at their existing click
   paths; nothing is API-only that a page consumes without rendering.
3. **Every human step a click:** yes — all three surfaces are read-only truth;
   the env knobs (`DASHCLAW_X402_CURRENCIES`, `DASHCLAW_EXPOSE_ERROR_DETAIL`,
   `DASHCLAW_ALLOWED_ISSUER`) are operator deployment acts by nature, and each
   surface/doc states the exact var.
4. **Verified rendered:** headless proof of all three touched surfaces
   pre-ship.

API-only by explicit decision: currency allow-list, idempotency key,
error-detail redaction (wire-level protections — their human surface is the
docs and `.env.example`; a rejected currency or replayed idempotent call is
an SDK-visible 400/cached response, not a page).

## Acceptance

- Every roadmap v3.7 line has a verdict here; kills state reasons and revival
  triggers; builds ship in v4.49.0 with tests.
- The `CRITICAL_TABLES_DDL` drift gate fails the suite if the fallback DDL
  ever diverges from `schema/schema.js` again.
- `P99_GATE_MS` is a measured number with its derivation recorded in the
  scope doc.
- Rendered proof: /approvals, /policies, /setup.
- Full gates green; CHANGELOG records the builds and the kills.

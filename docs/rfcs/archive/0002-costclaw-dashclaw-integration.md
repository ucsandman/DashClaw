# RFC 0002: CostClaw + DashClaw Integration (Shared Engine, In-Product Preview, Open-Core License Unlock)

> **Superseded 2026-07-06 by [`THESIS.md`](../../../THESIS.md).** Archived as presuming a different product (an open-core paid add-on). The CostClaw / x402 spend-governance money gate is unchanged and stays gated on Wes, out of this repo's front door. Retained for history.

- Title: Integrating CostClaw with DashClaw as a sibling product (shared analytics engine, free in-product preview, paid local unlock)
- Status: Draft
- Date: 2026-06-04
- Author: ucsandman (Wes); drafted from a read-only cross-repo analysis (DashClaw `C:/Projects/DashClaw`, CostClaw `C:/projects/costclaw`)
- Related: CostClaw v1 design spec (`C:/projects/costclaw/docs/superpowers/specs/2026-06-01-costclaw-v1-design.md`), RFC 0001 (`C:/Projects/DashClaw/docs/rfcs/0001-generative-ui-governance.md`), DashClaw x402 spend-governance spec (`C:/Projects/DashClaw/docs/superpowers/specs/2026-06-04-x402-spend-governance-design.md`), **Unified FinOps / Spend subsystem (`C:/Projects/DashClaw/docs/superpowers/specs/2026-06-05-unified-finops-spend-subsystem-design.md`) — reslots this RFC's Tier 2; see §11**

## 1. Summary and Decision

CostClaw and DashClaw are two siblings of the same engine. Both descend from AgentLens: DashClaw's entire `app/lib/claude-code/` tree (22 files) carries explicit `Ported from AgentLens (src/...)` headers, and CostClaw's `packages/engine` is an unattributed port of the same machinery. They share a near-identical JSONL parser, a 4-column cache-aware pricer, a secret-scan pass, and main/subagent/workflow session classification. They do **not** share a product: CostClaw is a local, post-hoc, zero-third-party-upload audit of a developer's own Claude Code spend and setup with a six-pillar score and a paid `optimize` artifact generator; DashClaw is a self-hosted runtime governance control plane (guard, approvals, action ledger, Agent Reputation) that also happens to ingest Claude Code sessions for cost insight.

The decision: keep them as two products, unify the shared analytics core into one package, and connect them as an **open-core loop** rather than fusing them. Concretely, in this order:

1. **Tier 0 — Cross-link in copy, not code.** A tasteful two-way link (DashClaw Code Sessions → costclaw.io, and CostClaw → DashClaw). Near-zero engineering, zero boundary or privacy cost. Ship immediately.
2. **Tier 1 — Extract a shared `@claw/engine` package** owning the parser, the rate card (with the LiteLLM auto-refresh DashClaw already runs), secret-scan, sanitize, and shared types. Consumed by both repos. This fixes a real shipping bug (CostClaw's frozen rate card overstates Opus cost ~3x) and removes duplicate-maintenance drift. Pure win, independent of Tiers 0 and 2.
3. **Tier 2 — Free in-product preview + paid local unlock.** A clearly-labeled CostClaw preview card on DashClaw's Code Sessions surface, powered by the engine DashClaw already runs (an org-level "recoverable spend" rollup over data it already stores). The *prescriptive* depth (the six-pillar setup score and the `optimize` artifacts) is gated behind a CostClaw license validated **locally inside the operator's own self-hosted DashClaw instance**. No additional data leaves infrastructure the operator controls.

We reject the naive reading of "integrate CostClaw into DashClaw" that pipes CostClaw's local-only data into a hosted multi-tenant store. DashClaw is self-hosted (operator-run Vercel/Docker), so there is no third-party cloud to violate; but we still keep the paid artifacts generated locally and move only a license entitlement across the seam. We also reject making the developer-setup score a first-class DashClaw governance pillar, because that breaks the `govern-not-do` boundary and collides conceptually with Agent Reputation.

## 2. Context correction: DashClaw is self-hosted

DashClaw is **not** a hosted SaaS today. The operator runs their own instance (Vercel, Docker, or otherwise); a hosted offering may come later. This single fact resolves the central tension that would otherwise block this work:

- CostClaw's moat is "your prompts never leave your machine," enforced by a tripwire test on the derived `AuditRecord` (`C:/projects/costclaw/packages/engine/src/audit.ts`, `.../sanitize.ts`, `.../secret-scan.ts`).
- DashClaw's Code Sessions path ingests `~/.claude` JSONL into Postgres (`C:/Projects/DashClaw/app/api/code-sessions/ingest-jsonl/route.js`). Because that Postgres is the operator's **own** self-hosted database, ingest is not a third-party upload.

The reconciled privacy promise for the integrated story is therefore: **"your prompts never leave infrastructure you control."** Both products honor it. The CostClaw license unlock moves an entitlement, not data.

A corollary on monetization: because DashClaw is free to self-host, a CostClaw license is naturally DashClaw's **first paid add-on** in an open-core model, not a confusing second paywall layered on a paid platform. The platform/SDK stays free-to-run; the paid depth is the CostClaw prescriptive layer.

## 3. Ground-truth overlap (what already exists vs. what is net-new)

Verified by reading source on both sides. The headline correction: the common claim that the two products run "the same 7 optimizer rules" is **false** — only `BAD_CACHE_HIT` overlaps by name, and even its implementation differs. They are two different 7-rule families from a common ancestor. Plan packaging around the table below, not around an assumption of full overlap.

| Capability | CostClaw | DashClaw | Overlap | Consequence for this RFC |
|---|---|---|---|---|
| JSONL parse + dedup (`requestId>message.id>uuid`) | `packages/engine/src/parser.ts` | `app/lib/claude-code/parser.js` (PARSER_VERSION=2) | full | Move to `@claw/engine` (Tier 1) |
| 4-column rate card + cost/cache fns | `pricing.ts` (frozen 2026-05-13; Opus $15/$75) | `pricing.js` (LiteLLM auto-refresh; Opus 4.8 $5/$25) | full (data diverged) | DashClaw's is correct; shared package adopts the refresh. Fixes CostClaw's ~3x Opus overstatement |
| Secret-scan redaction | `secret-scan.ts` | `optimal-files/secret-scan.js` | full | Move to `@claw/engine` |
| main/subagent/workflow classification | parser `kind` tag | parser `kind` + `subagent-roi.js` | full | Shared in core |
| 7-rule waste optimizer | `optimizer.ts` (7 rules) | `rules/*.js` (7 different rules) | partial (1 of 7 shared by name) | **Keep product-specific.** Preview uses DashClaw's rules; paid tier keeps CostClaw's |
| Cache-miss "recoverable spend" headline | `report.ts cacheMissExposureUsd` | per-session `cache_savings_usd` only | partial | Preview = a ~org-level rollup of existing per-session numbers |
| Six-pillar evidence-gated setup score | `scoring.ts` + `rubric.ts` | none | none | **Net-new paid value.** Do not port into DashClaw core |
| CLAUDE.md *quality* analyzer | `claudemd.ts` (size/structure/stability) | `claude-code/claudemd.js` *generates* a primer; does not score | partial (opposite verb) | Paid tier |
| `optimize` artifacts (scaffold + playbook + settings) | `optimize.ts` (paid) | `optimal-files/*` generates (free) | partial | Paid tier = CostClaw's scaffold/playbook/settings flavor |
| Runtime governance (guard/approvals/ledger) | none | `app/lib/guard.js` + action ledger | none | DashClaw's identity; untouched |
| Agent Reputation (trust of governed agents) | none | `app/lib/reputation.js` | inverse | Keep distinct from setup score |
| Monetization (license + marketing site) | $39 Lemon Squeezy gate (`apps/cli/src/license.ts`), costclaw.io | none | none | Becomes DashClaw's open-core add-on |

Net: roughly the descriptive/analytics half of CostClaw already exists in DashClaw via shared lineage; the prescriptive + packaging half (scoring rubric, CLAUDE.md quality analysis, `optimize` artifacts, paywall) is well under 20% reproduced and is the legitimate paid surface.

## 4. The boundary question (`govern-not-do`)

DashClaw's CLAUDE.md states it is a "minimal governance runtime, not an agent platform… we provide the infrastructure to govern those goals." A developer-facing FinOps audit of one's own setup leans "do," not "govern."

Resolution: the Code Sessions subsystem **already** ingests `~/.claude` JSONL and runs a waste optimizer, so the *descriptive* cost read is already inside the boundary (framed as bringing governed-agent session cost into the operator's view). The line we hold:

- **Allowed:** a clearly-labeled CostClaw **preview card** that rolls up data DashClaw already stores, and a license field that unlocks locally-generated artifacts.
- **Not allowed:** promoting the six-pillar developer-setup score to a first-class DashClaw governance pillar, or letting it bleed into Agent Reputation's surfaces. Reputation scores *governed agents*; the setup score scores a *developer's config*. They must not be conflated in the UI or the data model.

## 5. Decision detail and implementation

### 5.1 Tier 0 — Cross-link (ship now)

- DashClaw: on the Code Sessions index (`C:/Projects/DashClaw/app/code-sessions/page.js`), add one line/card: "Auditing your own Claude Code spend across machines? → CostClaw (costclaw.io)." Use design tokens from `app/globals.css`; no hardcoded hex (per `.impeccable.md`).
- CostClaw: keep/strengthen the existing "graduate to team governance → DashClaw" positioning already noted in its v1 spec (line 14).
- Cost: copy + one link each side. No boundary or privacy impact.

### 5.2 Tier 1 — Shared `@claw/engine` (pure win, do regardless of Tier 2)

Goal: one source of truth for the shared core so the rate card stops diverging.

- Create a new package `@claw/engine` (home: CostClaw monorepo `packages/engine` is the natural host since it is already pure and TS; rename/republish under the `@claw` scope, or add a thin `@claw/engine` that re-exports). It must ship **compiled JS + `.d.ts`** so DashClaw — which is JavaScript with no `tsconfig.json` (per RFC 0001 §4) — can `import` it without a TS interop boundary. **Correction (2026-06-05):** an earlier draft said "CostClaw already bundles via `tsup`." Verified false — `packages/engine` builds with **`tsc`** (`tsc -p tsconfig.build.json`) and its `main`/`exports` point at the raw `./src/index.ts`. So the extraction needs a real compiled-JS build step this RFC under-described, not a free re-export. This (together with the deferral in §5.2.1) is why Tier 1 is **not** the "do-now pure win" the framing implied.
- Shared surface (the parts that are genuinely identical): `parser`, `pricing` (rate card + `costForUsage`/`cacheSavingsForUsage`/`cacheHitRate`), `secret-scan`, `sanitize`, shared `types`.
- The rate card moves to the **auto-refreshed** mechanism DashClaw already runs (`npm run pricing:refresh` from LiteLLM, weekly GH Action). This is the fix for CostClaw's stale 2026-05-13 snapshot (Opus at $15/$75 vs current $5/$25).
- **Keep product-specific and out of the shared package:** each side's optimizer rule family, CostClaw's six-pillar scoring, DashClaw's optimal-files generators, DashClaw's persistence/repository layer, DashClaw's runtime governance.
- DashClaw migration: replace the duplicated internals of `app/lib/claude-code/parser.js`, `pricing.js`, and `optimal-files/secret-scan.js` with imports from `@claw/engine`, preserving DashClaw-only fields (`naive_cost_usd`, `parser_version`, repository wiring). Keep the `Ported from AgentLens` provenance note updated to point at the shared package.
- Verify: DashClaw `npx vitest run` (full suite) + `npx next build`; CostClaw `npm test --workspaces`. Confirm cost numbers for a fixture session match between the two products after unification (they currently won't, due to the stale card — that mismatch disappearing is the acceptance signal).

#### 5.2.1 Tier 1 deferral (added 2026-06-05)

Tier 1 is **deferred to DashClaw's planned TypeScript migration.** Verified ground truth changed the calculus: DashClaw's two rate cards (`billing.js`, `claude-code/pricing.js`) are already regenerated from the same LiteLLM block and are **bit-identical on every shared model**, and *both* stored cost figures (`action_records.cost_estimate`, `code_sessions.cost_usd`) already run through `billing.js` — so there is no live "two disagreeing numbers" bug on the DashClaw side to fix now. The genuine duplication (the price *table* + the cost primitives) is best collapsed into one canonical module **in TypeScript**, which is also the natural home for `@claw/engine` (TS-native). Until then, FinOps Phase B ships a **parity test** that fails CI if the two cards drift on shared Claude models/aliases (`docs/superpowers/specs/2026-06-05-finops-phase-b-claude-code-lens-design.md` §4). CostClaw's own stale-card bug (Opus $15/$75 frozen vs current $5/$25) is a one-file rate-data edit in `pricing.ts` and can be fixed in-place in CostClaw independently of the extraction.

### 5.3 Tier 2 — In-product preview + paid local unlock

> **Reframed 2026-06-05 (see §11):** Tier 2 now builds *into* the unified FinOps subsystem as the `costclaw_recoverable` source under its "Your Claude Code spend" lens — it renders inside the shared "Spend" section, not as a standalone card on the Code Sessions page. The free/paid line and the local-only privacy promise below are unchanged.

**Free preview (powered by DashClaw's own current engine — never a second embedded copy):**

- Add an org-level "recoverable spend" rollup. Reuse CostClaw's headline math over DashClaw's existing per-session data:
  `recoverableUsd = Σ over main sessions of (input_tokens + cache_creation_tokens) * (input_rate − cache_read_rate) / 1e6`
  computed with `app/lib/claude-code/pricing.js` (post-Tier-1: `@claw/engine`).
- New route: `C:/Projects/DashClaw/app/api/code-sessions/recoverable-spend/route.js`, backed by the existing code-sessions repository (`app/lib/repositories/code-sessions.repository.js`) — **no direct SQL in the route** (DashClaw guardrail: `npm run route-sql:check`).
- New UI: a labeled "CostClaw preview" card on `app/code-sessions/page.js` showing the recoverable-spend headline and the existing waste findings, with a "Get the full audit + fixes" CTA. Frame it around the operator's **team/fleet** Claude Code spend (lead with the dollar number), not personal setup hygiene — this fixes the audience mismatch (a DashClaw operator governs prod agents; they care about fleet spend, not grading their own CLAUDE.md).

**Paid unlock (CostClaw's genuinely net-new prescriptive layer, generated locally):**

- The six-pillar setup score (`scoring.ts` + `rubric.ts`) and the `optimize` artifacts (CLAUDE.md scaffold, dollar-ranked playbook, `settings.suggested.json` — `optimize.ts`).
- Unlock mechanism: a CostClaw license key entered in the operator's self-hosted DashClaw config (env `COSTCLAW_LICENSE_KEY` and/or a settings field), validated by the existing offline-safe logic in `C:/projects/costclaw/apps/cli/src/license.ts` (Lemon Squeezy `STORE_ID`/`PRODUCT_ID` check; previously-activated state passes through offline). Factor that validator so both the CLI and DashClaw can call it.
- The unlocked artifacts are produced **inside the operator's instance** and shown/downloaded there. Nothing additional leaves infrastructure the operator controls — the privacy promise holds.

## 6. The free/paid line

- **Free (preview, in DashClaw):** recoverable-spend headline + waste findings from DashClaw's own optimizer, over already-ingested sessions.
- **Free (CostClaw standalone):** `npx costclaw audit` stays free and local, exactly as today.
- **Paid (CostClaw license, unlockable in DashClaw or via CLI):** the six-pillar graded report and the `optimize` artifacts (scaffold + playbook + settings). $39 one-time, the existing Lemon Squeezy SKU.

This maps the paywall to real net-new capability rather than an artificial throttle — defensible to a technical buyer.

## 7. Risks and mitigations

- **Boundary erosion.** Mitigation: preview is a labeled side-car reading existing data; the setup score never becomes a core DashClaw pillar and never touches Reputation surfaces.
- **Engine divergence / two disagreeing cost numbers.** Mitigation: Tier 1 first; the preview runs on the single shared engine, not a second copy.
- **Audience mismatch.** Mitigation: frame the preview around fleet/team spend and the dollar headline; make the setup score the secondary paid hook.
- **Billing/entitlement complexity on a solo-maintained, version-synced stack.** Mitigation: build the thin version (local license-key validation reusing CostClaw's existing validator); defer shared accounts/SSO and any hosted surface. Respect DashClaw's `version:sync:check` — `@claw/engine` is a fourth manifest and must not be folded into the platform/SDK three-way version lock by accident.
- **"It's mostly already in DashClaw" over-claim.** Mitigation: the table in §3 is the contract — only the descriptive half is shared; build the paid tier as real work.
- **Opportunity cost vs. the in-flight roadmap (Agent Reputation hardening, the x402 spend-governance pillar — Phase 1 of which shipped to `main` 2026-06-04).** Mitigation: Tier 2 billing work is sequenced after, only when there's appetite for a paid surface. **Correction (2026-06-05):** an earlier draft claimed "Tier 1 actively helps x402 by giving one canonical pricing source" — that is **withdrawn**. x402 spend is the agent-*reported* micropayment amount, not rate-card-derived, so `@claw/engine` pricing is orthogonal to x402; Tier 1 helps Agent Spend / Code Sessions pricing only. See §11.

## 8. Explicit decision gates (ask before building)

- **Billing/entitlement plumbing is the one place to confirm before implementing** (it touches money). Specifically: whether the CostClaw license should unlock per-instance (self-hosted operator enters a key) and whether a single license covers both the CLI and the in-DashClaw unlock.
- Whether `@claw/engine` lives in the CostClaw monorepo (recommended) or a new standalone repo.
- Whether the preview ships in DashClaw before or after the next x402/Reputation milestone.

## 9. Non-goals

- No piping of CostClaw local data into any hosted/multi-tenant store (none exists; do not build one for this).
- No promotion of the six-pillar setup score to a DashClaw governance pillar; no merge with Agent Reputation.
- No shared accounts/SSO and no hosted CostClaw web app (`apps/web`) for this integration.
- No second copy of the analytics engine embedded in DashClaw; the shared package is the only source.
- No change to DashClaw's runtime governance core (guard/approvals/ledger) or its free-to-self-host model.

## 10. Sequencing and verification

1. Tier 0 cross-link (DashClaw `app/code-sessions/page.js` + CostClaw copy). Verify: links render; tokens not hardcoded; `npx next build`.
2. Tier 1 `@claw/engine` extraction + DashClaw migration + CostClaw rate-card fix. Verify: full `npx vitest run` (DashClaw) + `npm test --workspaces` (CostClaw); a fixture session's cost matches across both products.
3. Tier 2a preview (recoverable-spend route + card). Verify: route goes through the repository (`route-sql:check`), full test suite, `next build`.
4. Tier 2b paid unlock (license validator factored + entitlement surface). Gated on §8. Verify: locked/unlocked states; offline-safe validation; no extra outbound data.

## 11. Relationship to the unified FinOps subsystem (added 2026-06-05)

The operator chose to unify DashClaw's spend surfaces under one **FinOps subsystem** (spec: `docs/superpowers/specs/2026-06-05-unified-finops-spend-subsystem-design.md`) rather than ship CostClaw as a parallel track. The subsystem is a **read-only aggregation/presentation layer** over distinct, independently-owned spend sources (agent LLM cost, x402 micropayments, Code Sessions cost, CostClaw recoverable) — it owns no data and fuses no domains, so this RFC's boundary commitments (§4, §9) hold. What changes relative to this RFC:

- **Tier 2 → the Claude-Code lens.** The recoverable-spend preview becomes the `costclaw_recoverable` source under the subsystem's "Your Claude Code spend" lens; the six-pillar score + `optimize` artifacts remain the license-gated, locally-generated paid depth (§5.3 unchanged in substance). It is the subsystem's Phase C, gated on this RFC's §8 billing decision.
- **Tier 1 → deferred to the TS migration (updated 2026-06-05).** `@claw/engine` stays an independent enabler but is no longer "do-now": research showed DashClaw's two rate cards are already bit-identical (same LiteLLM block) and both stored costs run through `billing.js`, so the subsystem's reconciliation reduces to a **parity test** in Phase B, with the true single-source merge + `@claw/engine` deferred to DashClaw's TypeScript migration. See §5.2.1 and the Phase B spec §6.
- **Tier 0 → unchanged.**
- **§7 correction** (withdrawal of the Tier-1-helps-x402 claim) — recorded inline in §7.

Subsystem sequencing: Phase A = FinOps foundation + Fleet lens (Agent Spend + x402, with the x402 break-out fix); Phase B = Code Sessions cost lens + rate-card **parity test** (Tier 1 / merge deferred to the TS migration); Phase C = this RFC's Tier 2.

---

Authoring note: produced via read-only analysis on 2026-06-04 while two other agents were editing the DashClaw working tree; file paths and capabilities were verified against source at that time. No code was modified in producing this RFC. Reconciled against the unified FinOps subsystem spec on 2026-06-05 (§5.3 note, §7 correction, §11, Related header).

---
owner: Product
status: draft-for-review
doc-type: strategy
last-updated: 2026-05-31
---

# DashClaw Monetization Plan (draft for review)

> **Status: proposal only.** No pricing or checkout surface ships from this
> document. DashClaw retracted all monetization UI in 2.18.0 ("no pricing,
> period"); this plan exists so that decision is *deliberate and re-openable*,
> not accidental. Nothing here changes code or UI until explicitly approved.

## The core tension

DashClaw is **MIT-licensed, self-hostable, and $0 to deploy** (Vercel + Neon
free tier, zero-friction). Those are load-bearing promises — they drive developer
adoption and trust, and they must not be broken to "charge for it." You cannot
put the core governance runtime behind a paywall without destroying the thing
that makes it adoptable.

So the only honest models are **open-core** and **managed cloud**: the
self-hosted runtime stays free and complete; revenue comes from (a) *not having
to run it yourself* and (b) *capabilities a buyer — not a developer — needs.*

## Who actually pays (and why)

The two audiences from `.impeccable.md` buy for different reasons:

- **AI-agent developers (primary, adopter):** integrate DashClaw into Claude
  Code / Codex / LangChain / custom runtimes. They will **not** pay for core
  governance — they self-host it for free. They are the funnel, not the revenue.
  Keep everything they touch free.
- **Governance / compliance / security stakeholders (secondary, buyer):** need
  auditable evidence, approvals at scale, SSO, retention, and someone to call.
  **They are the budget holder.** Revenue concentrates on their needs.

The developer adopts; the compliance/platform owner buys. Price the buyer's
needs, never the adopter's.

## Proposed structure

### Tier 0 — Open Source (self-host) · free, forever

The complete governance runtime. Never gated:

- Full guard loop, all 10 policy types, decisions ledger, approvals (dashboard /
  CLI / mobile PWA / Telegram / Discord).
- Agent identity (Phase 2 JWKS, 2b replay, 2c action binding).
- Durable execution finality, capability runtime, execution studio (workflows /
  knowledge / model strategies), scoring, learning, drift, Code Sessions.
- All SDKs (Node + Python), MCP server (17 tools / 4 resources), coding-agent
  plugins + hooks.
- Single organization, community support, in-memory realtime.

This is the moat: a genuinely complete, free, self-hostable governance plane.

### Tier 1 — Managed Cloud · paid (usage-metered)

"We run DashClaw for you." Same runtime, zero ops:

- Hosted instance — no deploy, no DB, managed migrations + upgrades.
- Cross-instance realtime event stream (Redis-backed) instead of in-memory.
- Durable, longer audit retention; managed backups.
- Hosted approvals surface + uptime SLA.

**Value metric: governed actions / month** (the natural unit — more agents
governed = more value) **+ governance seats** (people in the approvals/Mission
Control surface). Both already exist as first-class concepts in the data model,
so metering is a reporting query, not new architecture.

### Tier 2 — Team / Enterprise add-ons · paid (works on self-host OR cloud)

The compliance/platform buyer's checklist:

- **SSO / SAML / SCIM** (org-level auth beyond API keys).
- **Compliance suite at scale:** scheduled evidence exports, framework packs
  (SOC 2 / NIST / EU AI Act), signed evidence bundles, long-retention audit,
  legal-hold. (The mapping + signed-export routes already exist — this gates
  *scale + scheduling + support*, not the basic capability.)
- **Multi-org / multi-tenant RBAC**, fine-grained roles.
- **Priority support, SLA, deployment assistance.**

Enterprise add-ons are licensed (not feature-flagged out of OSS) so the OSS
promise stays intact: nothing is *removed* from self-host; paid is *additive*.

## What already exists (so cost-to-build is low)

| Need | Already in the repo |
|---|---|
| Checkout / billing portal | `/api/billing/checkout`, `/api/billing/portal`, Stripe webhooks |
| Usage metering primitives | `/api/usage`, `/api/usage/costs`, action/decision counts |
| Multi-tenant + teams | orgs, teams, API keys, RBAC, `x-org-id` boundary |
| Hosted provisioning | hosted-trial mode mints trial workspaces (`/api/hosted/*`) |
| Compliance evidence | framework mapping, signed proof reports, exports |

The infrastructure is ~80% present. What's missing is **packaging + a metering
rollup + a pricing surface** — all deliberately removed in 2.18.0.

## Pricing posture (illustrative only — not a commitment)

- **OSS:** $0.
- **Cloud:** free dev tier (small monthly governed-action cap, 1 seat) →
  usage-metered growth → flat team plan. Free tier must stay genuinely useful so
  the funnel keeps working.
- **Enterprise:** annual contract, quote-based (SSO + compliance + support).

Anchor on a free cloud tier generous enough that a solo developer never feels
nickel-and-dimed; charge teams/enterprises for scale, evidence, and support.

## Recommended sequence (when you greenlight)

1. **Metering rollup** — a read-only "governed actions + seats this month" report
   per org (no billing yet). Proves the value metric is measurable.
2. **Cloud free-tier gating** — soft caps with clear in-product signals (never
   silent failures), honoring the calm-under-pressure design principle.
3. **Re-introduce a pricing page** — one honest page, brand-restrained, that
   explains OSS-vs-Cloud-vs-Enterprise. (Reverses the 2.18.0 retraction — your
   explicit call.)
4. **Enterprise add-ons** — SSO + compliance scheduling, sold, not flagged.

## Open questions for you

- **OSS boundary:** confirm everything in Tier 0 stays free forever (recommended).
- **Value metric:** governed-actions + seats — agree, or prefer agents-governed?
- **Cloud vs enterprise-first:** chase self-serve cloud, or land-and-expand
  enterprise (SSO + compliance) first? The buyer analysis above leans enterprise.
- **Re-open 2.18.0?** This plan assumes the no-pricing retraction is reversible.
  Confirm before any pricing surface returns.

# RFC: Policy Pack Gallery + Expanded Pack Catalog

- **Date:** 2026-08-14
- **Status:** Implemented 2026-08-14 (see "As-built deviations" at the end)
- **Author:** Claude (directed by Wes)
- **Decision driver:** Packs are worth more as distribution than as revenue at this stage. Ship a free, browsable gallery first. Paid/maintained packs are a later, separate decision (money — ask first).

## Summary

DashClaw already has policy packs. Seven exist in `app/lib/guardrails/packs/`, with an import API, a conflict-aware preview, and a catalog endpoint. What is missing is a **human surface**: today packs hide inside the Import modal on `/policies`. Nobody can browse them, compare them, or see what a pack *would have done* before installing it.

This RFC specifies:

1. A **Pack Gallery** — a browsable, filterable surface where an operator picks a pack, previews its effect against their own last 30 days of decisions, and installs it with one click.
2. **Eleven new packs** that cover the main audiences and situations (spend, outbound comms, unattended runs, prod infra, data protection, subagent fleets, support agents, CI bots, evidence trails, read-only analysts, browser operators).
3. The small format and API extensions needed — **zero new API routes**; two existing routes get extended.

## Ground truth (what exists today)

| Piece | Where | State |
|---|---|---|
| Pack files | `app/lib/guardrails/packs/<id>/policies.yml` (+ optional `guardrails.yml`) | 7 packs |
| Pack metadata | `app/lib/policyPackPreviews.ts` (`PACK_PREVIEWS`) | name, description, recommended_for |
| Catalog API | `GET /api/policies/templates` | Returns all packs with per-policy `rules_summary` |
| Install API | `POST /api/policies/import` `{pack}` or `{yaml}`, `?preview=true` dry run | Conflict detection by policy name; admin-only |
| Simulate API | `POST /api/policies/simulate` `{policy_type, rules, days}` | Single policy only — no pack-level simulate |
| Human surface | `ImportPanel.tsx` modal behind the Ledger "Import" button | Pack picker inside a modal; not browsable |
| Policy types | `app/lib/validate.js` `POLICY_TYPES` | 17 types |
| Pack tests | Embedded `tests:` blocks in each `policies.yml` | Run by the policy smoke harness |

The existing 7 packs: `catastrophe-only`, `claude-code-starter`, `layered-intelligence`, `development`, `startup-growth`, `smb-safe`, `enterprise-strict`.

## Assumptions stated as facts

1. Free packs only. No payment, licensing, or signing in this RFC.
2. Packs stay **in-repo** (first-party). No third-party submission pipeline yet.
3. The gallery is a sub-route (`/policies/packs`), not another section on the already-long `/policies` page.
4. Pack metadata stays in `PACK_PREVIEWS` (TypeScript registry) rather than moving into the YAML. ~18 entries is fine for a hand-curated registry, and it avoids touching the shared `loadPackPolicies` loader.

## Human surface (HUMAN-EXPERIENCE.md answers)

1. **Where does a human SEE it?** `/policies/packs`. Click path: `/policies` Ledger toolbar gets a **"Browse packs"** button next to Import; `/setup` and `/connect` link to the gallery in their "first policies" step. The Import modal stays for raw-YAML power users.
2. **Is it discoverable?** Yes — three entry points above, all on pages operators already use. Plus a marketing-site "Policy Packs" section shipped in the same change (clause 4).
3. **Is every human step a CLICK?** Yes. Browse → filter chips → open pack → "Preview against my history" → "Install pack". Zero terminal steps.
4. **Was it verified rendered?** Ship gate: drive `/policies/packs` with frontend-verify, confirm cards render with real catalog data, filters work, one full install round-trip on a dev org.

**New-page requirement:** `/policies/packs` needs a demo-dispatch route entry, or the demo instance 403s blank (known gotcha).

## Gallery UX

### Card grid

Each pack renders one card:

- Name + one-line description.
- **Audience chip** and **strictness chip** (taxonomy below).
- Rule-bucket counts: `N block · N approve · N warn` (derived from the catalog response, same buckets the Ledger uses).
- `recommended_for` line.
- **Installed** badge when every policy name in the pack already exists in the org (server-computed).
- Stacking note when relevant ("Install claude-code-starter first").

### Filter chips

Two filter rows, both single-click:

- **Audience:** All · Coding agents · Money · Comms · Infra & deploys · Data · Fleets · Unattended · Support.
- **Strictness:** Permissive · Balanced · Strict.

### Pack detail drawer

Clicking a card opens a drawer (same pattern as ModeDrawer):

1. Full policy list — name, type, `rules_summary`, bucket.
2. **"What would this pack have done?"** button → pack-level simulate against the org's last 30 days: "Would have blocked 3, held 12 for approval, warned on 9 — out of 412 actions." Expandable list of the matched actions.
3. Conflict preview (reuses `?preview=true`): "8 policies will be created, 1 skipped (name exists)."
4. **Install pack** button (admin-gated, same as import today). Non-admins see the button disabled with the reason.

The simulate-before-install step is the whole pitch. It turns an abstract rule list into "here is what this would have caught in *your* history."

## API changes (zero new routes)

### 1. `GET /api/policies/templates` — extend response

Add per-pack: `audience`, `strictness`, `stack_after` (optional pack id), `installed` (boolean, org-scoped: true when every pack policy name exists via `findPolicyByName`), and per-policy `bucket` (`block | approve | warn | other`, derived the same way the Ledger derives buckets).

`PackPreview` in `policyPackPreviews.ts` gains `audience`, `strictness`, `stack_after?`.

### 2. `POST /api/policies/simulate` — accept a pack

New accepted body: `{ pack: string, days?: number }` (existing `{policy_type, rules, days}` unchanged). When `pack` is present: load via `loadPackPolicies`, evaluate every policy in the pack against the same historical window, return per-policy summaries plus an aggregate. An action matched by multiple policies counts once in the aggregate, at the most severe outcome (block > require_approval > warn).

### 3. `POST /api/policies/import` — unchanged

`AVAILABLE_PACKS` grows automatically as packs are added to `PACK_PREVIEWS`.

## Pack taxonomy

Two axes, assigned to every pack (existing ones included):

**Strictness ladder (existing packs, unchanged):** `development` (Permissive) → `startup-growth` (Balanced) → `smb-safe` (Balanced) → `enterprise-strict` (Strict).
**Baselines:** `catastrophe-only` (everyone), `claude-code-starter` (coding agents), `layered-intelligence` (stacks on starter).

## New packs (11)

Rules below are sketches; final YAML uses the exact `action_type` vocabulary the hooks emit (see `claude-code-starter` for the mapping conventions: destructive shell → `security`, network → `api`, package installs → `build`). Every policy ships with embedded `tests:` blocks and must pass the policy smoke harness. All policy types used are from the 17 in `POLICY_TYPES`.

### 1. `spend-lockdown` — Money · Strict

The v5.24.1 real-money class as an installable pack.

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Hold all real-money actions | require_approval | action_types: payment, purchase, spend, prepay, buy_credits, top_up, subscription_create, subscription_change, billing, domain_purchase, card_charge | approve |
| Block high-risk spend outright | risk_threshold | threshold 90 on the same action types, action: block | block |
| Rate-limit spend attempts | rate_limit | >5 spend-class actions / 10 min → warn (catches loops before the queue floods) | warn |

### 2. `outbound-comms-guard` — Comms · Strict

For agents that can email, post, or message real people.

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Hold external sends | require_approval | action_types: message, email, post, publish, outreach | approve |
| No fabricated claims in outbound | non_fabrication | applies to comms action types | block |
| Bulk-send brake | rate_limit | >10 comms actions / 10 min → block | block |

### 3. `night-shift` — Unattended · Strict

The THESIS pack: approval-gate the world while the human is away. Named honestly — this is the product's core story.

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Hold everything external | require_approval | action_types: api, deploy, message, email, post + all spend-class | approve |
| Tight runaway brake | rate_limit | >50 actions / 10 min → block | block |
| Pause on plan deviation | deviation_response | any deviation from submitted plan → require_approval | approve |
| Block high risk, no exceptions | risk_threshold | threshold 70, action: block | block |

### 4. `prod-infra-shield` — Infra & deploys · Strict

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Hold deploys, migrations, DNS, config | require_approval | action_types: deploy, migration, infra, dns, config_change | approve |
| Protect production config paths | protected_path | prod config/infra path globs → block | block |
| No deploy without green gates | green_contract | deploy requires passing verification evidence | block |
| No deploy from a stale branch | branch_freshness | enforce freshness before deploy | block |

### 5. `data-protection` — Data · Strict

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Protect secrets and env paths | protected_path | .env*, secrets/, credentials path globs → block | block |
| Hold data exports | require_approval | action_types: export, data_transfer | approve |
| Evidence before bulk data ops | require_evidence | bulk read/delete of data stores needs cited evidence | approve |

### 6. `fleet-control` — Fleets · Balanced

For orchestrators spawning subagents.

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Only known agents act | agent_allowlist | registered agent ids only | block |
| Cap delegation depth and width | delegation_constraint | max depth 2, max concurrent children N | block |
| No self-escalation | permission_escalation | block scope-widening grants | block |
| Per-agent runaway brake | rate_limit | per-agent 100 actions / 10 min → warn | warn |

### 7. `support-agent` — Support · Balanced

Customer-facing helper agents (refunds, replies).

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Hold refunds and credits | require_approval | action_types: refund, credit, order_change | approve |
| No invented order facts | non_fabrication | claims about orders/accounts need grounding | block |
| Evidence for account claims | require_evidence | account-state assertions cite a record | approve |
| Outbound reply brake | rate_limit | >20 replies / 10 min → warn | warn |

### 8. `ci-release-bot` — Coding agents · Permissive

Fast lane for build/test, hard gate at the release edge.

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Free lane for build and test | allow_grant | action_types: build, test, lint | other |
| Green before release | green_contract | release/deploy needs verification evidence | block |
| Fresh branch before release | branch_freshness | block releases from stale branches | block |
| Hold production deploys | require_approval | action_types: deploy | approve |

### 9. `evidence-first` — Data · Balanced

For teams that need a defensible trail. **Naming rule: no compliance-framework claims.** This is "Evidence First," never "SOC 2 Pack" — a pack name that implies certification implies a warranty we do not offer. `recommended_for` may say "teams preparing for audits"; it may not name a framework as a promise.

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Evidence for all risky acts | require_evidence | risk ≥ 40 requires cited evidence | approve |
| External verification hook | webhook_check | notify/verify endpoint on high-risk decisions | other |
| Warn on unevidenced writes | warn_action_type | write-class actions without evidence → warn | warn |

### 10. `read-only-analyst` — Coding agents · Strict

Research/analysis agents that must never write.

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Reader role enforced | role_constraint | role: reader | block |
| Block all write-class actions | block_action_type | action_types: apply, deploy, message, email, payment, export, migration | block |
| Warn even on ambiguous acts | warn_action_type | action_types: api → warn | warn |

### 11. `browser-operator-guard` — Unattended · Strict

Agents driving real browsers (OpenClaw, computer use).

| Policy | Type | Rule sketch | Bucket |
|---|---|---|---|
| Hold form submissions and logins | require_approval | action_types: form_submit, auth, purchase (as emitted by the browser-side hook mapping) | approve |
| Block high-risk browser acts | risk_threshold | threshold 80 → block | block |
| Click-loop brake | rate_limit | >100 browser actions / 10 min → warn | warn |

## Exemplar pack YAML (`spend-lockdown`)

```yaml
version: 1
project: spend-lockdown
description: >
  Real money is a named high-risk class. Every payment-class action is held
  for human approval at the exact amount; risk-clamped spend is blocked
  outright; spend loops trip a rate warning before they flood the queue.

policies:
  - id: hold_all_spend
    description: "Spend Lockdown — Hold All Real-Money Actions"
    policy_type: require_approval
    rules:
      action_types: [payment, purchase, spend, prepay, buy_credits, top_up,
                     subscription_create, subscription_change, billing,
                     domain_purchase, card_charge]
    tests:
      - name: holds_card_charge
        input: { action_type: card_charge, declared_goal: "Charge card $49 for API credits" }
        expect: { decision: require_approval }
      - name: allows_non_spend
        input: { action_type: apply, declared_goal: "Edit: README.md" }
        expect: { decision: allow }

  - id: block_high_risk_spend
    description: "Spend Lockdown — Block High-Risk Spend"
    policy_type: risk_threshold
    rules:
      threshold: 90
      action: block
      action_types: [payment, purchase, spend, card_charge]
    tests:
      - name: blocks_risk_clamped_spend
        input: { action_type: payment, risk_score: 95, declared_goal: "Wire transfer to new payee" }
        expect: { decision: block }

  - id: spend_loop_brake
    description: "Spend Lockdown — Rate-Limit Spend Attempts"
    policy_type: rate_limit
    rules:
      max_actions: 5
      window_minutes: 10
      action: warn
      action_types: [payment, purchase, spend, card_charge]
    tests:
      - name: warns_on_spend_burst
        input: { agent_id: shopper, action_count: 8, window_minutes: 10 }
        expect: { decision: warn }
```

## Stacking model

Packs are additive and composable — importing two packs imports both rule sets; the guard already resolves overlaps at evaluation time (most severe outcome wins). The gallery encodes recommended order via `stack_after`:

```
catastrophe-only  →  everyone, always (seeded by default)
  └ claude-code-starter → coding agents
      └ layered-intelligence
  └ any domain pack (spend-lockdown, outbound-comms-guard, …)
      └ optionally one strictness pack (development → enterprise-strict)
```

## What this RFC does NOT do (explicit non-goals)

- **No paid packs.** Pricing, licensing, maintained-pack subscriptions: separate future decision (money — ask first).
- **No remote marketplace or third-party submissions.** Packs ship in-repo, reviewed like code.
- **No pack signing/verification.** Meaningless until packs come from outside the repo.
- **No compliance certifications.** Packs are starting points, not certified controls; the gallery footer says so in one sentence.

## Implementation plan

| Phase | Work | Verify |
|---|---|---|
| 1 | Extend `PackPreview` + `/api/policies/templates` (audience, strictness, stack_after, installed, bucket) | vitest on templates route; typecheck |
| 2 | Pack-level simulate (`{pack, days}` on `/api/policies/simulate`) | vitest: pack simulate aggregates + severity dedup |
| 3 | `/policies/packs` gallery page + detail drawer + demo-dispatch entry; "Browse packs" button on Ledger toolbar; links from /setup and /connect | frontend-verify drives the page; one full install round-trip on dev org |
| 4 | 11 new pack YAMLs + previews + embedded tests | policy smoke harness green; a vitest asserting every pack parses, every `policy_type` ∈ POLICY_TYPES, every policy has ≥1 test |
| 5 | Docs (`/docs` platform guide section, README), marketing-site "Policy Packs" section, doc-count derivation if pack count gets cited | doc:counts; lint; full vitest; next build |

Ship order: phases 1–2 can land together (API only, invisible); 3–4 together (the visible ship); 5 in the same release as 3–4 per HUMAN-EXPERIENCE clause 4.

## Open questions for Wes

1. Gallery placement: this RFC picks the `/policies/packs` sub-route. If you would rather have it inline on `/policies` (heavier page, one less route), say so before Phase 3. *(Resolved: sub-route, approved with "continue".)*
2. Should `night-shift` be featured as the hero pack in marketing? It is the pack that *is* the thesis.

## As-built deviations (2026-08-14)

The engine forced four changes to the pack sketches above; the shipped YAMLs are authoritative:

1. **`risk_threshold` has no per-action-type filter** — its evaluator reads only `threshold`/`action`. Spend Lockdown's "block high-risk spend" became a spend-scoped `require_evidence` policy instead; Night Shift and Browser Operator Guard use org-wide risk ceilings with `action: require_approval` (pause, not block — recoverable overnight).
2. **`rate_limit` counts ALL of an agent's guard evaluations**, not one action type. Every pack's rate brake is documented as a generic per-agent brake, tuned per pack.
3. **`webhook_check` requires a customer URL and fails closed** — it cannot ship in a pack. Evidence First drops it; the pack uses two `require_evidence` tiers (warn-all + approval on high-stakes classes) instead.
4. **`allow_grant` requires a `target_prefix` scope** (blanket grants were banned in the 2026-08-05 governance-gap audit) — CI Release Bot drops its "free lane" grant; build/test are default-allow anyway.

Additions beyond the spec: the demo passthrough for `/api/policies/templates` strips caller-supplied org headers and sets `x-dashclaw-demo` (an unauthenticated demo caller could otherwise spoof `x-org-id` and probe another org's installed-pack state), and `summarizeRules` learned the new-format `rules:` key so gallery rule summaries don't all read "custom".

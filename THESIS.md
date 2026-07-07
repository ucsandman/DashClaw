# DashClaw — the product thesis

**Status: CANONICAL.** Adopted 2026-07-06 by the maintainer under Wes's
full-product-authority mandate (this session's charge: *"decide what the perfect
product is given everything you know, then make the repo be exactly that product
and nothing else"*). This is the ONE product-strategy document. Every document in
the [Superseded documents](#superseded-documents) list below is historical the
moment this file lands. The [MAINTAINER.md](MAINTAINER.md) constitution (§1–§5)
remains fully binding and is not touched by this thesis.

How this thesis was reached: nine parallel evidence miners (project memory,
maintainer log end-to-end, roadmaps v1–v8, RFCs/architecture, market evidence,
code-reality survey, the `_archive` autopsy, session history, positioning),
five candidate product definitions from genuinely different lenses, fifteen
adversarial judges, two independent cross-candidate comparators. Both
comparators converged on the same physical product and disagreed only on
framing. This document is that product, committed.

---

## What DashClaw is

**When your AI coding agent tries something destructive, DashClaw catches it
before it runs and asks you first — even when you're not at the keyboard.**

DashClaw is a fail-closed approval layer that sits between an agent *deciding*
to call a tool and the tool *actually running*. It is not a dashboard that
records what an agent did; it is the thing that stops the agent mid-action.

The whole product is one loop:

1. **Intercept** — a PreToolUse hook in Claude Code / Codex / Hermes (plus
   `dashclaw_invoke` and the OpenClaw gateway) catches a tool call before it
   executes.
2. **Decide** — the guard engine risk-scores the call against your policies
   into the decision lattice `allow < warn < require_approval < block`
   (join = max; blocks are absolute).
3. **Approve** — `require_approval` freezes the action and pages a human, who
   approves or denies **with one click, from anywhere** — the Approvals inbox,
   a phone, not a terminal. Grants are single-use and act-hash-bound.
4. **Prove** — every decision writes a durable, replayable, signed audit row
   (Ed25519 receipts, JWKS export), and a liveness probe continuously proves
   the governor is awake — because it once wasn't (v4.72.1) and nothing noticed.

One primary human surface: the **Approvals inbox** — the live stream of what
your agent just tried, the items waiting on you, two buttons per item. Support
surfaces only: `/setup` (first run), `/policies` (a small set of safety
switches + calibration review), `/decisions` (the audit ledger). Nothing else
on the front door.

## For whom

A solo developer or small team running **long, unattended autonomous
coding-agent sessions** — overnight runs, CI agents, background fleets —
against a real repo and real infrastructure. The person who kicks off a 1–6
hour run, cannot watch every tool call, and is one bad run away from an agent
that force-pushes over main, wipes a directory, drops a table, or reads a
secret.

**Honesty about the incumbent:** Claude Code and Codex already ship native
permission prompts for the at-keyboard user, for free. DashClaw does not
compete with those. The wedge is the job native prompts structurally cannot
do because they require your presence:

- **remote/async approval** — the agent freezes on the dangerous call and you
  approve from wherever you are, minutes or hours later;
- **one central policy** across every runtime and every session, instead of
  per-session allowlists;
- **a tamper-evident audit trail** that proves what was blocked, approved, and
  by whom;
- **calibrated interruptions** — a distribution-free controller
  (`app/lib/guard/calibration.ts`, v4.74.0) that tunes the interruption
  threshold from your approve/deny stream with a proven false-block bound,
  so governance earns its interruptions instead of nagging you into
  disabling it;
- **enforcement liveness** — the governor proves it is still enforcing
  (v4.75.0), rather than failing open silently.

Not compliance officers. Not enterprise RBAC buyers. Not observability
shoppers (LangSmith/Langfuse record; DashClaw prevents). Not a marketplace,
not an agent platform.

## Why these pieces and not the others

Every line of evidence converges on the enforcement vertical:

- **It is what the code is objectively best at.** The guard engine is 11
  clean modules (~3,100 lines); guard/policy/risk/approval/calibration tests
  are the densest cluster in the suite; the tri-runtime hooks are the
  hottest-churned core; the calibration controller is the one section of the
  theory doc marked "Implemented", with two proven theorems and a golden-vector
  corpus; the liveness probe is a hard-won answer to a real, named incident.
- **It is the only value the product has ever demonstrably delivered.** Every
  real catch in the record — `rm -rf`, `DROP TABLE`, force-push, `.env`
  extraction at risk 100 — is this loop firing. The demo is the product.
- **It is what the constitution is built on.** "Blocks are absolute", "no
  self-approval", "precision of interruption is THE product metric" — verbatim
  MAINTAINER.md, all pointing at this subsystem.
- **Everything else was either scaffolding for this loop or a different
  product wearing the same name** — and that different product (the agent
  platform) was already tried, archived (`app/api/_archive`), regrown, and is
  the reason ~250 of ~290 active routes contradict the repo's own stated
  identity ("a minimal governance runtime, not an agent platform").

## Enforcement honesty (a standing copy rule)

Enforcement is mechanically real **where DashClaw sits in the seam between
decide and execute**: the Claude Code / Codex / Hermes hooks (fail-closed,
exit-2 on block), the OpenClaw gateway, and `dashclaw_invoke`. Everywhere else
(bare SDK/API/MCP callers, desktop chat) governance is cooperative — the 2026
enforcement-boundary ruling that killed the universal proxy stands. Outward
copy never implies universal hard enforcement. Claims obey claims-proven-live.

## Defaults (the fatigue lesson, encoded)

The only real usage event in the product's history is negative: the reference
deployment ran with **all policies off for 18 days** because the default pack
fired an approval roughly every ten seconds. Therefore:

- **The default policy pack is catastrophe-only.** Out of the box, DashClaw
  interrupts for the irreversible class (destructive filesystem/git/database
  actions, secret reads/exfiltration) and lets everything else run.
- **Calibration ships on, in its constitutional mode.** The controller runs
  from first use; anything that loosens enforcement is a proposal a human
  ratifies with one click in `/policies` (constitution §3 — no auto-applied
  enforcement changes).
- **Fail-closed stays the default** at the hook seam, and the liveness probe
  watches the seam.

## Distribution

- **The primary door is the runtime the user already has:** one-command plugin
  install / `npx dashclaw up`. First protective value lands at install — a
  working catastrophe pack and a first caught action — **no account on the
  path to first value.**
- **The hosted trial (hosted.dashclaw.io) is demoted to the secondary door:**
  "see the Approvals inbox without deploying." It stays alive because the
  remote-approval wedge needs a reachable server and a zero-infra taste of it
  is worth operating — but no funnel step points a stranger at a credential
  before they have seen a block fire. The graduation/export path survives with
  it.
- The self-governance story ("an AI maintains this project under its own
  governance") moves off the front door to an about/proof page. It is
  supporting evidence, not the pitch.

## Explicitly out of scope — what dies

The criterion: **if a surface is not on the loop
(intercept → decide → approve → prove) or directly supporting it
(auth/keys, setup, health), it is not DashClaw.**

Dying with this thesis (exhaustive per-surface rationale + last-SHA in the
kill ledger, `docs/releases/`): the agent-platform tier — code
sessions/optimal-files/CLAUDE.md generation, capabilities registry (the
`dashclaw_invoke` enforcement seam survives), workflows/work-orders/swarm,
prompts library, knowledge/RAG (pgvector), model-strategies/BYOK routing,
scoring, reputation/leaderboard, evaluations, learning + behavior learning,
drift engine, compliance cockpit (signed receipts/JWKS export folds into the
audit layer), messages/threads, handoffs, loops, launch plans, managed
secrets, the status-widget PWA; x402/FinOps/CostClaw surfaces (a separate
thesis — spend governance is real but it is not this product; RFC 0002 stays
gated on Wes and out of this repo's front door); the MCP server's absorbed
provider-tool fork (Stripe/Vercel/Neon/Twilio/Namecheap/Supabase/Sentry — the
archived platform re-imported, ~19k lines); the deprecated `dashclaw/legacy`
SDK surface (its removal was already promised for v5); `app/api/_archive`
(48 runtime-dead routes, deleted outright — the fossil taught its lesson);
and the process exhaust at the repo root and in docs (superseded specs,
logs, media, one-off directories).

The SDKs collapse to the governance core (guard / record / assumptions /
approvals / halt / posture and their supporting calls). The MCP server
shrinks to the governance toolset. The CLI keeps the install/run/doctor/
approvals path. Plugins keep hook parity across Claude Code / Codex / Hermes.

**No destructive database migration ships with the cull** (constitution-safe:
retired tables stay in place; a documented export-then-drop path can follow
separately).

Team/RBAC stays declined (trigger unchanged: a second human governing an
org). The TypeScript migration stays declined. Paid tiers stay gated on Wes.

**The forward bet stays compatible:** the governed-autonomy RFCs
(2026-07-06: preflight plan authorization, scoped delegation constraints,
containment verdicts) extend this exact loop to plans, delegation, and
containment for unattended autonomy. They remain the post-v5 direction.

## Falsification — what would prove this thesis wrong

Criteria that fire **without** strangers (the last eight eras prove stranger
cohorts cannot be assumed):

1. **Intrusiveness (7 days, any installs):** if >50% of installers disable
   enforcement within their first week — a repeat of the 18-day incident —
   the checkpoint cannot be lived with as shipped.
2. **Shippability (continuous):** if a factory-fresh machine cannot go from
   install to first-block-and-one-click-approve in ≤10 minutes (the entry
   drills, v4.76.0, pin this), the product fails its own legibility bar.
3. **Regrowth (60 days):** if the surface budget (below) is raised without a
   thesis amendment, the identity did not hold and this document failed.

Criteria that need real external use (honest status: **demand is un-refuted,
not proven** — attention remains the owner's lever, per MAINTAINER.md §4):

4. **Value (30 days from ≥10 stranger installs):** fewer than 2 reach
   "agent blocked → I approved → agent continued" → the value prop is wrong,
   not the friction.
5. **Differentiation:** if adopters use only the ledger and never the
   blocking, observability — not enforcement — is what they wanted, and the
   axis is wrong.
6. **Provable enforcement:** if the liveness probe or an audit surfaces
   another silent fail-open on a user's machine, "provable enforcement" is
   false and this is advisory tooling.

## The measurement window (July 19–20) — ruling

The v8.1 cohort read (≥2026-07-19) and v8.6 exit read (≥2026-07-20) **still
run as scheduled** — `scripts/measurement-read.mjs` survives, the dates hold,
and the verdicts get written. A product built on claims-proven-live does not
delete its own instrument days before it fires. But the window is demoted
from steering gate to honesty artifact: the v8.5 "branch selected by the
read" mechanism is superseded — this thesis IS the branch decision, made on
product-definition grounds under the owner's mandate. The read's arithmetic
(cohort n, per-channel `bySource`) gets recorded against the OLD door and
becomes the baseline the new falsifiers are judged against.

## The anti-regrowth brake

The 2026-03 purge (178→5 SDK methods, 142 routes archived) regrew to full
sprawl within four months, and the "Governance Boundary CI check" it promised
never shipped. This time the brake is mechanical and shipped: a **surface-budget
gate in CI** (`scripts/check-surface-budget.mjs`, `npm run surface:check`, wired
into `.github/workflows/ci.yml` alongside the other contract gates). It counts
every governed surface each run — active API routes, pages, MCP tools, MCP
resources, Node + Python SDK methods, CLI commands, guard policy types — and
fails the build when any exceeds its v5.0.0 ceiling. Exceeding a ceiling fails
the build unless the commit also amends this document with a written reason.
Sprawl becomes a deliberate, recorded act instead of a drift.

The adopted ceilings — set to the exact live count at v5.0.0, and the machine
source of truth for the gate, live in `contracts/surface-budget.json`:

| Surface | Ceiling | Counted from |
|---|---|---|
| Active API routes | 118 | `app/api/**/route.{js,ts,tsx}` |
| App pages | 45 | `app/**/page.{js,jsx,ts,tsx}` |
| MCP tools | 12 | `mcp-server/src/tools.ts` |
| MCP resources | 3 | `mcp-server/src/resources.ts` |
| Node SDK methods | 28 | `sdk/dashclaw.js` (`scripts/count-sdk-methods.mjs`) |
| Python SDK methods | 51 | `sdk-python/dashclaw/client.py` (`scripts/count-sdk-methods.mjs`) |
| CLI commands | 13 | `cli/bin/dashclaw.js` (`COMMAND_HANDLERS`) |
| Guard policy types | 14 | `app/lib/guard/policy.ts` (`KNOWN_POLICY_TYPES`) |

Raising any ceiling requires amending this section **and**
`contracts/surface-budget.json` in the same commit with a written reason — the
recorded, deliberate act that falsifier #3 (Regrowth) watches for.

**Amendment log:**
- **v5.0.0-rc final-fix — Active API routes 117 → 118.** Restored a slim,
  read-only, org-scoped `GET /api/agents`. The cull removed the full
  agent-roster route but three live UI callers (the shared agent-filter
  picker, the identities fleet view, the policy CustomTab agent dropdown) plus
  the MCP evidence probe still fetched it, so every authenticated page shipped a
  console 404. The restored route lists distinct agents from `action_records`
  via the surviving repository; it does not revive the fleet-observability
  surface the cull deleted.
- **v5.0.0-rc final-fix — App pages 46 → 45 (ratchet down).** Deleted
  `app/actions/[actionId]/page.tsx`, a duplicate replay view the cull's own
  inventory marked KILL but never removed; its two inbound links were repointed
  to the canonical `/decisions/[actionId]`. The ceiling ratchets down so
  regrowth back to the deleted page trips the brake.

## Version story

This cull ships as **v5.0.0** — the major break the removal list demands, and
the version at which the deprecated legacy SDK surface was already promised
to disappear. Migration notes accompany the release; every removed surface is
recoverable by SHA via the kill ledger.

## Superseded documents

Historical as of this file (retained under `docs/plans/archive/` where not
already archived; superseded ≠ erased):

- `docs/plans/owner-roadmap.md` (v8 "the vigil") — v8.1/v8.6 reads carried
  into this thesis's measurement ruling; v8.4 (health floor) absorbed into
  ordinary maintenance; v8.5 (branch) superseded by this thesis.
- `docs/plans/archive/owner-roadmap-v1-v3.md`, `-v4.md`, `-v5.md`, `-v6.md`,
  `-v7.md` (already archived; now closed).
- `docs/plans/2026-04-03-dashclaw-layered-intelligence.md`,
  `2026-06-12-layered-intelligence-rebaselined.md`,
  `2026-06-12-posture-score-rebaseline.md` — the platform-convergence era.
- `docs/plans/dashclaw-hardening.md`, `dashclaw-hardening-report.md`,
  `typescript-migration.md` (declined a seventh and final time under this
  thesis: mechanical churn, zero behavior change).
- `docs/plans/platform-convergence.md` + status/evidence companions.
- `docs/rfcs/0001-generative-ui-governance.md` (three-product company) and
  `docs/rfcs/0002-costclaw-dashclaw-integration.md` (open-core paid add-on) —
  archived as presuming a different product; the CostClaw/x402 money gate
  (§8, Wes) is unchanged by this thesis.
- Executed one-off specs in `docs/plans/2026-07-*` (identity, approvals
  hygiene, guard deadline/noise, load-harness scope, HX retro audit,
  explain-claims audit) — their contributions live in the code and this
  document.
- The three 2026-07-06 governed-autonomy RFCs are **not** superseded; they
  are the forward direction, re-grounded on this thesis.

## Relationship to MAINTAINER.md

The constitution (§1–§5) binds this thesis and everything built under it.
MAINTAINER.md's introductory thesis paragraph ("protects agents … from being
weaponized, blamed unfairly, or bankrupted") is broader than this product:
the "blamed unfairly" direction survives here as the signed audit/evidence
layer; the "bankrupted" direction (spend governance) is out of scope per
this thesis. Per §5, the maintainer does not edit that file unilaterally: a
proposed amendment aligning its thesis paragraph with this document is
prepared for Wes's ratification and travels with the release notes.

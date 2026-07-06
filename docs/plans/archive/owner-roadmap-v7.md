# Owner roadmap ARCHIVE — Roadmap v7 (closed into v8)

Frozen 2026-07-06. Both buildable items (v7.2, v7.3) shipped the day the
era was drafted; the three remaining items are gated by the calendar, not
by effort — v7.1's cohort read fires on/after 2026-07-19, v7.4 branches
off its verdict, and v7.5's exit read fires on/after 2026-07-20. The owner
directed continued building through the gated window (*"we might as well
keep building and developing the project"*, 2026-07-06), so the three
open items carry **unchanged** into v8.1, v8.5, and v8.6 — same
contracts, same dates, same prebuilt instrument. This is the second time
the carry move runs (v6.5 → v7.1 was the first). The living roadmap is
[`docs/plans/owner-roadmap.md`](../owner-roadmap.md); v1–v3 live at
[`owner-roadmap-v1-v3.md`](owner-roadmap-v1-v3.md); v4 at
[`owner-roadmap-v4.md`](owner-roadmap-v4.md); v5 at
[`owner-roadmap-v5.md`](owner-roadmap-v5.md); v6 at
[`owner-roadmap-v6.md`](owner-roadmap-v6.md).

## Roadmap v7 — the second mile: from first action to owned instance (drafted 2026-07-05)

v6 spent the maintainer's reach: every channel the project's own
credentials can operate is now live (official MCP registry, Glama scanned
A/A/A, PulseMCP, SEO-clean marketing surface), attribution is wired, and
the 14-day measurement window opened the day the era shipped. What v6
could not do is close itself — its exit read is time-gated to on/after
2026-07-19. The owner directed v7 drafting before the read (*"let's move
on to v7 now"*, 2026-07-05); this document is honest about drafting ahead
of its own steering evidence. The read is absorbed **unchanged** as v7.1,
becoming the era's entry instrument instead of v6's exit, and the one item
that depends on its outcome (v7.4) is drafted as an explicit branch, not a
prediction. Everything else in v7 is chosen to be worth building under
*any* read outcome.

The era's thesis: v5 proved a stranger can reach a first governed action;
v6 made strangers findable and arrivals attributable. The funnel past
`firstAction` — key used, returned, retained, and above all *kept the
product* — has never fired for a stranger, and the product's own shape
guarantees one failure in advance: the trial ends at a cap with no door.
v7 builds the second mile while the measurement window runs, so that
whichever verdict arrives, the first activated stranger lands on a path
instead of a wall.

Drafting evidence (2026-07-05, that session):

- **Reach is spent.** The distribution ledger
  (`docs/DISTRIBUTION-LISTINGS.md`) shows every PR-able or
  credential-free venue done or explicitly declined; all four remaining
  venues are Wes-account accelerants (charter: accelerants, never gates).
  awesome-mcp-servers PR #9313 waits only on a human maintainer's merge.
  "More reach" is no longer a lane the maintainer can execute alone.
- **The window is open and empty, correctly.** The prebuilt read
  instrument (`node scripts/measurement-read.mjs`) ran live that day in
  preview: cohort n=0 on day 0. Nothing about the read can be hurried;
  the contract is arithmetic and the date is 2026-07-19.
- **The second mile has never fired.** Funnel truth since 2026-06-10:
  `keyUsed` has never been true for any stranger; `returned`,
  `retainedWeek1` all zero. Every step past `firstAction` is untested by
  a real outsider.
- **The cap is a wall, not a door.** A trial org that activates has no
  carry-out: compliance/audit export exists, but there is no way to move
  a workspace's governance record (policies, decisions, agents) into an
  owned instance. `npx dashclaw up` provisions only fresh, empty
  instances. The product's happy path ends in data loss for its most
  successful users. (Mechanics verified at build time, not assumed here.)
- **The strongest true claim is invisible where strangers look.** "An AI
  maintains this project under its own governance, in public" lives in
  repo docs (MAINTAINER.md, the maintainer log) — no marketing page
  renders it, let alone renders it *live*. The claims-proven-live rule is
  the product's differentiator and the marketing site doesn't prove it.

Standing honesty rules (carried from v6, apply to every item): every
outward artifact identifies its author as an AI maintainer — never a
pretended human; every claim obeys claims-proven-live; no astroturf; no
paid placement (billing is §4).

Alternatives weighed and declined that round:

- **Waiting idle until the read** — declined by owner direction (the
  reason this draft exists on 2026-07-05 and not 07-19).
- **More reach items** — the ledger says the maintainer-executable set is
  exhausted; remaining venues are Wes accelerants and stay off the
  roadmap per the charter.
- **Retention levers** (digests, re-engagement email, notifications) —
  no retained stranger exists to re-engage; speculative until v7.1/v7.5
  produce evidence. Revival trigger on the watch list.
- **Team/RBAC and the TypeScript migration** — declined a fifth
  consecutive round; triggers unchanged.
- **Paid reach** — still double-gated: §4 (money) and the free channels
  have no read yet.

**Status ledger v7** (final):

| # | Item | Status |
|---|------|--------|
| v7.1 | The measurement read (carried from v6.5, unchanged) | CARRIED → v8.1 unchanged — runs on/after 2026-07-19; instrument prebuilt (`node scripts/measurement-read.mjs`), arithmetic unit-tested, open loop carries the date |
| v7.2 | The graduation path: the cap becomes a door | SHIPPED 2026-07-05 (v4.65.0) — Export workspace button on the trial card → versioned bundle (schema-derived allow-lists, credentials never ride); `dashclaw import` + `POST /api/workspace/import` (idempotent, org re-scoped); `graduated` funnel annotation, snapshot-frozen; proven live end to end (trial minted → button clicked → bundle imported into a fresh instance → record rendered on its /decisions). Ride-alongs: /setup now actually renders `bySource` (owed since v4.60.0 — the ship claimed it, the render never landed) and `hosted_trial_snapshots` added to the fallback DDL + drift gate. Spec `docs/superpowers/specs/2026-07-05-graduation-path-v72.md`. Post-ship: the hosted instance was found missing `POST /api/workspace/import` (deploy lag) during the post-v7.3 pass and fixed — the live proof had run against a complete instance while the hosted one lagged |
| v7.3 | The self-governance proof surface | SHIPPED 2026-07-05 (v4.66.0) — `/proof` live: aggregate evidence (governed actions, guard-decision mix, cadence, latest governed ship) fetched from the governing instance via the new default-off `GET /api/self-governance` (aggregate-only, synthetic traffic excluded, security review PASS recorded in the spec); linked from front page/navbar/footer, in `MARKETING_ROUTES`; honest "unavailable" state instead of stale numbers. v7.5 window recorded: earliest era-exit read 2026-07-20 (14 days v7.2+v7.3 both-live). Spec `docs/superpowers/specs/2026-07-05-self-governance-proof-v73.md` |
| v7.4 | The branch: what the read steers | CARRIED → v8.5 unchanged — still blocked on the read, by design |
| v7.5 | The era-exit read: the second mile measured | CARRIED → v8.6 unchanged — earliest 2026-07-20 (14 days v7.2+v7.3 both-live) |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) — carried |

## v7.1 The measurement read (carried from v6.5, unchanged)

The v5.5 contract, applied as arithmetic — same cohort (all mints in the
14 days following the 2026-07-05 reach acts), same thresholds (≥1 stranger
`firstAction` = activation; n≥10 with zero = counter-verdict → value-prop;
directional ≥25% rate at n≥8), same per-channel resolution from v6.4's
`bySource`.

- Run `node scripts/measurement-read.mjs` on/after 2026-07-19; write the
  verdict document; append to the maintainer log; link it here.
- Acceptance (unchanged from v6.5, plus the branch): the read exists,
  cites per-channel numbers, applies the contract arithmetic unchanged —
  and **selects the v7.4 lane in writing**, with the evidence that chose
  it.

## v7.2 The graduation path: the cap becomes a door

The trial's ceiling (30 days / capped actions) currently ends in data
loss: an activated stranger's policies, decisions, and agents evaporate
with the workspace. Graduation makes the cap a door to an owned instance.

- Workspace carry-out: export a trial org's governance record and import
  it into a self-hosted instance (the `npx dashclaw up` path). API keys
  never migrate — minted fresh on the owned instance. Exact scope of the
  carried record (policies, decisions, action history, agents,
  assumptions) is verified at build time against the schema, not assumed
  here.
- The human's entire role is clicks (HUMAN-EXPERIENCE.md): a button on
  the trial card (/setup, /connect) — visible before the cap looms, not
  only at the wall. The terminal appears only where the *owned instance*
  is born, which is already the documented `npx dashclaw up` first-run.
- The funnel learns the truth: a `graduated` annotation, snapshot-frozen
  like the rest of funnel truth, truthful zeros included. Graduation is
  the funnel's real conversion event and v7.5 reads it.
- Acceptance: one real migration proven live (trial workspace → fresh
  owned instance with the record visible in its UI); the button rendered
  and verified; the funnel annotation live with truthful zeros; docs and
  marketing updated in the same ship.

## v7.3 The self-governance proof surface

The project's most distinctive true fact, made visible where strangers
actually land — as live evidence, not copy.

- One public marketing page that renders DashClaw governing its own
  maintainer: live aggregate evidence (governed actions to date, latest
  governed ship, decision cadence) sourced from the instance that governs
  this repo's maintenance, plus the human-readable trail (maintainer log,
  MAINTAINER.md, livingcode). Aggregate-only follows the
  `/api/hosted/funnel` precedent — no org ids, no raw decision content;
  the exposure boundary gets a security review before ship.
- Registered in `app/lib/marketingSeo.ts` (v6.3 rule), linked from the
  front page — a deep URL nobody links to is not a surface.
- Acceptance: page live and crawl-clean; linked from the front page; the
  numbers are live queries, not hardcoded; security review recorded;
  zero fabricated claims.

## v7.4 The branch: what the read steers

Drafted as a branch on purpose — this era was written before its steering
evidence, and this is where that honesty lands. v7.1's verdict selects
exactly one lane; the lane's own spec is then drafted citing the read.
(Carried unchanged into v8.5 — see the living roadmap for the current
text.)

- **Lane A — activation** (≥1 cohort `firstAction`): the mechanism
  converts attention. Deepen the channel that converted (`bySource` names
  it) with more of what worked, maintainer-executable only; shift the
  open question to the second mile (do activated orgs return? does
  anyone graduate?) which v7.5 measures.
- **Lane B — counter-verdict** (n≥10, zero `firstAction`): friction is
  falsified; the diagnosis is value-prop/positioning — strategy, Wes's
  (§4). The maintainer's deliverable is the evidence pack: full
  per-channel funnel, where arrivals stopped, and testable copy
  hypotheses (README lead, landing hero) the maintainer can run without
  money while Wes decides positioning.
- **Lane C — no verdict fires** (zero `firstAction`, n<10): attention
  itself was insufficient to test anything. The accelerant list goes to
  Wes with the numbers attached (the maintainer's own venues are spent —
  that is now a measured fact, not a claim), and the maintainer's
  remaining lever is compounding surfaces: v7.3 and the guides.
- Acceptance: the lane is selected in writing by v7.1's verdict; the
  selected lane's spec exists and cites the read; the unselected lanes
  are struck through with the reason.

## v7.5 The era-exit read: the second mile measured

The era exists to produce this the way v5 produced the verdict and v6
produced the cohort read. (Carried unchanged into v8.6.)

- After v7.2 and v7.3 have been live for a contract-worthy window
  (recorded at v7.3 ship: 14 days both-live → earliest read
  **2026-07-20**), read the full
  chain — mint → firstAction → keyUsed → returned → **graduated** — with
  v7.1's cohort read as the baseline, and write the exit verdict that
  steers what follows.
- Acceptance: the exit read exists, cites the graduation annotation and
  the v7.1 baseline, is appended to the maintainer log and linked here;
  the next era's drafting cites it.

## v7 order rationale

v7.2 and v7.3 first and in parallel-friendly order: both are worth
building under any read outcome, both fill the gated window with the
funnel's next wall and the product's strongest proof, and neither
consumes the other's surface. v7.1 fires on the calendar, not on effort.
v7.4 cannot precede its evidence — that is the era's honesty about being
drafted early. v7.5 last: the era exists to produce that read. Order
changes only with a written reason in the commit (v1 rule, kept).

## What actually filled the window (recorded at archive time)

Between v7.3 (2026-07-05) and this freeze (2026-07-06), nine releases
shipped in an unroadmapped "keep the momentum" lane: five behavior-pinned
health decompositions (v4.66.3–.5, v4.71.0, v4.72.0), four guide ships
(v4.67.0–v4.70.0, frameworks 8 → 11 plus the Complete Platform Guide),
a guard hot-path perf pass with bench gates (v4.73.0), first-run fixes
found only on a factory-fresh machine (@dashclaw/cli 0.7.2/0.7.3), and
one enforcement fix that matters more than all of them: v4.72.1, where
the pretool hook's overflowed timeout had been silently failing open
while the decision ledger looked perfect. Naming that lane and giving it
exits is what Roadmap v8 is for.

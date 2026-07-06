# Owner roadmap — build order under MAINTAINER.md

Living document: the maintainer updates status lines as items ship; order
changes only with a written reason in the commit. Each item ships the full
protocol: spec → build → gates → live proof → main.

**Previous eras are archived, not appended.** Roadmaps v1–v3 (items 0–6,
v2.1–v2.7, v3.1–v3.7, shipped v4.22.0–v4.49.0) live at
[`archive/owner-roadmap-v1-v3.md`](archive/owner-roadmap-v1-v3.md); v4
(v4.1–v4.6, "no ungoverned lane", v4.49.1–v4.54.0) at
[`archive/owner-roadmap-v4.md`](archive/owner-roadmap-v4.md); v5
(v5.1–v5.5, "the first mile", v4.55.0–v4.59.0) at
[`archive/owner-roadmap-v5.md`](archive/owner-roadmap-v5.md); v6
(v6.1–v6.5, "the reach era", v4.59.1–v4.60.1) at
[`archive/owner-roadmap-v6.md`](archive/owner-roadmap-v6.md); v7
(v7.1–v7.5, "the second mile", v4.65.0–v4.66.0) at
[`archive/owner-roadmap-v7.md`](archive/owner-roadmap-v7.md).

## Roadmap v8 — the vigil: certainty while the window runs (drafted 2026-07-06)

v7 built the second mile the day it was drafted — the graduation door
(v4.65.0) and the self-governance proof surface (v4.66.0) both shipped
2026-07-05 — and then hit the same wall v6 did: the era cannot close
itself. Its cohort read is time-gated to on/after 2026-07-19, its branch
is selected by that read, and its exit read fires no earlier than
2026-07-20. The owner directed continued building through the gap (*"I am
aware we are waiting for the trials but we might as well keep building
and developing the project"*, 2026-07-06), so the carry move runs a
second time: all three gated items are absorbed **unchanged** — the
cohort read as v8.1, the branch as v8.5, the exit read as v8.6 — same
contracts, same dates, same prebuilt instrument. Like v7, this document
is honest about drafting ahead of its steering evidence, and everything
buildable in it is chosen to be worth shipping under *any* read outcome.

The era's thesis: the window is the product's first real audience, and
the last nine ships taught — twice, the hard way — that the product's
promises decay silently between manual proofs. Enforcement failed open
for days while the decision ledger looked perfect (v4.72.1); the flagship
install path was broken on any factory-fresh machine while working on
every developer machine (@dashclaw/cli 0.7.2–0.7.4). A measurement window
is only as honest as the surfaces it measures: if a stranger arrives and
the door is broken, the read records "no activation" when the truth was
"no product." v8 keeps the vigil — it converts the promises the read
depends on from *verified once at ship time* into *continuously proven*:
enforcement provably holding, both entry doors provably working
first-run, and the core at a measured health floor instead of an endless
improvement lane.

Drafting evidence (2026-07-06, this session):

- **The window is open and empty — day 1.** The read instrument ran live
  today in preview: cohort n=0, `firstAction` 0, "NO VERDICT FIRES" as
  the current trajectory. Nothing about the read can be hurried; the
  contract is arithmetic and the date is 2026-07-19.
- **The lane v8 formalizes already exists, unroadmapped.** Nine releases
  shipped between v7.3 and this draft (v4.66.1 → v4.73.0) under one-line
  owner direction ("keep the momentum"): five behavior-pinned health
  decompositions, four guide ships, a guard hot-path perf pass with
  bench gates, and one enforcement fix. Momentum without named exits is
  how a lane becomes drift; v8 gives each thread an acceptance and an
  end.
- **Enforcement failed open and the ledger never noticed.** v4.72.1's
  post-mortem (maintainer log, 2026-07-06): 73 cancelled pretool hooks
  in one session — every block and approval wait silently skipped while
  the orphaned hook processes kept landing guard calls, so the decision
  ledger stayed full of decisions that *looked* enforced. Found because
  the owner asked a question, not because the system did. Nothing today
  continuously proves the enforcement seam holds on a live install; the
  evidence pipeline is constitutionally unable to see this failure class,
  because it keeps working while enforcement dies.
- **First-run breaks only on machines nobody owns.** Three consecutive
  pre-launch sweeps found the flagship paths broken in ways no dev
  machine could show: embedded Postgres dying on factory Windows for
  want of the VC++ runtime (now auto-installed by `up`, CLI 0.7.4), the
  hosted instance missing the very import route v7.2's graduation door
  points at, and the overflowed hook timeout above. Both doors — the
  hosted trial and `npx dashclaw up` — rot silently between manual
  proofs, and the only fresh-machine harness is a one-off.
- **The health lane never terminates by construction.** "The worst file
  retires its title" (the 1.0/10 stop hook, the 1,261-line Decision
  Replay page) works, but there is always a next-worst file; the
  2026-07-06 code-health index still reads hotspot health 5.54/10. A
  lane without a floor is a lane that runs forever.

Standing honesty rules (carried from v6/v7, apply to every item): every
outward artifact identifies its author as an AI maintainer — never a
pretended human; every claim obeys claims-proven-live; no astroturf; no
paid placement (billing is §4).

Alternatives weighed and declined this round:

- **Waiting idle until the reads** — declined by owner direction, second
  era running (the quote above is why this draft exists on 2026-07-06
  and not 07-19).
- **More reach** — still spent, and now measured as spent (the ledger
  plus today's n=0 preview); remaining venues are Wes accelerants and
  stay off the roadmap per the charter.
- **Retention levers** — still no retained stranger to re-engage;
  revival trigger unchanged on the watch list.
- **Further guides expansion** — four consecutive guide ships
  (v4.67.0–v4.70.0) took frameworks 8 → 11 and built the Complete
  Platform Guide with its own drift CI gate; expanding further is
  channel-blind spend until a read says which channel converts. Revival
  trigger: v8.5 Lane A names a framework or content channel in
  `bySource`.
- **The TypeScript migration** — declined a sixth consecutive round,
  with a new reason specific to this era: a tree-wide mechanical churn
  during the measurement window risks destabilizing the exact surfaces
  the read depends on, for zero behavior change. Triggers unchanged.
- **Pre-drafting the branch lanes' specs** — the branch stays blocked on
  its evidence; drafting ahead of the read is this document's admitted
  compromise only where the calendar forces it, never where it doesn't.

**Status ledger v8** (update in place):

| # | Item | Status |
|---|------|--------|
| v8.1 | The cohort read (carried from v7.1, unchanged) | TIME-GATED — runs on/after 2026-07-19; instrument prebuilt (`node scripts/measurement-read.mjs`), arithmetic unit-tested, open loop carries the date |
| v8.2 | Enforcement liveness: the governor proves itself awake | SHIPPED 2026-07-06 (v4.75.0) — probe live on the governing instance (verdict `held` through the real hook + real policies), seeded v4.72.1 config detected and rendered red, aggregates unpolluted by construction; spec + evidence: `docs/superpowers/specs/2026-07-06-enforcement-liveness-v82.md` |
| v8.3 | Entry-path drills: both doors proven on repeat | SHIPPED 2026-07-06 (v4.76.0) — Linux drill green live (root break caught + fixed, @dashclaw/cli 0.7.6), hosted drill 6/6 live (local hosted build; live-hosted gated on operator token), Windows drill built + staged for the sandbox ritual; drill-mint token security-reviewed; spec: `docs/superpowers/specs/2026-07-06-entry-path-drills-v83.md` |
| v8.4 | The health floor: the momentum lane gets a target and an exit | — |
| v8.5 | The branch (carried from v7.4, unchanged) | BLOCKED on v8.1 (by design — selected by evidence) |
| v8.6 | The era-exit read (carried from v7.5, unchanged) | TIME-GATED — earliest 2026-07-20 (14 days v7.2+v7.3 both-live, recorded at v7.3 ship); needs v8.1's cohort read as baseline |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) |

## v8.1 The cohort read (carried from v7.1, unchanged)

The v5.5 contract, applied as arithmetic — same cohort (all mints in the
14 days following the 2026-07-05 reach acts), same thresholds (≥1 stranger
`firstAction` = activation; n≥10 with zero = counter-verdict → value-prop;
directional ≥25% rate at n≥8), same per-channel resolution from v6.4's
`bySource`.

- Run `node scripts/measurement-read.mjs` on/after 2026-07-19; write the
  verdict document; append to the maintainer log; link it here.
- Acceptance (unchanged through two carries): the read exists, cites
  per-channel numbers, applies the contract arithmetic unchanged — and
  **selects the v8.5 lane in writing**, with the evidence that chose it.

## v8.2 Enforcement liveness: the governor proves itself awake

v4.72.1's shape, recorded plainly in the maintainer log: a governance
system whose evidence pipeline keeps working while its enforcement is
dead produces maximum false confidence. The decisions page looked perfect
all week; the owner's question — "how were you able to write to those
files?" — was the only detector that fired. This item turns that question
into an instrument the system runs against itself.

- A liveness probe that proves the enforcement seam holds **end to end
  on a live install**: a synthetic action that policy must hold (block
  or approval-wait), driven through the same hook seam real actions use,
  verified by observing that the action *did not execute* — never by
  reading the decision ledger, because the ledger is exactly what kept
  lying in v4.72.1. Synthetic probes are excluded from aggregates and
  funnel truth (v7.3 precedent), and leave no residue in real decision
  streams.
- The result surfaces where a human already looks (HUMAN-EXPERIENCE.md):
  /setup readiness and Mission Control posture render an
  enforcement-liveness state — holding / stale / broken — as a tile with
  a click path, never terminal output. "Stale" is a first-class state:
  a probe that has silently stopped running is itself the v4.72.1
  failure shape and must not render as green.
- The known failure is the regression test: the exact v4.72.1 config
  (the overflowed timeout that cancels the hook) seeded on a test
  install must flip the surface to broken within one session.
- Acceptance: probe live on the governing instance; the seeded v4.72.1
  break detected and rendered red; real decision streams and /proof
  aggregates provably unpolluted; docs and the platform guide updated in
  the same ship. Exact probe mechanics (which hook, which cadence, where
  the "did not execute" witness lives) are verified at build time
  against the harness, not assumed here.
- **SHIPPED 2026-07-06 (v4.75.0).** Mechanics as built:
  `hooks/enforcement_liveness_probe.py` runs the installed pretool hook
  under harness-faithful timeout arithmetic (seconds; ×1000 past int32 =
  instant cancel = fail-open) with a synthetic Write to a probe-owned
  `.env` witness path as `smoke-liveness-probe`; exit 2 = held, anything
  else executes the witness. Cadence = SessionStart digest spawns it
  detached at most 1×/12h. Verdicts in `enforcement_liveness_runs` only;
  surfaces: `/setup#enforcement-liveness` + Mission Control posture row
  (holding/stale/broken; stale never green). All acceptance clauses
  proven live 2026-07-06 — evidence in
  `docs/superpowers/specs/2026-07-06-enforcement-liveness-v82.md`.

## v8.3 Entry-path drills: both doors proven on repeat

Three consecutive sweeps found a flagship path broken; each was found by
a one-off manual effort (a hand-built Windows Sandbox run, a post-ship
pass that happened to probe the hosted instance). If a stranger arrives
during the window and a door is broken, v8.1 records a false negative
about the product. The doors get drills: repeatable, one-command,
runnable on a cadence.

- **The owned-instance drill**: factory-fresh machine → `npx dashclaw
  up` → first governed action. The existing Windows Sandbox harness
  (`.wsb`, built for the 0.7.2–0.7.4 fixes) becomes a kept, documented
  instrument rather than a session artifact, and gains a Linux container
  twin so the two OS families the CLI actually targets are both covered.
  macOS has no maintainer-executable equivalent — recorded as a known
  gap, not silently skipped.
- **The hosted drill**: the full stranger path against the live hosted
  instance — mint → key → first action → export workspace → `dashclaw
  import` into a fresh instance — the exact chain v7.2 promised and the
  funnel measures. This is the drill that would have caught the missing
  hosted import route the day it lagged.
- Cadence: both drills run at least once more during the open window and
  before any release that touches their paths (the fresh-machine drill
  joins the preship ritual). A drill failure is a broken ship: fixed on
  the spot, logged in the maintainer log.
- Explicit HUMAN-EXPERIENCE decision: the drills are maintainer
  instruments with no product UI surface — their *findings* ship as
  fixes with surfaces of their own. What is human-visible is the claim
  they protect, which /proof and /setup already render.
- Acceptance: both drills runnable by one command each; a green run of
  each recorded against the live surfaces; one seeded break per drill
  demonstrably caught; the drill commands documented where the release
  ritual lives.
- **SHIPPED 2026-07-06 (v4.76.0).** As built: three one-command drills in
  `scripts/drills/` (fresh-linux, fresh-windows, hosted-stranger) that
  exercise the *distribution* path. Linux drill **green live** and its
  `--as-root` run caught a real fresh-root-VPS break (embedded Postgres
  refuses root; fixed in `rootPostgresOptions`, @dashclaw/cli 0.7.6).
  Hosted drill **6/6 live** against a local hosted-mode build + wrong-token
  seeded break fails closed; the live-hosted run is gated on an operator
  setting `HOSTED_DRILL_TOKEN` (a timing-safe, cohort-excluded, security-
  reviewed Turnstile substitute). Windows Sandbox drill built + staged +
  documented; its factory-fresh cold-boot green run stays part of the
  manual sandbox retest ritual (poorly observable to automate in-session,
  stated honestly rather than claimed). macOS = recorded gap. Evidence:
  `docs/superpowers/specs/2026-07-06-entry-path-drills-v83.md`.

## v8.4 The health floor: the momentum lane gets a target and an exit

Five health ships retired title-holders one at a time (the 1.0/10 stop
hook, the 1,261-line Decision Replay page, the guard hot path every
action flows through). The pattern is proven — pin behavior at the
boundary, decompose verbatim, add the never-pinned tests, drive the
rendered page — but "next-worst file" never terminates. This item sets
the floor, reaches it, and closes the lane.

- Reindex first: the 2026-07-06 code-health index trails six releases of
  decomposition work; the floor is set against fresh numbers, in
  writing, in this item's spec (a minimum per-file score and a hotspot
  cohort average — exact thresholds chosen from the fresh index, not
  assumed here).
- Retire what sits below the floor using the proven pattern; every pass
  behavior-preserving, every pass adding the tests the monolith made
  impossible.
- Wire the v4.73.0 bench harness's `--assert` gates into CI so the guard
  hot-path win (p50 −44%) cannot silently regress — perf is part of the
  floor, not a one-time trophy.
- Acceptance: fresh index shows the floor met, before/after numbers
  cited here; bench gates in CI and demonstrably red on a seeded
  regression; full suite green; the lane declared **closed** in this
  document — after this, health passes happen when the floor is
  breached, not as a standing lane.

## v8.5 The branch (carried from v7.4, unchanged)

Drafted as a branch two eras ago on purpose; still blocked on its
evidence, by design. v8.1's verdict selects exactly one lane; the lane's
own spec is then drafted citing the read.

- **Lane A — activation** (≥1 cohort `firstAction`): the mechanism
  converts attention. Deepen the channel that converted (`bySource`
  names it) with more of what worked, maintainer-executable only; shift
  the open question to the second mile (do activated orgs return? does
  anyone graduate?) which v8.6 measures. If the converting channel is a
  framework or content channel, the guides-expansion decline reverses
  here.
- **Lane B — counter-verdict** (n≥10, zero `firstAction`): friction is
  falsified; the diagnosis is value-prop/positioning — strategy, Wes's
  (§4). The maintainer's deliverable is the evidence pack: full
  per-channel funnel, where arrivals stopped, and testable copy
  hypotheses (README lead, landing hero) the maintainer can run without
  money while Wes decides positioning.
- **Lane C — no verdict fires** (zero `firstAction`, n<10): attention
  itself was insufficient to test anything. The accelerant list goes to
  Wes with the numbers attached (the maintainer's own venues are spent —
  a measured fact), and the maintainer's remaining lever is compounding
  surfaces: /proof and the guides.
- Acceptance: the lane is selected in writing by v8.1's verdict; the
  selected lane's spec exists and cites the read; the unselected lanes
  are struck through here with the reason.

## v8.6 The era-exit read (carried from v7.5, unchanged)

The second mile, measured — the read v7 existed to produce, inherited
with its window intact.

- After a contract-worthy window with v7.2 and v7.3 both live (recorded
  at v7.3 ship: 14 days both-live → earliest read **2026-07-20**), read
  the full chain — mint → firstAction → keyUsed → returned →
  **graduated** — with v8.1's cohort read as the baseline, and write the
  exit verdict that steers v9.
- Acceptance: the exit read exists, cites the graduation annotation and
  the v8.1 baseline, is appended to the maintainer log and linked here;
  v9 drafting cites it — and if the calendar forces v9 to draft early
  again, the read carries unchanged, as it now has twice.

## Gated (needs Wes before any build)

- **FinOps Phase C / CostClaw paid add-on** — RFC 0002 §8 billing
  decision. Money. The prepared analysis exists; nothing builds until the
  explicit go.

## Watch list (revival triggers)

Carried from v7, updated for the era:

- Guard degradation recurrence → revive load-CI wiring + the LLM
  slow-path scenario (partially subsumed if v8.4 lands the bench gates —
  strike when true).
- A consumer surface ships a hook contract → revisit the enforcing-proxy
  KILL (`docs/architecture/enforcement-boundary.md`).
- Hosted multi-tenant future → per-org JWKS issuer binding.
- More than one human governs an org → team/RBAC.
- A retained stranger exists (v8.6 reads one) → retention levers leave
  the declined list.
- v8.5 Lane A names a framework/content channel → guides expansion
  leaves the declined list.
- Next semver major → `dashclaw/legacy` subpath removal rides it
  (deprecation plan in `docs/sdk-parity.md`).
- Google OAuth on the hosted instance (the A2 flip) — Wes's credentials,
  an accelerant, never a gate (charter, 2026-07-05).
- awesome-mcp-servers PR #9313 merges → note it in the ledger; a listing
  going live mid-window is a channel moving and belongs in v8.1's
  per-channel read.
- Any Wes accelerant lands (plugin directory, awesome-claude-code,
  Connectors) → ledger entry + tagged links so v6.4 attribution catches
  it.

## v8 order rationale

v8.2 first: an enforcement hole is the one failure class that falsifies
the product's entire claim while every dashboard smiles — it happened
this week, it was caught by a human question, and no instrument watches
for its recurrence. v8.3 second: the window's arrivals land on the
doors, and the doors have broken three sweeps running; drills protect
the read's integrity directly. v8.4 interleaves — it is the existing
momentum lane and its passes are independently shippable — but its
*exit* waits until the floor is met. v8.1 and v8.6 fire on the calendar,
not on effort. v8.5 cannot precede its evidence — the era's inherited
honesty about being drafted early, twice now. Order changes only with a
written reason in the commit (v1 rule, kept).

## Standing chores (no status; every session touches them as needed)

- Registry truth: `npm view` the four packages vs manifests when releasing.
- **A GitHub Release rides every ship** (v6.1 rule).
- Dependabot: keep at zero open alerts; per-lockfile fixes.
- Corpus: add vectors per MAINTAINER.md protocol as incidents occur.
- Keep `/explain`, README, and docs truthful when any of the above ships.

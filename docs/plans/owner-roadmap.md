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
[`archive/owner-roadmap-v6.md`](archive/owner-roadmap-v6.md).

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

Drafting evidence (2026-07-05, this session):

- **Reach is spent.** The distribution ledger
  (`docs/DISTRIBUTION-LISTINGS.md`) shows every PR-able or
  credential-free venue done or explicitly declined; all four remaining
  venues are Wes-account accelerants (charter: accelerants, never gates).
  awesome-mcp-servers PR #9313 waits only on a human maintainer's merge.
  "More reach" is no longer a lane the maintainer can execute alone.
- **The window is open and empty, correctly.** The prebuilt read
  instrument (`node scripts/measurement-read.mjs`) ran live today in
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

Alternatives weighed and declined this round:

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

**Status ledger v7** (update in place):

| # | Item | Status |
|---|------|--------|
| v7.1 | The measurement read (carried from v6.5, unchanged) | TIME-GATED — runs on/after 2026-07-19; instrument prebuilt (`node scripts/measurement-read.mjs`), arithmetic unit-tested, open loop carries the date |
| v7.2 | The graduation path: the cap becomes a door | — |
| v7.3 | The self-governance proof surface | — |
| v7.4 | The branch: what the read steers | BLOCKED on v7.1 (by design — drafted as a branch, chosen by evidence) |
| v7.5 | The era-exit read: the second mile measured | LAST — needs v7.2/v7.3 live for a window, and v7.1's cohort read as baseline |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) |

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
  are struck through here with the reason.

## v7.5 The era-exit read: the second mile measured

The era exists to produce this the way v5 produced the verdict and v6
produced the cohort read.

- After v7.2 and v7.3 have been live for a contract-worthy window (set
  and recorded at v7.2/v7.3 ship time, not asserted here), read the full
  chain — mint → firstAction → keyUsed → returned → **graduated** — with
  v7.1's cohort read as the baseline, and write the exit verdict that
  steers v8.
- Acceptance: the exit read exists, cites the graduation annotation and
  the v7.1 baseline, is appended to the maintainer log and linked here;
  v8 drafting cites it.

## Gated (needs Wes before any build)

- **FinOps Phase C / CostClaw paid add-on** — RFC 0002 §8 billing
  decision. Money. The prepared analysis exists; nothing builds until the
  explicit go.

## Watch list (revival triggers)

Carried from v6, updated for the era:

- Guard degradation recurrence → revive load-CI wiring + the LLM
  slow-path scenario.
- A consumer surface ships a hook contract → revisit the enforcing-proxy
  KILL (`docs/architecture/enforcement-boundary.md`).
- Hosted multi-tenant future → per-org JWKS issuer binding.
- More than one human governs an org → team/RBAC.
- A retained stranger exists (v7.5 reads one) → retention levers leave
  the declined list.
- Next semver major → `dashclaw/legacy` subpath removal rides it
  (deprecation plan in `docs/sdk-parity.md`).
- Google OAuth on the hosted instance (the A2 flip) — Wes's credentials,
  an accelerant, never a gate (charter, 2026-07-05).
- awesome-mcp-servers PR #9313 merges → note it in the ledger; a listing
  going live mid-window is a channel moving and belongs in v7.1's
  per-channel read.
- Any Wes accelerant lands (plugin directory, awesome-claude-code,
  Connectors) → ledger entry + tagged links so v6.4 attribution catches
  it.

## v7 order rationale

v7.2 and v7.3 first and in parallel-friendly order: both are worth
building under any read outcome, both fill the gated window with the
funnel's next wall and the product's strongest proof, and neither
consumes the other's surface. v7.1 fires on the calendar, not on effort.
v7.4 cannot precede its evidence — that is the era's honesty about being
drafted early. v7.5 last: the era exists to produce that read. Order
changes only with a written reason in the commit (v1 rule, kept).

## Standing chores (no status; every session touches them as needed)

- Registry truth: `npm view` the four packages vs manifests when releasing.
- **A GitHub Release rides every ship** (v6.1 rule).
- Dependabot: keep at zero open alerts; per-lockfile fixes.
- Corpus: add vectors per MAINTAINER.md protocol as incidents occur.
- Keep `/explain`, README, and docs truthful when any of the above ships.

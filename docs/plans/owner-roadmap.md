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
[`archive/owner-roadmap-v5.md`](archive/owner-roadmap-v5.md).

## Roadmap v6 — the reach era: the product finds its strangers (drafted 2026-07-05)

v5 fixed the first mile and exited with the reach-readiness verdict
([`../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md`](../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md)):
**READY** — reach is no longer blocked by the product. The same day, Wes
retired the last assumption that reach waits on him (*"this is your
project, not mine … nothing should be waiting on me or the first reach
act, it's all on you"*), codified in MAINTAINER.md's outward-acts clause
(commit `b64a8eb2`). So v6 is reach **executed by the maintainer**: make
DashClaw findable through every channel the project's own credentials can
operate, attribute what arrives, and read the funnel the verdict's way.

Drafting evidence (2026-07-05, this session):

- **The verdict (v5.5)**: mechanism, instrument, and window bars all met;
  the measurement contract is written (14-day cohort, ≥1 stranger
  firstAction; counter-verdict at n≥10 with zero → value-prop, not
  friction).
- **The repo recon**: GitHub Releases frozen at v4.20.1 (2026-06-12) while
  the platform is at 4.59.0 — to an evaluating stranger the public repo
  has looked dormant for 23 days spanning the project's fastest era; git
  tags stopped at v2.1.0. The repo is the one outward surface already in
  daily use, and its front door is stale.
- **Registry absence**: the MCP server ships on npm but is listed in no
  MCP registry or directory; the Claude Code plugin exists only inside
  this repo. In the places agent builders actually search, DashClaw does
  not appear. (Venue mechanics verified at build time, not assumed here.)
  *Correction at v6.2 build time (2026-07-05): this was wrong — the
  official MCP registry has listed `io.github.ucsandman/dashclaw` since
  2026-06-11 (current at 2.0.1) and PulseMCP auto-ingested it. The
  drafting recon asserted absence without querying the registry API. The
  maintainer log entry for v6.2 records the miss.*
- **The funnel (truthful, post-cleanup)**: 4 mints / 0 key used / 0 first
  action — all predating the v5 fixes. And an attribution blind spot: a
  mint carries no source, so even a successful reach act could not be told
  apart from organic arrival. v6.4 closes this before channels multiply.

Standing honesty rules (from the charter amendment, apply to every item):
every outward artifact identifies its author as an AI maintainer — never a
pretended human; every claim obeys claims-proven-live; no astroturf; no
paid placement (billing is §4).

Alternatives weighed and declined this round:

- **Wes-account channels as roadmap items** (Reddit/HN/X posts) — his
  credentials, so §4 keeps them his; weekly digests stay drafted and
  pasteable, and nothing in v6 waits on them.
- **More product before anyone sees it** — the funnel says the constraint
  is attention, not features. Team/RBAC and the TypeScript migration stay
  declined (fourth consecutive round; triggers unchanged).
- **Paid reach** — §4 (billing) and untried free channels; declined until
  free channels have a measured read.

**Status ledger v6** (update in place):

| # | Item | Status |
|---|------|--------|
| v6.1 | The repo speaks: releases resumed, front door truthful | SHIPPED 2026-07-05 — releases resumed ([v4.59.0 catch-up release](https://github.com/ucsandman/DashClaw/releases/tag/v4.59.0) live; per-ship release rule in the ship protocol); README stranger-walk done (hosted trial first-actionable, AI-maintainership visible; recorded in the maintainer log); metadata truth pass: verified accurate, no churn |
| v6.2 | Registry presence: MCP registry + plugin/directory listings | SHIPPED 2026-07-05 — official registry verified live+current at 2.0.1 (predated v6: published 2026-06-11, the drafting recon missed it); PulseMCP auto-listed; [awesome-mcp-servers PR #9313](https://github.com/punkpeye/awesome-mcp-servers/pull/9313) submitted; `glama.json` added; full ledger incl. 8 declined venues + 4 Wes accelerants in `docs/DISTRIBUTION-LISTINGS.md` |
| v6.3 | Organic search surface: marketing SEO truth pass | — |
| v6.4 | Reach attribution: mint source capture, per-channel funnel | — |
| v6.5 | The measurement read: the verdict's contract, applied | — |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) |

## v6.1 The repo speaks

The public repo is the one outward surface already operating daily, and it
currently testifies against the project (last release June 12).

- Resume tags + GitHub Releases: a catch-up release at v4.59.0 whose notes
  say plainly that release publishing paused between v4.21 and v4.58 (the
  CHANGELOG carries the per-version detail), then **one release per ship**
  — appended to the ship protocol so it cannot silently stop again.
- README first screen, re-read as a stranger: the hosted trial should be
  the first actionable thing, and the project's most distinctive true fact
  — an AI maintains this in public, log and all — should be visible, not
  buried.
- Repo metadata truth pass (description, topics, homepage): verify, fix
  only what's wrong, no churn.
- Acceptance: v4.59.0 release live; ship protocol updated; README
  stranger-walk recorded with what changed and why.

## v6.2 Registry presence

Be findable where agent builders actually look, with submissions the
project's own GitHub credentials can make.

- Publish the MCP server to the official MCP registry and the PR-able
  community directories; list the Claude Code plugin where plugins are
  discovered. Verify each venue's mechanics at build time; some will turn
  out to require human accounts — decline those explicitly rather than
  fake a human.
- Every submission is recorded in the maintainer log with a link; copy is
  claims-proven-live; authorship is honest (AI maintainer).
- Acceptance: at least one official registry listing live and verified;
  a recorded submissions ledger including declined venues and why.

## v6.3 Organic search surface

The marketing site as a landing surface for strangers who search.

- SEO truth pass on the marketing pages: metadata, Open Graph, sitemap,
  robots, structured data; guides render as self-contained landing pages;
  `.impeccable.md` bar holds; zero fabricated claims.
- Acceptance: crawl-clean (no broken or accidentally-blocked pages),
  rendered proof, and an explicit measured bar (set and recorded at build
  time, not asserted here).

## v6.4 Reach attribution

Close the funnel's source blind spot before channels multiply.

- Mint-time source capture: referrer/UTM at org grain — one write at mint,
  no analytics platform, nothing beyond the referrer/UTM strings.
  Snapshot-frozen like the rest of funnel truth (drizzle migration extends
  `hosted_trial_snapshots`).
- Funnel renders per-source mints as an annotation (truthful zeros
  included); the measurement contract gains channel resolution.
- Acceptance: a mint from a tagged link shows its source in the funnel
  route and the /setup card; smoke pins it; maintainer runs stay excluded
  by the existing protocol.

## v6.5 The measurement read

The era's exit instrument, per the verdict's own contract.

- After v6.1–v6.3 have been live for the contract's window, run the
  14-day cohort read and write the next verdict: activation (the mechanism
  converts attention) or value-prop (the counter-verdict; positioning is
  strategy and the evidence goes to Wes).
- Acceptance: the read exists, cites per-channel numbers from v6.4,
  applies the v5.5 contract arithmetic unchanged, and is appended to the
  maintainer log and linked here; v7 drafting cites it.

## Gated (needs Wes before any build)

- **FinOps Phase C / CostClaw paid add-on** — RFC 0002 §8 billing
  decision. Money. The prepared analysis exists; nothing builds until the
  explicit go.

## Watch list (revival triggers)

Carried from v5, updated for the era:

- Guard degradation recurrence → revive load-CI wiring + the LLM
  slow-path scenario.
- A consumer surface ships a hook contract → revisit the enforcing-proxy
  KILL (`docs/architecture/enforcement-boundary.md`).
- Hosted multi-tenant future → per-org JWKS issuer binding.
- More than one human governs an org → team/RBAC.
- Next semver major → `dashclaw/legacy` subpath removal rides it
  (deprecation plan in `docs/sdk-parity.md`).
- Google OAuth on the hosted instance (the A2 flip) — Wes's credentials,
  an accelerant, never a gate (charter, 2026-07-05).
- A reach channel produces mints before v6.4 ships → pull v6.4 forward
  (unattributed arrivals waste the read).

## v6 order rationale

v6.1 first: cheapest, highest-credibility fix, and every later venue links
back to the repo — a stale front door poisons all of them. v6.4 second in
spirit (pulled forward on the watch-list trigger if any channel moves):
attribution must exist before arrivals do. v6.2 and v6.3 are the channels
themselves and can proceed in either order. v6.5 last: the era exists to
produce that read, the way v5 existed to produce the verdict. Order
changes only with a written reason in the commit (v1 rule, kept).

## Standing chores (no status; every session touches them as needed)

- Registry truth: `npm view` the four packages vs manifests when releasing.
- **A GitHub Release rides every ship** (v6.1 rule, once shipped).
- Dependabot: keep at zero open alerts; per-lockfile fixes.
- Corpus: add vectors per MAINTAINER.md protocol as incidents occur.
- Keep `/explain`, README, and docs truthful when any of the above ships.

# Owner roadmap ARCHIVE — Roadmap v6 (closed into v7)

Frozen 2026-07-05. Every buildable item (v6.1–v6.4) shipped the same day
the era was drafted; the one remaining item, v6.5 (the measurement read),
is time-gated by its own contract to on/after 2026-07-19. The owner
directed v7 drafting before the read ("let's move on to v7 now"), so v6.5
carries **unchanged** into v7.1 — same contract, same date, same prebuilt
instrument. The living roadmap is
[`docs/plans/owner-roadmap.md`](../owner-roadmap.md); v1–v3 live at
[`owner-roadmap-v1-v3.md`](owner-roadmap-v1-v3.md); v4 at
[`owner-roadmap-v4.md`](owner-roadmap-v4.md); v5 at
[`owner-roadmap-v5.md`](owner-roadmap-v5.md).

## Roadmap v6 — the reach era: the product finds its strangers (drafted 2026-07-05)

v5 fixed the first mile and exited with the reach-readiness verdict
([`../../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md`](../../superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md)):
**READY** — reach is no longer blocked by the product. The same day, Wes
retired the last assumption that reach waits on him (*"this is your
project, not mine … nothing should be waiting on me or the first reach
act, it's all on you"*), codified in MAINTAINER.md's outward-acts clause
(commit `b64a8eb2`). So v6 is reach **executed by the maintainer**: make
DashClaw findable through every channel the project's own credentials can
operate, attribute what arrives, and read the funnel the verdict's way.

Drafting evidence (2026-07-05, drafting session):

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

**Status ledger v6** (final):

| # | Item | Status |
|---|------|--------|
| v6.1 | The repo speaks: releases resumed, front door truthful | SHIPPED 2026-07-05 — releases resumed ([v4.59.0 catch-up release](https://github.com/ucsandman/DashClaw/releases/tag/v4.59.0) live; per-ship release rule in the ship protocol); README stranger-walk done (hosted trial first-actionable, AI-maintainership visible; recorded in the maintainer log); metadata truth pass: verified accurate, no churn |
| v6.2 | Registry presence: MCP registry + plugin/directory listings | SHIPPED 2026-07-05 — official registry verified live+current at 2.0.1 (predated v6: published 2026-06-11, the drafting recon missed it); PulseMCP auto-listed; [awesome-mcp-servers PR #9313](https://github.com/punkpeye/awesome-mcp-servers/pull/9313) submitted; `glama.json` added; full ledger incl. 8 declined venues + 4 Wes accelerants in `docs/DISTRIBUTION-LISTINGS.md`. Post-freeze: Glama scan landed License A · Quality A · Maintenance A; #9313 waits only on a human maintainer's merge |
| v6.3 | Organic search surface: marketing SEO truth pass | SHIPPED 2026-07-05 (v4.60.1) — host-aware robots.txt + 18-URL sitemap (marketing host only; every other host `Disallow: /`), canonical+OG on all 17 marketing pages, JSON-LD with git-derived dates; claims audit found copy sound (one Hermes count reworded); crawl-clean proven (all sitemap URLs 200, per-host curl proof); outcome bar rides v6.4 `bySource` into the measurement read; spec `docs/superpowers/specs/2026-07-05-seo-truth-pass-v63.md` |
| v6.4 | Reach attribution: mint source capture, per-channel funnel | SHIPPED 2026-07-05 (v4.60.0) — pulled forward per the watch-list trigger (channels moved the same day). Referrer/UTM captured at mint (org grain, drizzle/0054, snapshot-frozen), funnel + /setup render `bySource` with truthful zeros; live-proven end to end incl. the deletion freeze; spec `docs/superpowers/specs/2026-07-05-reach-attribution-v64.md` |
| v6.5 | The measurement read: the verdict's contract, applied | CARRIED INTO v7.1 unchanged (owner direction, 2026-07-05) — TIME-GATED to on/after 2026-07-19; read instrument prebuilt (`node scripts/measurement-read.mjs`, contract arithmetic unit-tested, proven live in preview) |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) — carried into v7 |

## v6 order rationale (as drafted)

v6.1 first: cheapest, highest-credibility fix, and every later venue links
back to the repo — a stale front door poisons all of them. v6.4 second in
spirit (pulled forward on the watch-list trigger if any channel moves):
attribution must exist before arrivals do. v6.2 and v6.3 are the channels
themselves and can proceed in either order. v6.5 last: the era exists to
produce that read, the way v5 existed to produce the verdict. Order
changes only with a written reason in the commit (v1 rule, kept).

*(Per-item build detail lived in the living document while the era ran;
the item specs are preserved in git history at commit `fc82f967` and the
per-ship detail in the maintainer log and CHANGELOG.)*

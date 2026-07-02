---
name: dashclaw-weekly
description: Compile the week's maintainer-log entries + git history into ONE pasteable Reddit-ready DashClaw update. Drafts only — publishing stays human (MAINTAINER.md §4 spirit). Use when Wes asks for the weekly update, a Reddit digest, or "what happened this week".
---

# DashClaw weekly digest

Turn the maintainer's log into a public weekly update Wes can paste to
Reddit unmodified. The story is the experiment: an AI maintains this repo
under a human-held constitution (`MAINTAINER.md`), and these are its
receipts.

## Gather (in order)

1. **Cursor**: find the last `<!-- digest-posted: YYYY-MM-DD -->` marker in
   `docs/maintainer-log.md`. Cover everything after it. No marker → last 7
   days. An explicit range in the user's args overrides both.
2. **Log entries**: read the covered entries in `docs/maintainer-log.md` —
   they are the primary source (decisions, incidents, numbers).
3. **Commits**: `git log --oneline --no-merges --since=<cursor>` on main —
   cross-check nothing shipped unlogged. If something did, say so in the
   digest (the gap is itself content) and append a catch-up log entry.
4. **Dogfood stats (best-effort, skip silently if unavailable)**: with a
   local instance running and `DASHCLAW_API_KEY` in `.env.local`, GET
   `/api/policies/summary` (30-day decision outcome counts — label the
   window honestly) and `/api/policies/proposals` (open tuning proposals).
   These are the "the product governs its own maintainer" numbers.

## Compose

One fenced code block, ready to paste. **No hard wraps** — one line per
paragraph, blank lines between (Wes's standing formatting rule for copyable
text). Plain language; define DashClaw terms on first use; no internal
codenames, file paths only when they're the point.

Sections, in order, dropping any that are empty this week:

- **Title**: `DashClaw maintainer update — week of <date>` (+ version if one shipped)
- **TL;DR**: 2-3 sentences.
- **Shipped**: what landed, with version + one-line why-it-matters each.
- **Decisions**: the why behind non-obvious calls, from the log.
- **Incident of the week**: the most instructive failure, told straight —
  these are the credibility of the whole series. Never omit one that's in
  the log.
- **The AI is governed by the product**: dogfood stats when available.
- **Next up**: the next roadmap item, one line.
- **Links**: repo, `MAINTAINER.md`, `docs/plans/owner-roadmap.md`,
  `docs/maintainer-log.md`.

## Hard rules

- **Draft only.** Never post, never call outbound services. Deliver the
  block in chat; Wes publishes.
- **Log is source of truth** — do not soften incidents or inflate numbers;
  every figure must trace to the log, git, or a live API response.
- After Wes confirms he posted it, append
  `<!-- digest-posted: YYYY-MM-DD -->` on its own line at the TOP of the
  entries section of `docs/maintainer-log.md` (above the newest covered
  entry) so the next run starts after it. Not before confirmation.

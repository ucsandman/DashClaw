# HUMAN-EXPERIENCE.md — the human experience contract

Adopted 2026-07-02 by Wes's direction. This document governs the **human
experience of everything DashClaw ships**. It exists because the maintainer
is an AI with a systematic bias: it builds for what it knows — code,
terminals, JSON, GitHub — and forgets that the people operating DashClaw are
**visual humans** who need buttons, toggles, and surfaces they can read at a
glance. This file is the standing correction.

**The founding incident (v4.33.0, calibration flywheel):** the feature
worked, the data was right, the automation was elegant — and the human's
role required opening a GitHub Actions run, copying a shell command out of a
table, and pasting it into a terminal. The operator's verdict: *"I do not
want to go into GitHub and copy a command and run it in a terminal."* That
ship was incomplete. Every future ship is measured against this contract so
it never happens again.

## The axiom

DashClaw has two kinds of consumers:

- **Agents and automation** consume APIs, MCP tools, CLIs, hooks. Text and
  JSON are their native habitat.
- **Humans** consume pages. They judge in seconds, by sight. Their native
  habitat is a rendered surface with visual hierarchy: a posture chip, a
  count that's red, a button that says what it does.

Every capability serves both, and **the human surface is never the optional
one**. When only one interface gets built first, it is the human one.

## The contract — every ship answers all six

1. **Understandable at first glance.** Every shipped capability is
   explained where a human will actually see it: a page in the DashClaw
   instance for operational features, the marketing site for positioning.
   The first-glance test: a capable stranger looking at the surface for
   ten seconds can say what it does and why it matters. If understanding
   it requires reading a spec, a README section, or a workflow file, it
   fails.

2. **Operable by click, not by command.** Wherever the human's role in a
   loop is judgment — review, approve, deny, ratify, tune, dismiss — that
   judgment is exercised through a **button, toggle, or form in the
   product**. "Copy this command," "open GitHub," "edit this file," or
   "run this script" is never the primary human path. The existing golden
   patterns are the model: Approvals resolve in Mission Control with one
   click; policy-tuning proposals accept/dismiss in the /policies review
   feed. New judgment loops follow them.

3. **Terminals are for agents; the zero-terminal test.** CLI, API, MCP,
   and CI surfaces are legitimate **secondary** interfaces for agents,
   automation, and developers wiring integrations. The test at ship time:
   walk the entire human role for the feature end to end and count the
   terminal commands and GitHub visits required. **The count must be
   zero.** (Development acts — committing code, publishing SDKs, rotating
   credentials — are outside this test; they are the maintainer's or
   Wes's constitutional acts, not product workflows.)

4. **The marketing site ships with the feature.** As the project grows,
   the marketing surfaces (`app/page.tsx`, `/self-host`, `/connect`,
   `/downloads`, `/guides`, the docs page) must grow with it — in the
   **same ship**, not a later sweep. A capability absent from pages that
   claim completeness is a false claim. And these pages are held to the
   highest visual bar in the product: visually stunning, instantly
   legible, per `.impeccable.md` (evidence over decoration; orange as
   signal; the four anti-references).

5. **API-only is a decision, never a default.** A capability may
   legitimately have no operational UI (pure SDK plumbing, an internal
   contract). That is an **explicit recorded decision in the spec with a
   reason** — and even then, the capability's *existence and purpose* must
   still be visible to humans somewhere (docs page, marketing, /setup).
   Silent API-only ships are the failure mode this file exists to kill.

6. **Rendered proof, not asserted proof.** Before a feature is called
   done, drive the actual page (frontend-verify / headless browser) and
   confirm the new surface renders with real data and the judgment
   controls work. Unit tests prove data exists; only a rendered page
   proves a human can see and use it.

## The design bar

`.impeccable.md` is canonical for how these surfaces look and speak: serious
· precise · trustworthy; dark instrument-panel canvas; brand orange only as
signal; CSS tokens, never hardcoded hex; lucide-react icons; WCAG 2.1 AA
floor; and the four anti-references (generic SaaS, consumer AI, heavy
enterprise, crypto/web3) as the guardrail. "Visually stunning" here means
the restrained developer-brand register done exceptionally well — Linear,
Vercel, Grafana — not decoration.

## Known debt under this contract

Retroactive audit, oldest first. Each item gets a roadmap entry and dies.
The full era audit (v4.22.0–v4.33.0, run 2026-07-02 at Wes's direction)
lives in `docs/plans/2026-07-02-human-experience-retro-audit.md` — five
surgical gaps were fixed in that audit's own commit; these remain:

- **Calibration proposals (v4.33.0):** review + ratification currently
  lives in a GitHub Actions summary with copy-paste forge commands. Needs
  an in-product surface: proposals rendered as cards with evidence, ratify
  /dismiss as buttons (roadmap v2.6b). The mechanical fixture commit stays
  with the maintainer; the *judgment* becomes a click.
- **x402 budget consumption (v4.23.0):** the window budget is enforced and
  now described on /policies, but "spent $X of $Y this window" renders
  nowhere — the state guard computes is invisible until a purchase blocks
  (roadmap v2.6c).
- **Marketing & docs backfill (whole era):** the /self-host completeness
  grid and rendered landing page carry none of the era's 10 capabilities;
  /docs is missing tuning proposals, budget tiers, degradation
  observability, risk_breakdown, and the new identity system (roadmap
  v2.6d).
- (Add future findings here; an empty list is the goal, not the norm.)

## Relationship to other rule carriers

- `CLAUDE.md` "Definition of done includes a human-visible surface" is the
  build-time twin of clauses 1–2 and now also requires **operability**.
- The `dashclaw-ship` skill's UI-discoverability gate enforces this
  contract at ship time.
- `MAINTAINER.md` binds the maintainer to this file in its operating
  protocol; amendments to *this* file follow the same rule as the charter —
  Wes's explicit direction.

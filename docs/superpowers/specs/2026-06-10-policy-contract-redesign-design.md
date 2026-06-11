# Policy Contract Redesign — Design Spec

**Date:** 2026-06-10
**Status:** Approved (brainstorm with Wes, 2026-06-10)
**Problem:** The `claude-code` policy mode fires `require_approval` so often (~every 10s during normal Claude Code work) that the owner disables all policies. The /policies page redesign and the approval-fatigue mechanics must ship together: the page is where friction is seen and tuned; the mechanics make tuning possible.

## Decisions made during brainstorm

1. **Scope:** Full fix — noise-reduction mechanics + page redesign (not page-only).
2. **Interruption contract:** "Only money and destruction" — hard interrupts only for spend over an editable threshold, destructive/irreversible ops, and secrets/auth path edits. Everything else is recorded as `warn` and reviewed in a digest. Zero ambient prompts.
3. **Review loop:** The digest lives on /policies. Reviewing the feed IS the tuning UI (verdicts create/remove rules).
4. **Layout:** Concept 3 — "Contract" page. Top: interruption contract as editable plain-English sentences with live fire-counts. Bottom: full-width review feed.
5. The shipped `claude-code` mode defaults change in the catalog itself (its label already promises "LOW interruption"); no ninth mode.

## Target layout (concept sketch)

```
┌─ POLICIES ──────────────────────────────────────────────┐
│ YOUR INTERRUPTION CONTRACT          mode: claude-code ▾ │
│                                                         │
│  Interrupt me only when:                                │
│   · spend exceeds [$5.00 ▾]          fired 1× this wk  │
│   · action is destructive (drop,                       │
│     force-push, prod deploy)         fired 0×          │
│   · secrets or auth files change     fired 1×          │
│                                                         │
│  Everything else is recorded silently below.            │
│  Friction this week: 2 interrupts · ~40s of your time   │
├─────────────────────────────────────────────────────────┤
│ TO REVIEW · 28 recorded since Jun 8                     │
│ ▸ 23× api calls → stripe.com       [fine][always][⚠↑]  │
│ ▸ 4× edits under sdk/              [fine][always][⚠↑]  │
│ ▸ 1× burst: 312 actions / 30min    [fine][always][⚠↑]  │
└─────────────────────────────────────────────────────────┘
```

## §1 — Mode defaults (catalog fix)

Recompile the `claude-code` mode in `app/lib/policy-modes/catalog.ts` / `compile.ts`:

| Tier | Current | New |
|---|---|---|
| require_approval | api, sync, message, post, email, calendar, deploy, migrate, destructive, protected paths, spend ≥ $0.01 | destructive ops (`delete`, `reset`, `destroy`, `drop`), deploy/migrate, secrets/auth protected paths, spend ≥ **$5.00** (editable param), runaway loop (650 actions/60min — kept: a runaway loop is a money problem) |
| warn (silent, recorded) | risk ≥ 85, burst 250/30min | demoted types (`api`, `sync`, `message`, `post`, `email`, `calendar`) + risk ≥ 85 + burst 250/30min |
| block | risk 100, spend > $0.10 | risk 100, spend > **$25.00** (editable param) |

Other modes untouched.

## §2 — Grants ("always allow")

- New policy type `allow_grant` with a shape matcher `(action_type, target)`:
  - `target` = host for api-like actions, path-prefix for file edits.
- **Precedence:** a matching grant downgrades `warn` and `require_approval` to `allow`; it can **never override `block`**.
- Grants render in the contract as removable "Never bother me about: api → stripe.com ✕" lines.
- Feed verdicts:
  - `[fine]` — marks the group reviewed (review state only; no policy change).
  - `[always allow]` — creates an `allow_grant` for the shape.
  - `[⚠ tighten]` — creates a `require_approval` rule for the shape.

## §3 — Review feed mechanics

- Groups warn-decisions since a per-org `last_reviewed_at` cursor, using the same shape function grants use.
- Each group: count, shape label, sample action, three verdicts.
- "Mark all reviewed" advances the cursor.
- Below warn groups: "Interrupted you (N)" — recent approvals/denials, so interrupts can be audited for worth.

## §4 — Contract renderer

- Sentences are **data-driven from the catalog**: each policy a mode compiles carries a sentence template + editable params. No reverse-engineering of arbitrary rules.
- Threshold edits (spend approval/block) write back via `PATCH /api/policies/:id` and invalidate the guard policy cache.
- Custom rules not born from a mode render as a collapsed "+ N custom rules ▾" list using existing rule labels.
- Fire-counts per sentence = guard decisions matching that policy in the last 7 days.
- Friction line = interrupt count × ~20s.

## §5 — Page composition

`PolicyCockpit` rebuilds into two stacked panels:

- **ContractPanel** — contract sentences, grants list, mode switcher (keeps existing `ModeDrawer` + friction preview), "Add protection ▾" collapsed section replacing the `ShieldList` toggle grid (active shields render as contract sentences).
- **ReviewFeed** — full width, as in §3.

Retired/absorbed: `PostureHeader`, `EnforcementSummary`, `RecentDigest`, `ShieldList` (as a grid).

Design rules (.impeccable.md): tokens only, brand orange only on "needs you" cues, tabular nums on counts, WCAG 2.1 AA, calm under pressure.

## §6 — API surface

Repository pattern; no direct SQL in routes.

- `GET /api/policies/contract` — sentences + params + fire-counts + grants.
- `GET /api/policies/review` — grouped warns since cursor + recent interrupts.
- `POST /api/policies/review/verdict` — `{ shape, verdict: 'fine' | 'always_allow' | 'tighten' }`.
- `PATCH /api/policies/:id` — threshold edits (reuse if present, else add).
- Demo-mode handlers for all new endpoints (middleware demo dispatch requirement).

## §7 — Out of scope (deliberate)

- Approval dedupe/cooldown (the new posture makes interrupts rare enough).
- Trust-ramp learning (brainstorm concept C — later).
- Push digests (terminal/Discord end-of-session summaries — later).
- Approval batching.

## §8 — Testing

- Compile-snapshot tests for new `claude-code` mode defaults.
- Guard unit tests for grant precedence, including grant-never-beats-block.
- Shape/grouping function tests.
- Route tests for the new endpoints.
- Page render tests per repo vitest conventions.
- Gates before ship: full `npx vitest run`, `npm run lint`, `npx next build`, `npm run typecheck`, doc-count gates (claude-code mode rule count changes will show up in cited counts).

# June-deferral triage (owner roadmap item 6)

**Date:** 2026-07-02 · **Status:** APPROVED (maintainer, per MAINTAINER.md mandate)
**Source list:** `.supergoal-archive-2026-06-10-sweep/related-findings-ledger.md`
§"P20 candidates — deliberately DEFERRED". Each parked item gets a verdict —
kill with a written reason, or build — per the roadmap item's charter.

## Verdicts

### 1. `/workflows` Runs tab — KILL (with a discoverability link)

The org-wide runs view already exists: workflow executions are
`action_records` with `action_type='workflow_execute'`, and the decisions
ledger supports a URL-persisted `?action_type=` filter — so
`/decisions?action_type=workflow_execute` *is* the org-wide, deep-linkable
runs view. Per-template run history shipped long ago on the template detail
page. A third parallel runs surface would duplicate the ledger — the exact
"parallel structure" the governance-boundary rules prohibit. **One line of
build in the kill's spirit:** a "View all runs in the decisions ledger →"
link on `/workflows`, so the existing capability is discoverable instead of
tribal knowledge.

### 2. docs evaluations page — BUILD (S)

The evaluation framework's only onboarding is the in-page 3-step explainer;
`/docs#evaluation-framework` is SDK-signature reference with no concept
walkthrough. Verdict: add the concept walkthrough (scorers → runs → scores →
distributions) to the existing `/docs` section and link it from the
`/evaluations` empty states ("Learn more"). Content task, no new route, no
count changes.

### 3. Mission Control LiveStream cadence port — KILL

The live/batch/pause cadence + buffer pattern exists to make a *flooding SSE
stream* readable (`/activity`'s subscriber receives sub-second events).
Mission Control's feed is a **30-second poll**
(`useMissionData.ts` → `/api/operations/feed` on a `setInterval`) — it is
already batched by design; there is no flood to pause, and a pause control on
a 30s poll is dead UI. If Mission Control ever moves to the SSE subscriber,
port the cadence then — the pattern is documented in `/activity` and this
verdict does not bar it.

### 4. `/api/guard` `days` param — BUILD (S)

Mirrors the `days` param `GET /api/actions` already has. `?days=N` windows
the list WHERE and the `total` count (`created_at > NOW() - INTERVAL '1 day'
* N`, N clamped to 1–90), so `?decision=block&days=7` returns the **true**
weekly denied count via `total` — today `/activity` derives weekly denial
counts from a 200-row capped, un-windowed buffer, which undercounts busy
weeks. Consumer wiring: `/activity` passes `days=7` on its guard fetch. The
hardcoded 24h stats block (`total_24h` etc.) keeps its name and semantics —
it is honest as labeled; the windowed truth rides `total`.

### 5. Agent-picker URL persistence — BUILD (S, minimal design)

The June ledger sized this as "session-state→URL migration across every
consuming page" (L) — but the picker has a **single source of truth**
(`AgentFilterContext`), so syncing at the context is sufficient and touches
one file: read `?agent=` from `window.location` at mount, write it via
`window.history.replaceState` on change. No `useSearchParams` — that dodges
the Next 16 Suspense-boundary trap entirely and requires zero per-page
changes. Param name is `agent` (not `agent_id`) to avoid colliding with
pages that already own a page-local `agent_id` param (e.g. `/decisions`
shared links). Explicit non-goal: per-page filter params stay page-owned.

## Acceptance

- Guard `days`: unit test on the repository options (window clamps, WHERE
  composition) if the existing route/repo tests cover the pattern; policy
  smoke check — `GET /api/guard?days=1&decision=block` returns 200 and
  `total` ≤ the un-windowed total (J-block).
- Docs + links: rendered proof — `/docs#evaluation-framework` shows the
  walkthrough; `/evaluations` empty state links to it; `/workflows` shows
  the ledger link.
- Picker: rendered proof — select an agent, URL gains `?agent=<id>`, hard
  reload restores the selection, removing the param restores "All Agents".
- Kills: recorded here + maintainer log; roadmap ledger updated.
- Gates: lint, typecheck, FULL vitest, next build, contract checks; docs
  updated in the same commit (`app/docs` GET /api/guard params list).

## Non-goals

- No org-wide workflow-runs API or tab (kill #1).
- No cadence machinery in Mission Control (kill #3).
- No renaming of the guard stats `*_24h` keys; no `days` on the stats block.
- No per-page adoption of the global `agent` param.

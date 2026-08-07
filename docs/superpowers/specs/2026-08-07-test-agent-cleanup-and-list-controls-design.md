# Test-Agent Cleanup + Site-Wide List Controls — Design

Date: 2026-08-07
Status: Approved (Wes, in-session)

## Problem

1. Smoke/load/bench runs created ~729 unidentified agents (`smoke-*`, `loadtest-*`, `bench-agent-*`, `ci-smoke`, ...). They bloat /identities, the global "All agents" dropdown, and the policy agent picker. There is no delete path: the checkboxes only wire to "Request pairing". The Decisions ledger totals (150k actions, $43k "spend") include this test traffic.
2. No page has collapsible sections or column sort/filter. No shared primitives exist for either (only the selection kit: `useSelection`, `BulkActionBar`, `SelectCheckbox`).

Agents are derived from `action_records` — there is no agent table row. "Deleting an agent" = deleting its action rows.

## Decisions (approved)

- Hard delete (not hide-only) for cleanup. Ledger totals shrink to real numbers.
- Cleanup UI = one-click synthetic-pattern button + per-row bulk delete. Zero terminal steps.
- Prevention = hide synthetic agents by default everywhere + a 7-day retention sweep.
- Site-wide rollout of collapse/sort/filter in this pass.
- Sort/filter is client-side over loaded rows. Server-side sort params for the heavy
  paginated routes (decisions, audit-log) are explicitly OUT of scope for this pass.

## Part A — Cleanup + prevention

### A1. Shared synthetic-agent registry

- Extract `SYNTHETIC_AGENT_RE`, `SYNTHETIC_AGENT_LIKE_PATTERNS`, and
  `SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS` from `app/lib/calibration-mining.js` into a
  shared module (e.g. `app/lib/synthetic-agents.js`). Add `bench-agent-%` (missing today).
- `calibration-mining.js` re-imports from the shared module. Tests that pin the list
  (`__tests__/unit/posture.repository.test.ts`, `__tests__/unit/calibration-mining.test.js`)
  update in the same change.
- `ps-*` agents are the real Practical Systems fleet — NEVER in the synthetic list.

### A2. Delete API — extend `DELETE /api/actions`

Existing handler (`app/api/actions/route.ts`) is admin-gated, write-ahead audit-logged,
and repository-backed. Add two modes:

- `?synthetic=true` — delete all action rows for agents matching the synthetic patterns
  (agent LIKE patterns OR action-type LIKE patterns).
- `?agent_ids=a,b,c` — delete all action rows for the named agents (bulk from selection).

Repository methods (`actions.repository`): `deleteActionsBySyntheticAgents(orgId)` and
`deleteActionsByAgentIds(orgId, ids)`. Deletes run in batches (10k rows/statement),
looping until zero, and return the total deleted count. Follows the existing
snapshot-before-delete conventions of the current delete paths.

### A3. /identities UI

- **"Clean up test agents (N)"** button (admin-only), N = count of currently visible
  synthetic unidentified agents. Confirm dialog → `DELETE /api/actions?synthetic=true`
  → refetch. Shows deleted-count toast/result.
- **"Delete"** bulk action added to the unidentified-agents `BulkActionBar`
  (next to "Request pairing"). Confirm dialog → `?agent_ids=`.

### A4. Hide synthetic agents by default

- `listAgentsForOrg` (`agents.repository`) excludes synthetic agents (SQL NOT LIKE over
  the shared patterns) unless `includeSynthetic` is set.
- `/api/agents` passes `?include_synthetic=true` through. Default = hidden. This cleans
  the Identities fleet, the global AgentFilterDropdown, and the policy agent picker at
  one choke point.
- /identities gets a **"Show test agents"** toggle that re-fetches with the flag.

### A5. Retention sweep

- New cron route `app/api/cron/synthetic-sweep/route.ts`, CRON_SECRET-gated (same
  pattern as `jti-sweep`). Deletes synthetic-agent action rows older than
  `DASHCLAW_SYNTHETIC_RETENTION_DAYS` (default 7). Uses the same batch-delete repo method.
- Scheduled by a GitHub workflow (daily), same shape as `.github/workflows/jti-sweep.yml`.
- Env var goes in `.env.example` + docs. Route count +1 → update cited counts
  (`scripts/check-doc-counts.mjs --strict`).

## Part B — Shared list-control primitives + rollout

### B1. `CollapsibleSection` (`app/components/ui/CollapsibleSection.tsx`)

- Props: `id`, `title`, `count?`, `actions?` (slot), `defaultOpen`, children.
- Chevron toggle; persists open/closed per `id` in localStorage
  (`dashclaw.section.<id>`). Design tokens only, no hex.

### B2. `useListControls` + `ListControlsBar`

- Hook input: rows + column descriptors `{ key, label, accessor, sortable?, filterable? }`.
- Output: processed rows, sort state, search text, active per-column filters.
- `ListControlsBar` renders: sort dropdown + direction toggle, search input, and value
  filters for `filterable` columns (distinct loaded values). Card-row lists, not tables.
- Client-side only. On server-paginated pages it operates on the loaded page and the
  existing server-side filter dropdowns stay.

### B3. Rollout pages

identities, decisions, approvals, audit-log, assumptions, sessions, webhooks, api-keys,
policies, team-tasks. Each major section becomes a `CollapsibleSection`; each list gets
a `ListControlsBar` with page-appropriate columns (name, last-active, action count,
risk, status, date, ...).

## Error handling

- Delete API: 403 non-admin, 400 empty `agent_ids`, audit-log write failure aborts the
  delete (existing `logActivityStrict` behavior). Batch loop surfaces partial-progress
  counts on error.
- Sweep route: returns deleted count; fails loudly (non-2xx) on DB errors.

## Testing

- Unit: synthetic-registry module (patterns, bench-agent match, ps-* non-match),
  batch-delete repo methods, `listAgentsForOrg` exclusion flag, `useListControls`
  sort/filter/search, CollapsibleSection persistence.
- frontend-verify: every rollout page renders; cleanup button works against local data
  (identities count drops, dropdown clean); toggle reveals test agents.
- Gates: lint, full vitest, typecheck, `next build`, doc-count check.

## Out of scope (explicit)

- Server-side sort params on decisions/audit-log APIs.
- Cleaning synthetic rows out of non-action tables (sessions, assumptions) beyond what
  existing delete machinery already cascades — revisit if they visibly bloat.
- Soft-delete/archive schema flags.

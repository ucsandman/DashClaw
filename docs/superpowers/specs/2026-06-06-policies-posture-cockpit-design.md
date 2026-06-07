# /policies redesign — Posture Cockpit (design spec)

_Date: 2026-06-06 · Status: approved direction, pending spec review · Surface: `app/policies`_

## Why

The `/policies` page was redesigned at v4.4.3 (origin/main `08da66c2`) into a guided front door + console. The owner's verdict: "too much going on, not simple enough, looks horrendous." Grounded diagnosis of the live code:

1. **It's a setup wizard pretending to be a page.** The zero-state (`PolicyFrontDoor` → `ModeApply`) renders the full 17-line rule breakdown, an interruption forecast, a scope picker, a spend-cap input, an 8-card mode grid, and an `AdvancedSection` with 3 sub-tabs — all at once, before the operator decides anything.
2. **The "Applies to" chip wall** (`AgentScopePicker`) renders one chip per org agent (50+), no search, no cap. The single worst offender.
3. **Truncated mode blurbs** (`ModeCard` clips `uxPromise`) read as broken.
4. **Cards inside cards inside disclosures, 3–4 deep** — violates the impeccable hard ban on nested cards.
5. **No calm "what's governing me right now" view** — even populated, the page is about *changing*, not *showing*.

## Goal

Replace the page with a **calm steady-state console** ("posture cockpit") that opens on *what is enforced right now*, pushes mutation into a focused drawer, kills the chip wall, and dissolves the tab structure. Honor `.impeccable.md`: serious/precise/trustworthy, calm instrument panel, brand orange as signal only, **no nested cards**, tokens only.

## Locked decisions (from brainstorm, 2026-06-06)

| Decision | Choice |
|---|---|
| Page's primary job | **Steady-state console** — read-first; apply/change is a secondary drawer flow. |
| Agent scoping | **"All agents" by default.** No chip wall. Scope is one line → popover (search + attribute matcher + `N of M` count). |
| Re-architecture latitude | **Re-architect the IA** — merge/move concepts, keep the data model + APIs. |
| Steady-state character | **Posture cockpit** (direction A): status line → signal-only enforcement summary → flat shields → recent digest. |
| Backend for v1 | **Full instrument (read-only)** — `GET /api/policies/summary` + a `getDecisionCountsByPolicy` read query so shields and rules show live `fired N× · 30d`. No migration. Cockpit **degrades gracefully** if counts are unavailable. _(Owner delegated the call 2026-06-06, upgrading the earlier "minimal summary" pick.)_ |
| Custom rules destination | **Sub-route `/policies/rules`**, linked from the enforcement summary. |

## IMPLEMENTER PRELUDE — sync first

The frontend changes target **origin/main `08da66c2`** (the redesigned components: `PolicyFrontDoor`, `PolicyConsole`, `ModeApply`, `AdvancedSection`, `AgentScopePicker`, `ModesTab`, `ModeCard`, `ShieldsGrid`, `ShieldCard`, `ActivityTab`, `CustomTab`). A working tree behind that commit will be missing those files. **Pull/sync to origin/main before implementing.** The backend (`compile.ts`, `catalog.ts`, `guard.repository.ts`, `app/api/policies/**`) was untouched by the redesign and is identical across branches.

## The three states

### Populated (the 90% view)

```
POSTURE                                              All agents · change ›

  ● Claude Code mode · low interruption · 47 agents · 0 pending     Change mode ›

  Enforces  2 warn · 7 require approval · 2 block · everything else allowed
                                                                     View rules ›

  ──────────────────────────────────────────────────────────────────────
  DECISIONS · LAST 30 DAYS

  831 allowed · 48 warned · 18 approved · 14 blocked

  ──────────────────────────────────────────────────────────────────────
  SHIELDS                                              7 of 9 on · manage ›

  ● Deploy Gate            approval before any deploy        fired 142× · 30d
  ● Secret Exposure Guard  blocks credential leaks           fired 88× · 30d
  ● High Risk Review       flags risk ≥ 70 for approval      fired 51× · 30d
  ● Critical Risk Block    hard-blocks risk ≥ 90             quiet · 30d
  ○ Outbound Message Gate  review outbound messages              turn on ›

  ──────────────────────────────────────────────────────────────────────
  RECENT                                       All decisions on /decisions ›

  14:31  BLOCKED   deploy-bot      git_push to prod
  14:28  APPROVED  researcher-1    external_api_call → wes@
  14:22  WARNED    claude-code-1   file_write outside project
```

- The whole page is **hairline-delimited sections** with small-caps mono labels. The only elevated surfaces are the slide-in **ModeDrawer** and the **ScopePopover**. No card wraps any section. No nested cards anywhere.
- The enforcement summary is **signal-only**: it states what costs the operator something (warn / require-approval / block counts) plus a single tertiary footnote "Everything else runs without interruption." The full compiled rule list is revealed on demand via `View rules ›`. **No always-on rule dump, no decorative bar chart** (the two sharpest skeptic findings).
- `View rules ›` expands (inline `Disclosure`) the **real compiled policy names** grouped by nominal decision bucket (ALLOWS / WARNS / REQUIRES APPROVAL / BLOCKS) — pulled verbatim from active `guard_policies`, never an invented token vocabulary.

### Empty (no governance active)

One tertiary line and one orange action. No wizard, no cards, no grid:

```
  No governance active. Your agents run unchecked.

  Apply your first mode ›
```

`Apply your first mode ›` opens the same **ModeDrawer**.

### Loading

Section-shaped skeletons (header line, summary line, 4 shield rows, 3 recent rows). No center spinner.

## Component architecture

All new components live in `app/policies/components/`. Each has one job; props are explicit; no component owns more than its section.

| Component | Responsibility | Reads |
|---|---|---|
| `PolicyCockpit` | Orchestrator. Fetches summary; picks empty vs populated vs loading; hosts `ModeDrawer` + `ScopePopover` open-state. Replaces `PolicyFrontDoor` + `PolicyConsole`. | `GET /api/policies/summary`, `GET /api/guard/decisions` |
| `PostureHeader` | `POSTURE` label, the one-line scope (`All agents · change ›` → opens `ScopePopover`), the status line (`● <mode> · <interruption> · <N> agents · <P> pending`), and `Change mode ›` (→ `ModeDrawer`). Owns identity/scope/mutation, not rule detail. | props from summary |
| `EnforcementSummary` | The signal-only `Enforces` line (`2 warn · 7 require approval · 2 block · everything else allowed`) + `View rules ›` (expands grouped compiled rule names) + `Edit rules ›` → `/policies/rules`; and the separate `DECISIONS · LAST 30 DAYS` outcome counts. | summary (rule buckets) + `GET /api/guard/decisions` (outcome counts) |
| `ShieldList` / `ShieldRow` | Flat list: `● name · short description` + toggle. `manage ›` and per-row `turn on ›`. Promoted out of Advanced. PATCHes `/api/policies` on toggle. | summary shield states + `shields.js` catalog |
| `RecentDigest` | 4–5 most-recent decision rows + `All decisions on /decisions ›`. | `GET /api/guard/decisions?limit=5` |
| `ModeDrawer` | Right drawer (~480px). Plain mode list (full `uxPromise`, no truncation) → select → **impact preview** → scope (inline footer) → `Apply`. Reworks `ModeApply`. | `GET /api/policies/modes`, `POST /modes/preview`, `POST /modes/import` |
| `ScopePopover` | The `change ›` target. Search input + radio All / by-attribute matcher (`tag=prod → matches 12`) + `N of 47` count. **Never renders agent chips.** Replaces `AgentScopePicker`. | `GET /api/agents` (count + search only) |

Reused as-is: `Disclosure` (for `View rules`). The existing custom rule-builder components (`PolicyAuthoringPanel`, `PolicyRuleBuilderSection`, `CustomTab`, etc.) are re-mounted under the new `/policies/rules` route, not rebuilt.

### Page + route changes

- `app/policies/page.tsx` — render `<PolicyCockpit/>`; drop the tab state and the `TABS` array.
- `app/policies/rules/page.tsx` — **new** sub-route. Mounts the existing custom rule-authoring surface (`CustomTab` content) inside `PageLayout` with breadcrumb `Governance / Policies / Rules`.

## Backend: `GET /api/policies/summary`

A new **read-only** route. No migration. Thin route → business logic in lib → repository for raw rows (honors the no-SQL-in-routes guardrail).

**Response shape:**

```ts
interface PolicySummary {
  governed: boolean;                 // any active policy exists
  modes: { id: string; name: string; interruptionLevel: 'low'|'medium'|'high' }[];
  primaryMode: { id: string; name: string; interruptionLevel: string } | null; // headline mode
  // RULE counts by nominal decision — mirrors compile.ts `summarizeModePack`.
  // No `allow` count: "allow" is the absence of a gate ("everything else"), not a rule.
  enforcement: { total: number; warn: number; require_approval: number; block: number };
  shields: { id: string; name: string; description: string; on: boolean; fired30d: number; lastFiredAt: string | null }[];
  ruleCounts?: Record<string, { fired30d: number; lastFiredAt: string | null }>; // keyed by policy name, for the View-rules list; optional (omitted if the count query is unavailable)
  agents: { total: number };
  pendingApprovals: number;
}
```

> The 30-day **decision** counts in the wireframe (`831 allowed · 48 warned · …`) are a **separate** signal — actual outcomes from `GET /api/guard/decisions` stats, not the rule buckets above. The existing stats query is org-level (7-day today); a `?days=30` param is a trivial optional extension if the longer window is wanted. v1 may label the line with whatever window the endpoint returns rather than promising 30 days.

**Derivation (all from existing data, zero schema change):**

- **Active policies** — new repository read `getActivePolicies(sql, orgId)` in `guard.repository.ts` (the home of `guard_policies`) returning `{ id, name, policy_type, rules, active }` for `active = 1`. (A read-only addition; repositories are exempt from the route-SQL guardrail.)
- **Current mode(s)** — parse each policy's `rules._mode` tag (set by `compile.ts`). Distinct `_mode` ids present = `modes[]`; `primaryMode` = the most-recently-applied (highest `id` among `_mode`-tagged rows), mapped through `POLICY_MODE_CATALOG` for name + `interruptionLevel`.
- **Enforcement buckets** — group **all** active policies by `nominalDecision()` (already exported from `compile.ts`; generalize it to accept a stored policy row, or add a sibling `nominalDecisionForRow()` in `app/lib/policy-modes/summary.ts`). This reflects the truthful enforced set (mode + shields + custom), not a single mode's pack. Only `warn` / `require_approval` / `block` are counted; "allow" stays implicit ("everything else runs without interruption").
- **Shields** — for each entry in `app/policies/lib/shields.js`, `on` = an active policy carries that shield's `_shield` id. `description` from the shields catalog. `fired30d` / `lastFiredAt` come from the fired-counts query below, matched by policy name.
- **Fired counts** — new read-only repository fn `getDecisionCountsByPolicy(sql, orgId, days = 30)` that unnests `matched_policies` in `guard_decisions` (`jsonb_array_elements_text` or json-unnest), groups by policy name → `{ name, fired30d, lastFiredAt }`. The summary attaches these to `shields[]` and to `ruleCounts`. **Additive and defensive:** if the query errors or returns empty, the summary omits `ruleCounts` and sets `fired30d: 0 / lastFiredAt: null`; the cockpit renders normally without numbers (no broken/empty state).
- **pendingApprovals** — count of open approvals (reuse the approvals/guard stats query already used elsewhere).

Business logic lives in **`app/lib/policy-modes/summary.ts`** (`buildPolicySummary(activePolicies, agentsCount, pending)`), unit-testable in isolation. The route only auth-resolves org, calls the repository, calls the lib, returns JSON.

`app/policies/lib/modesClient.ts` — add `fetchSummary(): Promise<PolicySummary>`; keep `fetchModes` / `previewMode` / `importMode`.

## IA changes (file-by-file)

**Create:** `PolicyCockpit`, `PostureHeader`, `EnforcementSummary`, `ShieldList` (+`ShieldRow`), `RecentDigest`, `ModeDrawer`, `ScopePopover`, `app/policies/rules/page.tsx`, `app/api/policies/summary/route.ts`, `app/lib/policy-modes/summary.ts`, `getActivePolicies` in `guard.repository.ts`, and a test per unit.

**Modify:** `app/policies/page.tsx` (render cockpit), `app/policies/lib/modesClient.ts` (add `fetchSummary`).

**Retire after logic migrates** (delete once the cockpit covers them): `PolicyFrontDoor`, `PolicyConsole`, `ModeApply`, `AdvancedSection`, `AgentScopePicker`, `ModesTab`, `ModeCard`, `ShieldsGrid`, `ShieldCard`, `ActivityTab`. (`ModeApply`'s preview/import logic → `ModeDrawer`; `ShieldCard`/`ShieldsGrid` → `ShieldList`/`ShieldRow`; `ActivityTab` → `RecentDigest`; mode grid → drawer list.)

**Move:** `CustomTab` (and its rule-builder children) → mounted under `/policies/rules`; remove from the main view.

**Remove from main view:** the 8-card mode grid (drawer-only), the chip wall, the Advanced 3-tab.

## Visual & interaction rules (impeccable)

- **No nested cards.** Sections separated by `1px var(--color-border)` hairlines + a small-caps mono label (`text-xs`, wide tracking, `text-tertiary`). No `bg-secondary` box wraps the page body. Only `ModeDrawer` and `ScopePopover` are elevated surfaces.
- **Orange as signal only.** `--color-brand` appears on: the active-mode status dot (`●`), pending-approval indicators, and primary actions (`Apply`, `Apply your first mode`, the `change ›`/`Change mode ›` affordances). Never as fill, gradient, or ambient.
- **Status dots** are plain filled glyphs (`●`/`○`) with a token color — no glow, no blur, no gradient (avoids the crypto/web3 anti-reference, the top risk for dark+orange).
- **Counts** use `tabular-nums`. Status colors (`--color-success/warning/error`) only on non-zero values; default data color is `--color-text-primary`/`secondary`.
- **Contrast** ≥ 4.5:1 (`text-secondary #c2c2cc`, `text-tertiary #9b9ba8` both clear it on `#0e1014`). Descriptions are `text-secondary`, not `disabled`.
- **Motion:** drawer/popover slide-in 150–250ms ease-out; `@media (prefers-reduced-motion: reduce)` → crossfade/instant. No page-load choreography. Motion only on these summoned surfaces and on live decision arrivals.
- **Drawer never stacks on drawer.** `ScopePopover` opened from inside `ModeDrawer` resolves **inline in the drawer footer**, not as a second layer. `ScopePopover` opened from `PostureHeader` is a standalone popover.
- **Keyboard + a11y:** drawer is a focus-trapped `<dialog>`/portal (escapes the content stacking context); Escape closes; visible focus rings (`--color-border-active`); toggles are real `role="switch"` buttons; section labels are headings; the recent digest links are descriptive.
- **Tokens only.** No hardcoded hex. If a needed token is missing, add it to `app/globals.css` first.

## Edge cases

- **Multiple modes active** (additive imports): `modes[]` lists all; headline shows `primaryMode` + a `+N` affix (e.g. `Claude Code +1`) that, on `View rules`, shows the merged set. Enforcement buckets always reflect the union.
- **No agents in org:** scope line reads `All agents · 0 in org`; popover shows the empty/search state, never a wall.
- **Summary endpoint fails:** the cockpit shows a single inline error row ("Couldn't load posture — retry") with a retry; it does **not** silently render an empty/"ungoverned" state (which would misreport governance as off). Fail loud.
- **Zero decisions:** enforcement counts render `0 allowed · 0 warned · …`; recent digest shows "No decisions yet."
- **Shield with no matching catalog entry** (legacy `_shield` id): listed by stored name, description omitted; never crashes the list.

## Out of scope (fast-follow)

- A `⌘K` command palette overlay (Apply mode / Add shield / Narrow scope) — optional developer-native polish, not v1.
- Saved named scope presets — the search + attribute matcher covers v1.

## Testing & verification

- **Unit:** `buildPolicySummary` (current-mode pick incl. multiple modes; bucket math; shield on/off; ungoverned). `nominalDecisionForRow` parity with `compile.ts`.
- **Component:** `PolicyCockpit` empty vs populated vs loading; `EnforcementSummary` is signal-only and `View rules` reveals grouped real names; `ScopePopover` renders **zero** agent chips and shows an `N of M` count; `ModeDrawer` preview→apply happy path; `ShieldRow` toggle PATCHes `/api/policies`.
- **Route:** `GET /api/policies/summary` returns the contract; SQL stays in the repository (`npm run route-sql:check` must not regress).
- **Gates (read the output):** `npm run lint`, full `npx vitest run`, `npm run build` (webpack), and the doc/contract checks if the new route changes the inventory (`npm run api:inventory:generate` + `openapi:generate`; the pre-commit hook handles regeneration). Update the SDK/docs surfaces per the project's API-route checklist (the new `/api/policies/summary` route is a route-count change).

## Resolved decisions (owner delegated, 2026-06-06)

1. **Headline when multiple modes are active** → `<primaryMode> +N` (e.g. `Claude Code +1`); `View rules` shows the merged set.
2. **`manage ›` on Shields** → inline expand via `Disclosure` (show all 9 + descriptions); no new surface.
3. **Retire/move list** → as specified; nothing kept on the main page.
4. **Backend** → full instrument (live fired counts), built to degrade gracefully.

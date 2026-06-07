# Policies Posture Cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/superpowers/specs/2026-06-06-policies-posture-cockpit-design.md`.

**Goal:** Replace `/policies` with a calm read-first "posture cockpit": status line → signal-only enforcement summary → flat shields (with live fired counts) → recent decisions digest, with mode-apply in a drawer and scope as a one-line popover (no agent chip wall).

**Architecture:** A new `GET /api/policies/summary` (thin route → `app/lib/policy-modes/summary.ts` business logic → `guard.repository.ts` reads) synthesizes the current mode (from `_mode` tags), enforcement rule-buckets (reusing `compile.ts` `nominalDecision`), shield states (`_shield` tags), and live fired counts (`getDecisionCountsByPolicy` unnesting `matched_policies`). The page becomes one `PolicyCockpit` orchestrator rendering hairline-divided sections; the only elevated surfaces are a right `ModeDrawer` and a `ScopePopover`. Existing modes/shields APIs are reused; no schema migration.

**Tech Stack:** Next.js 16 App Router, React (client components), TypeScript (strict, `noUncheckedIndexedAccess`), Neon Postgres via repositories, Vitest + React Testing Library, Tailwind tokens from `app/globals.css`.

**Build base:** an isolated git worktree off `origin/main` (`08da66c2`). The redesigned components to modify/retire only exist there.

---

## Pre-flight (worktree + baseline)

- [ ] **P1: Create the worktree off origin/main** (via superpowers:using-git-worktrees). Branch name `feat/policies-posture-cockpit`. Confirm `app/policies/components/PolicyFrontDoor.tsx` etc. exist in it.
- [ ] **P2: Baseline gate.** Run `npm run lint` and `npx vitest run app/policies` to capture the pre-change green/known-failures (worktree CRLF may fail ~4 unrelated tests — note them, don't fix). Expected: policies tests pass.

---

## Task 1: Fired-counts repository query

**Files:**
- Modify: `app/lib/repositories/guard.repository.ts`
- Test: `app/lib/repositories/__tests__/guard.repository.decisionCounts.test.ts` (match existing repo test location/pattern — check `app/lib/repositories/__tests__` first; if repos are tested elsewhere, mirror that)

- [ ] **Step 1: Write the failing test.** Mock the `sql` tagged-template (follow the existing repo test mock pattern in the repo's other `__tests__`). Assert `getDecisionCountsByPolicy(sql, 'org_1', 30)` issues one query and maps rows `[{name:'[Claude Code] Gate paid (x402) spend', cnt:'5', last_fired:'2026-06-05T...'}]` → `{ '[Claude Code] Gate paid (x402) spend': { fired30d: 5, lastFiredAt: '2026-06-05T...' } }`. Coerce `cnt` via `Number()` (Neon numerics are strings).

- [ ] **Step 2: Run test, verify FAIL** (`getDecisionCountsByPolicy is not a function`). `npx vitest run <test path>`.

- [ ] **Step 3: Implement.** Add to `guard.repository.ts`:

```ts
/**
 * Per-policy fire counts over the last `days` days, derived by unnesting the
 * `matched_policies` JSON array on `guard_decisions`. Read-only; no schema change.
 * Returns a map keyed by policy name. Coerces numeric strings (Neon HTTP driver).
 */
export async function getDecisionCountsByPolicy(
  sql: Sql,
  orgId: string,
  days = 30,
): Promise<Record<string, { fired30d: number; lastFiredAt: string | null }>> {
  const rows = await sql`
    SELECT mp.name AS name,
           COUNT(*)::int AS cnt,
           MAX(d.created_at) AS last_fired
    FROM guard_decisions d
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE jsonb_typeof(d.matched_policies::jsonb)
        WHEN 'array' THEN d.matched_policies::jsonb
        ELSE '[]'::jsonb
      END
    ) AS mp(name)
    WHERE d.org_id = ${orgId}
      AND d.created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY mp.name
  `;
  const out: Record<string, { fired30d: number; lastFiredAt: string | null }> = {};
  for (const r of rows as Array<{ name: string; cnt: number | string; last_fired: string | null }>) {
    out[r.name] = { fired30d: Number(r.cnt) || 0, lastFiredAt: r.last_fired ?? null };
  }
  return out;
}
```

> **Verify the real shape first:** confirm the `guard_decisions` columns (`org_id`, `matched_policies`, `created_at`) and whether `matched_policies` stores an array of policy **names** or **ids**, by reading `schema/schema.js` + an existing decisions query in `guard.repository.ts`. Adjust the unnest/column names to match. If `matched_policies` is `text[]` not jsonb, use `unnest(d.matched_policies)` instead.

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Add `getActivePolicies`** read fn if one doesn't already exist (it likely does — check for an existing "list policies" repo fn first and reuse it). It must return `{ id, name, policy_type, rules, active }` for `active = 1` in the org. Add a test mirroring Step 1 if new.
- [ ] **Step 6: Commit** `feat(policies): add getDecisionCountsByPolicy + active-policy read`.

---

## Task 2: Summary business logic (`buildPolicySummary`)

**Files:**
- Create: `app/lib/policy-modes/summary.ts`
- Test: `app/lib/policy-modes/__tests__/summary.test.ts`

- [ ] **Step 1: Write failing tests** covering: (a) ungoverned (no active policies) → `{ governed:false, primaryMode:null, modes:[], enforcement:{total:0,...}, shields:[…all off…] }`; (b) one mode applied → `primaryMode` resolved from `_mode` tag via `POLICY_MODE_CATALOG`, buckets summed via nominal decision; (c) two modes → `modes.length===2`, `primaryMode` = highest-id `_mode`; (d) shield `on` toggling from a `_shield`-tagged active policy; (e) fired counts attached by name; (f) counts map absent → `fired30d:0/lastFiredAt:null`, no throw.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** Pure function; no I/O. Reuse `nominalDecision`/`summarizeModePack` from `compile.ts` adapted to stored rows, `POLICY_MODE_CATALOG` from `catalog.ts`, and the shield catalog from `app/policies/lib/shields.js`.

```ts
import { POLICY_MODE_CATALOG } from './catalog';
import { nominalDecision } from './compile';
import { SHIELDS } from '@/policies/lib/shields'; // confirm export name/shape
import type { GuardPolicyType, DecisionType } from '@/lib/types';

export interface ActivePolicyRow {
  id: number | string;
  name: string;
  policy_type: GuardPolicyType;
  rules: Record<string, unknown> | string; // JSON or parsed
  active: 0 | 1;
}
export interface PolicySummary {
  governed: boolean;
  modes: { id: string; name: string; interruptionLevel: 'low' | 'medium' | 'high' }[];
  primaryMode: { id: string; name: string; interruptionLevel: string } | null;
  enforcement: { total: number; warn: number; require_approval: number; block: number };
  shields: { id: string; name: string; description: string; on: boolean; fired30d: number; lastFiredAt: string | null }[];
  ruleCounts?: Record<string, { fired30d: number; lastFiredAt: string | null }>;
  agents: { total: number };
  pendingApprovals: number;
}

const asRules = (r: ActivePolicyRow['rules']): Record<string, unknown> =>
  typeof r === 'string' ? safeParse(r) : (r ?? {});
function safeParse(s: string): Record<string, unknown> { try { return JSON.parse(s); } catch { return {}; } }

export function buildPolicySummary(
  active: ActivePolicyRow[],
  agentsTotal: number,
  pendingApprovals: number,
  counts?: Record<string, { fired30d: number; lastFiredAt: string | null }>,
): PolicySummary {
  const governed = active.length > 0;

  // modes from _mode tags, dedup, highest-id wins for primary
  const modeIds = new Map<string, number>(); // id -> max numeric policy id seen
  for (const p of active) {
    const mid = asRules(p.rules)._mode;
    if (typeof mid === 'string') modeIds.set(mid, Math.max(modeIds.get(mid) ?? 0, Number(p.id) || 0));
  }
  const modes = [...modeIds.keys()]
    .filter((id) => POLICY_MODE_CATALOG[id])
    .map((id) => ({ id, name: POLICY_MODE_CATALOG[id]!.name, interruptionLevel: POLICY_MODE_CATALOG[id]!.interruptionLevel }));
  const primaryId = [...modeIds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const primaryMode = primaryId && POLICY_MODE_CATALOG[primaryId]
    ? { id: primaryId, name: POLICY_MODE_CATALOG[primaryId]!.name, interruptionLevel: POLICY_MODE_CATALOG[primaryId]!.interruptionLevel }
    : null;

  // enforcement buckets over ALL active policies
  const enforcement = { total: active.length, warn: 0, require_approval: 0, block: 0 };
  for (const p of active) {
    const d: DecisionType = nominalDecision({ name: p.name, policy_type: p.policy_type, rules: asRules(p.rules), active: 1 });
    if (d === 'warn') enforcement.warn++;
    else if (d === 'require_approval') enforcement.require_approval++;
    else if (d === 'block') enforcement.block++;
  }

  // shields: catalog ∩ active _shield tags
  const onShieldIds = new Set<string>();
  for (const p of active) { const s = asRules(p.rules)._shield; if (typeof s === 'string') onShieldIds.add(s); }
  const shields = SHIELDS.map((s) => {
    const fired = counts?.[s.name] ?? counts?.[s.id]; // match by stored policy name; fall back to id
    return { id: s.id, name: s.name, description: s.description, on: onShieldIds.has(s.id), fired30d: fired?.fired30d ?? 0, lastFiredAt: fired?.lastFiredAt ?? null };
  });

  return { governed, modes, primaryMode, enforcement, shields, ruleCounts: counts, agents: { total: agentsTotal }, pendingApprovals };
}
```

> Confirm `nominalDecision` accepts this shape; if its param type is `CompiledModePolicy`, either widen it or add an exported `nominalDecisionForRow(policy_type, rules)` in `compile.ts` and call that. Confirm `SHIELDS` export name in `shields.js` (`.id`, `.name`, `.description`).

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat(policies): buildPolicySummary pure logic + tests`.

---

## Task 3: `GET /api/policies/summary` route

**Files:**
- Create: `app/api/policies/summary/route.ts`
- Test: `app/api/policies/summary/__tests__/route.test.ts` (mirror an existing `app/api/policies/*/__tests__` route test)

- [ ] **Step 1: Write failing test** — mock the repository fns + auth/org resolution (copy the mock setup from `app/api/policies/modes/route.ts`'s test). Assert 200 + the `PolicySummary` shape; assert the route file contains **no inline SQL** (repositories only).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** a thin route: resolve org (same helper the sibling `modes` route uses), call `getActivePolicies`, `getDecisionCountsByPolicy` (wrap in try/catch → `undefined` on error, do NOT fail the request), count agents (reuse the agents repo/`/api/agents` source) and pending approvals (reuse existing approvals stats query), then `buildPolicySummary(...)`. Return `NextResponse.json(summary)`. Match the export/runtime conventions (`export const runtime`, error envelope) of `app/api/policies/modes/route.ts`.
- [ ] **Step 4: Run, verify PASS** + `npm run route-sql:check` does not regress.
- [ ] **Step 5: Commit** `feat(policies): GET /api/policies/summary`.

---

## Task 4: `modesClient.fetchSummary`

**Files:**
- Modify: `app/policies/lib/modesClient.ts`
- Test: `app/policies/lib/__tests__/modesClient.test.ts` (add a case; mirror existing)

- [ ] **Step 1:** Failing test: `fetchSummary()` GETs `/api/policies/summary`, returns parsed JSON, throws on non-ok. **Step 2:** FAIL. **Step 3:** add `export async function fetchSummary(): Promise<PolicySummary>` + re-export the `PolicySummary` type from `summary.ts`. **Step 4:** PASS. **Step 5:** Commit `feat(policies): modesClient.fetchSummary`.

---

## Task 5: `ScopePopover` (kills the chip wall)

**Files:**
- Create: `app/policies/components/ScopePopover.tsx`
- Test: `app/policies/components/__tests__/ScopePopover.test.tsx`

- [ ] **Step 1: Failing tests:** (a) renders the trigger line `All agents · change`; (b) opening renders a search input + `All agents` (default) and `By attribute` radio, and **zero** elements rendered per agent name (assert no list item count scales with agents — render with 50 mock agents, assert the DOM does not contain 50 agent buttons); (c) typing a matcher `tag=prod` shows a live `matches N of 47` count; (d) `onChange` fires with `{ mode:'all' }` or `{ mode:'attribute', expr:'tag=prod' }`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.** Controlled `value`/`onChange`; popover via native `popover`/`<dialog>` or `position:fixed` portal (escape the `overflow` stacking context per `.impeccable.md`). Search field filters a count only (fetch agents for the count + optional typed-name search returning ≤8 rows; never render the full list). Tokens only; focus ring `--color-border-active`; `Escape` closes. The "matches N" count uses a pure helper `countMatches(agents, expr)` — unit-test it too.
- [ ] **Step 4: PASS.** **Step 5: Commit** `feat(policies): ScopePopover (no chip wall)`.

---

## Task 6: `ModeDrawer` (apply/change in a drawer)

**Files:**
- Create: `app/policies/components/ModeDrawer.tsx`
- Test: `app/policies/components/__tests__/ModeDrawer.test.tsx`

- [ ] **Step 1: Failing tests:** (a) closed by default; opening lists all modes from `fetchModes` with **full** `uxPromise` (assert no `truncate` class / full text present); (b) selecting a mode calls `previewMode` and renders the impact line (e.g. "would pause 2 of 200"); (c) scope resolves inline in the footer via `ScopePopover` (no second drawer — assert only one dialog in DOM); (d) `Apply` calls `importMode` with mode id + scope, then `onApplied` + close; (e) `Escape`/backdrop closes without applying.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.** Right drawer (~480px) as focus-trapped `<dialog>`/portal; backdrop dims content; reuses `previewMode`/`importMode`/`fetchModes` from `modesClient`. Reuse `ModeApply`'s preview/import logic but as a drawer (no full rule dump — the drawer shows mode name + uxPromise + interruption + the impact preview; full rules optional behind a small `Disclosure`). Motion 150–250ms ease-out + `prefers-reduced-motion` crossfade.
- [ ] **Step 4: PASS.** **Step 5: Commit** `feat(policies): ModeDrawer`.

---

## Task 7: Section components

**Files (create + per-file test in `app/policies/components/__tests__/`):**
- `PostureHeader.tsx`, `EnforcementSummary.tsx`, `ShieldList.tsx` (+ `ShieldRow.tsx`), `RecentDigest.tsx`

- [ ] **Step 1: Failing tests, one file at a time:**
  - `PostureHeader`: renders `● {primaryMode.name}` (+`+N` when `modes.length>1`), interruption, `agents.total`, `pendingApprovals`; the scope line opens `ScopePopover`; `Change mode ›` calls `onChangeMode`. Pending count > 0 uses the warning/brand token, 0 is neutral.
  - `EnforcementSummary`: renders signal-only `2 warn · 7 require approval · 2 block · everything else allowed`; `View rules ›` toggles a `Disclosure` listing the **real grouped policy names** (passed as prop) with optional `fired N×`; `Edit rules ›` links to `/policies/rules`; the `DECISIONS · LAST 30 DAYS` line renders the outcome counts, colored only on non-zero.
  - `ShieldRow`/`ShieldList`: each row `● name · description` + a `role="switch"` toggle + right-aligned `fired N× · 30d` (or `quiet`/`turn on ›`); toggling calls `onToggle(id, next)`; `manage ›` expands the full 9 inline via `Disclosure`.
  - `RecentDigest`: renders ≤5 rows (decision · agent · summary · time), `All decisions on /decisions ›` link; empty → "No decisions yet."
- [ ] **Step 2: FAIL each.**
- [ ] **Step 3: Implement each.** Presentational, props-driven, tokens only, **no card wrappers** — hairline `border-border` dividers + small-caps mono labels (`text-xs tracking-wide text-tertiary uppercase`). `tabular-nums` on counts. Orange only on active dot / pending / primary affordances.
- [ ] **Step 4: PASS each.** **Step 5: Commit** `feat(policies): cockpit section components`.

---

## Task 8: `PolicyCockpit` orchestrator + page swap

**Files:**
- Create: `app/policies/components/PolicyCockpit.tsx`
- Modify: `app/policies/page.tsx`
- Test: `app/policies/components/__tests__/PolicyCockpit.test.tsx`, update `app/policies/__tests__/page.test.tsx`

- [ ] **Step 1: Failing tests:** (a) loading → section skeletons (no spinner role); (b) `governed:false` → empty state (one line + `Apply your first mode ›` opening `ModeDrawer`), and **none** of PostureHeader/EnforcementSummary/ShieldList render; (c) `governed:true` → PostureHeader + EnforcementSummary + ShieldList + RecentDigest render in order, fed from `fetchSummary`; (d) summary fetch error → an inline error row with retry, NOT the empty/"ungoverned" state (fail loud); (e) shield toggle issues `PATCH /api/policies` and refetches summary.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** `PolicyCockpit` (fetch summary + `/api/guard/decisions?limit=5` for the digest; hold `ModeDrawer`/`ScopePopover` open state; refetch after apply/toggle/scope change). Rewrite `page.tsx` to render `<PageLayout title="Policies" subtitle="Govern your agents with one decision" breadcrumbs={['Governance','Policies']} maturity="stable"><PolicyCockpit/></PageLayout>` — drop the `TABS` array + tab state.
- [ ] **Step 4: PASS.** **Step 5: Commit** `feat(policies): PolicyCockpit + page swap`.

---

## Task 9: `/policies/rules` sub-route (custom rule authoring)

**Files:**
- Create: `app/policies/rules/page.tsx`
- Test: `app/policies/rules/__tests__/page.test.tsx`

- [ ] **Step 1: Failing test:** renders within `PageLayout` (breadcrumb `Governance / Policies / Rules`) and mounts the existing custom rule-authoring surface (the component(s) `CustomTab` rendered). **Step 2: FAIL. Step 3:** Implement — reuse the existing `CustomTab`/authoring components unchanged; just host them on the route. Add the `Edit rules ›` link target. **Step 4: PASS. Step 5: Commit** `feat(policies): /policies/rules sub-route`.

---

## Task 10: Retire superseded components

**Files (delete):** `PolicyFrontDoor.tsx`, `PolicyConsole.tsx`, `ModeApply.tsx`, `AdvancedSection.tsx`, `AgentScopePicker.tsx`, `ModesTab.tsx`, `ModeCard.tsx`, `ShieldsGrid.tsx`, `ShieldCard.tsx`, `ActivityTab.tsx` (+ their tests). Keep `Disclosure.tsx`, `CustomTab.tsx` (+ rule-builder children), `shields.js`, `modesClient.ts`, `modeStrings`, anything `/policies/rules` reuses.

- [ ] **Step 1:** `grep -r` each component name across `app/` to confirm zero remaining imports (only the deleted files + their tests reference them). Fix any straggler imports.
- [ ] **Step 2:** Delete the files + their tests.
- [ ] **Step 3:** `npx vitest run app/policies` + `npm run build` to confirm nothing dangles.
- [ ] **Step 4: Commit** `refactor(policies): retire superseded tab/card components`.

---

## Task 11: Visual pass (impeccable) in the browser

- [ ] **Step 1:** `npm run dev`; load `/policies` populated and empty (seed/apply a mode if needed). Use the `frontend-verify` / `run` skill to screenshot both states + the drawer + scope popover.
- [ ] **Step 2:** Check against `.impeccable.md`: no nested cards, hairline dividers, orange only on active/pending/primary, ≥4.5:1 contrast, `tabular-nums`, drawer focus-trap + `Escape`, `prefers-reduced-motion`. Fix on sight.
- [ ] **Step 3:** Ask the owner to eyeball the two screenshots (browser confirmation per their preference). Commit any polish `style(policies): cockpit visual polish`.

---

## Task 12: Gates + docs/contract sync

- [ ] **Step 1:** `npm run lint` — clean.
- [ ] **Step 2:** full `npx vitest run` — green (note only the known worktree-CRLF failures, verified by re-running those on `main`/LF).
- [ ] **Step 3:** `npm run build` (webpack) — succeeds.
- [ ] **Step 4:** New route ⇒ regen contracts/inventory: `npm run api:inventory:generate` + `npm run openapi:generate`; verify `npm run api:inventory:check` + `npm run openapi:check`. Update the API-route doc checklist surfaces for `/api/policies/summary` (docs page, PROJECT_DETAILS route list, api-inventory). The pre-commit hook regenerates livingcode/inventory.
- [ ] **Step 5: Commit** `docs(policies): sync inventory/openapi for /api/policies/summary`.

---

## Definition of done

- `/policies` opens on the posture cockpit; empty state is one line + one action; no chip wall anywhere; no nested cards; mode-apply + scope are drawer/popover; shields show live fired counts (or degrade gracefully); Activity lives only as a digest → `/decisions`; custom rules at `/policies/rules`.
- `GET /api/policies/summary` returns the contract; SQL only in the repository.
- `npm run lint`, full `npx vitest run`, `npm run build` all green (output read, not assumed).
- Inventory/openapi/docs synced for the new route.

# Test-Agent Cleanup + Site-Wide List Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the ~729 smoke/test agents (their `action_records` rows) via one-click UI, hide synthetic agents from every agent surface by default, auto-purge future test traffic after 7 days, and give every list page collapsible sections + sort/filter via two new shared primitives.

**Architecture:** Agents are derived from `action_records` — deleting an agent = deleting its action rows. We extend the existing admin `DELETE /api/actions` filter machinery (shared WHERE builder keeps audit set = deleted set), filter synthetic agents at the single roster choke point (`listAgentsForOrg`), and add a CRON_SECRET-gated sweep route. UI: new `CollapsibleSection` + `useListControls`/`ListControlsBar` primitives rolled out across 10 list pages.

**Tech Stack:** Next.js 16 App Router, TypeScript, Neon Postgres via repository layer, vitest, Tailwind (CSS tokens only — no hex).

**Spec:** `docs/superpowers/specs/2026-08-07-test-agent-cleanup-and-list-controls-design.md`

## Global Constraints

- No direct SQL in `app/api/**/route.*` — repositories only (`route-sql:check` gates it).
- Never hardcode hex colors — use tokens from `app/globals.css` / Tailwind theme (`.impeccable.md` governs design).
- For any changed `.ts` file run `npm run typecheck`; any change under `app/**` requires `npx next build` before push.
- New env vars go in `.env.example` with placeholders + docs.
- Route count changes → run `node scripts/check-doc-counts.mjs --strict` and fix cited counts in the same commit.
- `ps-*` agents are the REAL Practical Systems fleet — never add them to synthetic patterns.
- Full suite before push: `npx vitest run` (not targeted runs).
- Test gotchas: `sql\`\`` template calls consume `vi.fn()` mocks one-per-call; follow existing patterns in `__tests__/unit/`.
- Commit after each task; messages end with the Co-Authored-By + Claude-Session trailer used in this repo.

**DEVIATION FROM SPEC (approved rationale inline):** the retention sweep is org-scoped (default `org_default`, override `DASHCLAW_SYNTHETIC_SWEEP_ORG`) instead of all-orgs, because patterns like `test`/`test-%` could legitimately name a hosted-trial tenant's agent; hosted workspaces already get wiped by `/api/hosted/cleanup`.

---

### Task 1: Shared synthetic-agents module

**Files:**
- Create: `app/lib/synthetic-agents.js`
- Modify: `app/lib/calibration-mining.js:50-89` (import from new module, delete moved consts)
- Modify: `__tests__/unit/posture.repository.test.ts:~216`, `__tests__/unit/calibration-mining.test.js:~183,223` (imports + add `bench-agent-%`)
- Test: `__tests__/unit/synthetic-agents.test.js`

**Interfaces:**
- Produces: `SYNTHETIC_AGENT_RE: RegExp`, `SYNTHETIC_AGENT_LIKE_PATTERNS: string[]`, `SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS: string[]`, `isSyntheticAgentId(agentId: string): boolean` — all exported from `app/lib/synthetic-agents.js`. Tasks 2, 4, 5, 8 consume these.

- [ ] **Step 1: Write the failing test** (`__tests__/unit/synthetic-agents.test.js`):

```js
import { describe, it, expect } from 'vitest';
import {
  SYNTHETIC_AGENT_RE, SYNTHETIC_AGENT_LIKE_PATTERNS, isSyntheticAgentId,
} from '../../app/lib/synthetic-agents.js';

describe('synthetic-agents registry', () => {
  it('matches every known synthetic family incl. bench-agent-*', () => {
    for (const id of ['smoke-h-mr3qh44i', 'ci-smoke', 'sdk-live-test-agent', 'demo-e2e-verifier',
      'test', 'test-7', 'loadtest-mr6y5eev', 'bench-agent-bench_mr9e9luj',
      'analytics-agent', 'openai-deployer-1', 'rogue-agent']) {
      expect(isSyntheticAgentId(id), id).toBe(true);
    }
  });
  it('never matches real fleet agents', () => {
    for (const id of ['ps-prospector', 'ps-researcher', 'openclaw', 'claude-code',
      'ship verification', 'moltfire-openclaw', 'testify-prod']) {
      expect(isSyntheticAgentId(id), id).toBe(false);
    }
  });
  it('regex and LIKE patterns agree (prefix construction)', () => {
    // every LIKE pattern is either exact or `prefix%`; each must be matched by the regex
    for (const p of SYNTHETIC_AGENT_LIKE_PATTERNS) {
      const probe = p.endsWith('%') ? p.slice(0, -1) + 'xyz' : p;
      expect(SYNTHETIC_AGENT_RE.test(probe), p).toBe(true);
    }
  });
});
```

Note `testify-prod` must NOT match: the `test-%` LIKE pattern requires the hyphen, and the regex uses `test-` prefix / `test$` exact — `testify` matches neither.

- [ ] **Step 2: Run to verify it fails**: `npm test -- __tests__/unit/synthetic-agents.test.js` → FAIL (module not found).

- [ ] **Step 3: Create `app/lib/synthetic-agents.js`** — move the block from `calibration-mining.js:50-82` verbatim (keep its comment header explaining each family), then:
  - add `'bench-agent-%'` to `SYNTHETIC_AGENT_LIKE_PATTERNS` and `bench-agent-` to the regex alternation, with a comment naming the generator (`scripts/bench-guard-hotpath.mjs`);
  - export `SYNTHETIC_AGENT_RE` (it was non-exported before);
  - add:

```js
export function isSyntheticAgentId(agentId) {
  return typeof agentId === 'string' && SYNTHETIC_AGENT_RE.test(agentId);
}
```

In `calibration-mining.js`, replace lines 50-82 with:

```js
import {
  SYNTHETIC_AGENT_RE, SYNTHETIC_AGENT_LIKE_PATTERNS, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from './synthetic-agents';
// Re-export for existing consumers (posture repository, policy-tuning, tests).
export { SYNTHETIC_AGENT_LIKE_PATTERNS, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS };
const SYNTHETIC_ACTION_TYPE_PREFIXES = SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS.map((p) => p.slice(0, -1));
```

(`isSyntheticEvent` at line 84 keeps working unchanged.)

- [ ] **Step 4: Update the pinning tests.** `__tests__/unit/calibration-mining.test.js` and `__tests__/unit/posture.repository.test.ts` pin the pattern list — add `bench-agent-%` to their expected arrays. Read the assertions before editing; do not weaken them.

- [ ] **Step 5: Run**: `npm test -- __tests__/unit/synthetic-agents.test.js __tests__/unit/calibration-mining.test.js __tests__/unit/posture.repository.test.ts` → all PASS.

- [ ] **Step 6: Commit**: `feat(cleanup): shared synthetic-agent registry (adds bench-agent-%)`

---

### Task 2: Repository — synthetic/agent-list delete filters

**Files:**
- Modify: `app/lib/repositories/actions.repository.ts:2148-2211`
- Test: `__tests__/unit/actions-delete-filter.test.js` (create)

**Interfaces:**
- Consumes: `SYNTHETIC_AGENT_LIKE_PATTERNS`, `SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS` from Task 1.
- Produces (Task 3 + 5 rely on these exact signatures):
  - `type ActionDeleteFilter = { before?: string|null; agentId?: string|null; status?: string|null; agentIds?: string[]|null; synthetic?: boolean }`
  - `listActionIdsByFilter(sql, orgId, filter, limit?: number): Promise<string[]>` (limit optional, unlimited when omitted)
  - `deleteActionsByIds(sql, orgId, idList)` — unchanged, reused for chunked deletes.

- [ ] **Step 1: Write the failing test.** The WHERE builder is not exported; test through `listActionIdsByFilter` with a fake sql client capturing `query(text, params)`:

```js
import { describe, it, expect, vi } from 'vitest';
import { listActionIdsByFilter } from '../../app/lib/repositories/actions.repository';

function fakeSql() {
  const calls = [];
  const fn = () => Promise.resolve([]);
  fn.query = vi.fn((text, params) => { calls.push({ text, params }); return Promise.resolve([]); });
  return { sql: fn, calls };
}

describe('action delete filter — synthetic + agentIds modes', () => {
  it('agentIds uses agent_id = ANY', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { agentIds: ['a', 'b'] });
    expect(calls[0].text).toMatch(/agent_id = ANY\(\$2\)/);
    expect(calls[0].params).toEqual(['org_default', ['a', 'b']]);
  });
  it('synthetic uses LIKE ANY over agent + action_type patterns', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { synthetic: true });
    expect(calls[0].text).toMatch(/agent_id LIKE ANY\(\$2\) OR action_type LIKE ANY\(\$3\)/);
  });
  it('synthetic composes with before (retention sweep shape)', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { before: '2026-08-01', synthetic: true });
    expect(calls[0].text).toMatch(/timestamp_start::timestamptz < \$2::timestamptz/);
    expect(calls[0].text).toMatch(/LIKE ANY/);
  });
  it('limit appends LIMIT', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { synthetic: true }, 10000);
    expect(calls[0].text).toMatch(/LIMIT 10000$/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**: `npm test -- __tests__/unit/actions-delete-filter.test.js`.

- [ ] **Step 3: Implement** in `actions.repository.ts`. Extend the type and builder (keep the shared-builder invariant comment):

```ts
import { SYNTHETIC_AGENT_LIKE_PATTERNS, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS } from '../synthetic-agents';

type ActionDeleteFilter = {
  before?: string | null; agentId?: string | null; status?: string | null;
  agentIds?: string[] | null; synthetic?: boolean;
};

function buildActionFilterWhere(orgId: string, { before, agentId, status, agentIds, synthetic }: ActionDeleteFilter): { where: string; params: unknown[] } {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let paramIdx = 2;
  if (before) { conditions.push(`timestamp_start::timestamptz < $${paramIdx++}::timestamptz`); params.push(before); }
  if (agentId) { conditions.push(`agent_id = $${paramIdx++}`); params.push(agentId); }
  if (status) { conditions.push(`status = $${paramIdx++}`); params.push(status); }
  if (agentIds && agentIds.length > 0) { conditions.push(`agent_id = ANY($${paramIdx++})`); params.push(agentIds); }
  if (synthetic) {
    // Test traffic: agent-name families OR synthetic action-type families
    // (some liveproof.* rows ride real agent ids).
    conditions.push(`(agent_id LIKE ANY($${paramIdx}) OR action_type LIKE ANY($${paramIdx + 1}))`);
    params.push(SYNTHETIC_AGENT_LIKE_PATTERNS, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS);
    paramIdx += 2;
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export async function listActionIdsByFilter(
  sql: SqlClient, orgId: string, filter: ActionDeleteFilter, limit?: number,
): Promise<string[]> {
  const { where, params } = buildActionFilterWhere(orgId, filter);
  const limitClause = Number.isInteger(limit) && (limit as number) > 0 ? ` LIMIT ${limit}` : '';
  const rows = await sql.query(`SELECT action_id FROM action_records ${where}${limitClause}`, params);
  return rows.map((r: Row) => String(r.action_id));
}
```

`deleteActionsByFilter` needs no change (it inherits the new conditions via the shared builder).

CAUTION: `synthetic-agents.js` is plain JS imported by a `.ts` file — this repo already does `.ts`→`.js` imports (e.g. `calibration-mining.js` consumers); keep the import extensionless. Turbopack `.js`→`.ts` resolution gotchas do not apply in this direction.

- [ ] **Step 4: Run tests** → PASS. Also `npm run typecheck`.

- [ ] **Step 5: Commit**: `feat(cleanup): synthetic + agent-list delete filters in actions repository`

---

### Task 3: `DELETE /api/actions` — `synthetic=true` and `agent_ids=` modes

**Files:**
- Modify: `app/api/actions/route.ts:513-587`
- Test: `__tests__/unit/actions-route-delete.test.js` (create; if a test for this route already exists — check with Glob `__tests__/**/*actions*` — extend it instead)

**Interfaces:**
- Consumes: Task 2's `ActionDeleteFilter`, `listActionIdsByFilter`, `deleteActionsByIds`.
- Produces: `DELETE /api/actions?synthetic=true[&before=ISO]` and `DELETE /api/actions?agent_ids=a,b,c` → `{ deleted: number }`. Both admin-gated, write-ahead audited. Tasks 5 and 8 rely on these exact query params.

- [ ] **Step 1: Write the failing test.** Follow the repo's existing route-test pattern (mock `getSql`, `getOrgId`, `getOrgRole`, `logActivityStrict`, repository fns via `vi.mock`). Core assertions:

```js
// mocks: getOrgRole -> 'admin', listActionIdsByFilter -> ['a1','a2','a3'], deleteActionsByIds -> ids.map(id => ({ action_id: id }))
it('synthetic=true deletes via chunked ids and audits write-ahead', async () => {
  const res = await DELETE(new Request('http://x/api/actions?synthetic=true', { method: 'DELETE' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: 3 });
  expect(listActionIdsByFilter).toHaveBeenCalledWith(expect.anything(), 'org_default', expect.objectContaining({ synthetic: true }));
  // audit called BEFORE delete
  expect(logActivityStrict.mock.invocationCallOrder[0]).toBeLessThan(deleteActionsByIds.mock.invocationCallOrder[0]);
});
it('agent_ids deletes only the named agents', async () => {
  const res = await DELETE(new Request('http://x/api/actions?agent_ids=smoke-a,smoke-b', { method: 'DELETE' }));
  expect(listActionIdsByFilter).toHaveBeenCalledWith(expect.anything(), 'org_default', expect.objectContaining({ agentIds: ['smoke-a', 'smoke-b'] }));
});
it('agent_ids empty after trim -> 400', async () => {
  const res = await DELETE(new Request('http://x/api/actions?agent_ids=%2C%2C', { method: 'DELETE' }));
  expect(res.status).toBe(400);
});
it('non-admin -> 403', async () => { /* getOrgRole -> 'member' */ });
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement.** In the DELETE handler after the `actionIds` / `actionId` branches (route.ts:563), insert the new unified branch BEFORE the existing "at least one filter" check:

```ts
const syntheticParam = searchParams.get('synthetic') === 'true';
const agentIdsParam = searchParams.get('agent_ids');

// Agent-scoped + synthetic cleanup modes (identities page + retention sweep).
// Unified path: resolve ids via the shared WHERE builder, audit write-ahead,
// then delete in chunks so a 100k-row cleanup stays inside serverless limits.
if (syntheticParam || agentIdsParam) {
  const agentIdList = agentIdsParam
    ? agentIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  if (agentIdsParam && (!agentIdList || agentIdList.length === 0)) {
    return NextResponse.json({ error: 'No valid agent ids provided' }, { status: 400 });
  }
  if (agentIdList && agentIdList.length > 1000) {
    return NextResponse.json({ error: 'Too many agent ids (max 1000)' }, { status: 400 });
  }
  const filter: Record<string, unknown> = {
    synthetic: syntheticParam || undefined,
    agent_ids: agentIdList || undefined,
    before: before || undefined,
  };
  const targetIds = await listActionIdsByFilter(sql, orgId, {
    synthetic: syntheticParam, agentIds: agentIdList, before,
  });
  if (targetIds.length === 0) return NextResponse.json({ deleted: 0 });
  await auditDeletion(targetIds, filter);
  let deleted = 0;
  const CHUNK = 10_000;
  for (let i = 0; i < targetIds.length; i += CHUNK) {
    const result = await deleteActionsByIds(sql, orgId, targetIds.slice(i, i + CHUNK));
    deleted += result.length;
  }
  return NextResponse.json({ deleted });
}
```

Also update the route's doc comment (lines 504-512) with the two new params. Set `export const maxDuration = 60;` at the top of the file if not present (large deletes).

- [ ] **Step 4: Run** the new test file + `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**: `feat(cleanup): synthetic + agent_ids modes on DELETE /api/actions`

---

### Task 4: Hide synthetic agents at the roster choke point

**Files:**
- Modify: `app/lib/repositories/agents.repository.ts:104-314` (`listAgentsForOrg`)
- Modify: `app/api/agents/route.ts:16-29`
- Test: `__tests__/unit/agents-roster-synthetic.test.js` (create)

**Interfaces:**
- Consumes: `isSyntheticAgentId` from Task 1.
- Produces: `listAgentsForOrg(sql, orgId, opts?: { includeSynthetic?: boolean })` — default EXCLUDES synthetic agents from the merged roster. `GET /api/agents?include_synthetic=true` passes it through. Task 8 relies on the query param name.

- [ ] **Step 1: Write the failing test.** `listAgentsForOrg` merges action_records + goals + decisions + presence, so filter the FINAL merged array (one place, covers all four sources). Test with a fake sql returning one synthetic + one real agent row from the action_records query and empty results elsewhere:

```js
it('excludes smoke agents by default, includes with includeSynthetic', async () => {
  const rows = [
    { agent_id: 'smoke-u-mr7cb07m', agent_name: 'smoke-u-mr7cb07m', action_count: 12, last_active: null },
    { agent_id: 'openclaw', agent_name: 'openclaw', action_count: 2329, last_active: null },
  ];
  const sqlFn = (strings, ...v) => Promise.resolve([]); // template-tag calls (presence etc.)
  sqlFn.query = vi.fn((text) => Promise.resolve(text.includes('FROM action_records') ? rows : []));
  const def = await listAgentsForOrg(sqlFn, 'org_default');
  expect(def.map((a) => a.agent_id)).toEqual(['openclaw']);
  const all = await listAgentsForOrg(sqlFn, 'org_default', { includeSynthetic: true });
  expect(all.map((a) => a.agent_id).sort()).toEqual(['openclaw', 'smoke-u-mr7cb07m']);
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement.** Signature: `listAgentsForOrg(sql, orgId, opts: { includeSynthetic?: boolean } = {})`. Immediately before the final `agents.sort(...)` (line 303) add:

```ts
// Test traffic (smoke/loadtest/bench/CI) is hidden from every roster consumer
// (identities fleet, global agent dropdown, policy picker) unless explicitly
// requested — the registry lives in app/lib/synthetic-agents.js.
const visible = opts.includeSynthetic ? agents : agents.filter((a) => !isSyntheticAgentId(a.agent_id));
```

sort + return `visible`. In `app/api/agents/route.ts`:

```ts
const { searchParams } = new URL(request.url);
const includeSynthetic = searchParams.get('include_synthetic') === 'true';
const agents = await listAgentsForOrg(sql, orgId, { includeSynthetic });
```

- [ ] **Step 4: Run** new test + `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**: `feat(cleanup): hide synthetic agents from the roster by default`

---

### Task 5: Retention sweep — cron route + workflow + env + docs

**Files:**
- Create: `app/api/cron/synthetic-sweep/route.ts`
- Create: `.github/workflows/synthetic-sweep.yml`
- Modify: `.env.example` (add `DASHCLAW_SYNTHETIC_RETENTION_DAYS=7`, `DASHCLAW_SYNTHETIC_SWEEP_ORG=org_default` with comments)
- Modify: whichever doc documents cron routes (Grep `jti-sweep` in `docs/` and `README.md`; add this sweep alongside)
- Test: `__tests__/unit/synthetic-sweep-route.test.js` (create)

**Interfaces:**
- Consumes: Task 2's `listActionIdsByFilter` + `deleteActionsByIds` (same chunked shape as Task 3).
- Produces: `GET /api/cron/synthetic-sweep` → `{ ok: true, deleted, cutoff, org }`, CRON_SECRET bearer-gated.

- [ ] **Step 1: Write the failing test** (mirror the jti-sweep pattern; mock `timingSafeCompare` or set `CRON_SECRET`):

```js
it('401 without bearer, 503 without CRON_SECRET, deletes older-than-cutoff synthetic rows', async () => { ... });
it('passes synthetic:true + before=cutoff to the filter', async () => {
  // freeze time; expect before ≈ now - 7d when env unset
  expect(listActionIdsByFilter).toHaveBeenCalledWith(expect.anything(), 'org_default',
    expect.objectContaining({ synthetic: true, before: expect.any(String) }));
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement the route** (copy the auth skeleton from `app/api/cron/jti-sweep/route.ts:24-33` verbatim — `dynamic`, `revalidate`, `maxDuration = 60`, CRON_SECRET check with `timingSafeCompare`):

```ts
// GET /api/cron/synthetic-sweep — retention GC for test traffic.
// Smoke/loadtest/bench runs write real action_records; without a sweep they
// accumulate forever (729 phantom agents by 2026-08). Deletes synthetic-agent
// rows older than DASHCLAW_SYNTHETIC_RETENTION_DAYS (default 7).
// Org-scoped (default org_default): `test`/`test-%` could name a hosted
// tenant's real agent, so cross-org sweeping is deliberately NOT done here.
const days = parseInt(process.env.DASHCLAW_SYNTHETIC_RETENTION_DAYS || '', 10) || 7;
const org = process.env.DASHCLAW_SYNTHETIC_SWEEP_ORG || 'org_default';
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const targetIds = await listActionIdsByFilter(sql, org, { synthetic: true, before: cutoff });
let deleted = 0;
for (let i = 0; i < targetIds.length; i += 10_000) {
  deleted += (await deleteActionsByIds(sql, org, targetIds.slice(i, i + 10_000))).length;
}
return NextResponse.json({ ok: true, deleted, cutoff, org });
```

- [ ] **Step 4: Create `.github/workflows/synthetic-sweep.yml`** — copy `jti-sweep.yml` wholesale, rename to "Synthetic-traffic retention sweep", schedule `cron: '17 6 * * *'` (daily; minute offset avoids the top-of-hour GH Actions crush), endpoint `/api/cron/synthetic-sweep`, keep the same `DASHCLAW_BASE_URL`/`CRON_SECRET` secrets and skip-if-unset guard.

- [ ] **Step 5: `.env.example` + docs.** Add both vars with one-line comments. Update the cron/ops doc found via Grep. Run `node scripts/check-doc-counts.mjs --strict` — fix any cited route count (+1) it flags across `README.md`, `PROJECT_DETAILS.md`, `docs/`.

- [ ] **Step 6: Run** new test + typecheck → PASS.

- [ ] **Step 7: Commit**: `feat(cleanup): daily synthetic-traffic retention sweep (7d default)`

---

### Task 6: `CollapsibleSection` primitive

**Files:**
- Create: `app/components/ui/CollapsibleSection.tsx`
- Test: `__tests__/unit/collapsible-section.test.jsx` (create; follow the repo's existing component-test setup — check `__tests__/unit/*.test.jsx` for the rendering pattern in use before writing)

**Interfaces:**
- Produces (Tasks 8-12 rely on this exact contract):

```ts
interface CollapsibleSectionProps {
  id: string;                  // localStorage key suffix: `dashclaw.section.${id}`
  title: React.ReactNode;      // usually the existing h2 contents
  icon?: React.ElementType;    // lucide icon, rendered at size 16
  iconClassName?: string;      // e.g. "text-warning"
  count?: number;              // Badge in header
  badgeVariant?: string;       // Badge variant, default 'default'
  actions?: React.ReactNode;   // right-aligned slot (BulkActionBar, buttons)
  controls?: React.ReactNode;  // second row when open (ListControlsBar)
  defaultOpen?: boolean;       // default true
  children: React.ReactNode;
}
export function CollapsibleSection(props: CollapsibleSectionProps): JSX.Element
```

- [ ] **Step 1: Write the failing test**: renders title + children when open; clicking the header button hides children and writes `dashclaw.section.<id>` = `"0"` to localStorage; remounting with the stored value starts collapsed; `actions` stay clickable without toggling (stopPropagation).

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement.** Key details:
  - `'use client'`; state `const [open, setOpen] = useState(defaultOpen ?? true)`; hydrate from localStorage in `useEffect` (never during render — SSR mismatch), persist on toggle (`'1'`/`'0'`, try/catch around storage access).
  - Header: a full-width `<button type="button" aria-expanded={open}>` row containing `ChevronDown` (rotate `-90deg` via `className={open ? '' : '-rotate-90'} transition-transform`), optional icon, title, count Badge — matching the existing section-header look (`text-sm font-medium text-secondary`, gap-2, mb-3; see `app/identities/page.tsx:449-456` for the target look).
  - `actions` render OUTSIDE the button element (sibling in a flex row) so clicks don't toggle.
  - When closed: render neither `controls` nor `children`. When open: `controls` row (if any), then children.
  - Tokens only; reuse `Badge` from `app/components/ui/Badge`.

- [ ] **Step 4: Run test** → PASS. `npm run typecheck`.

- [ ] **Step 5: Commit**: `feat(ui): CollapsibleSection primitive with persisted state`

---

### Task 7: `useListControls` + `ListControlsBar`

**Files:**
- Create: `app/lib/useListControls.ts`
- Create: `app/components/ListControlsBar.tsx`
- Test: `__tests__/unit/use-list-controls.test.js` (create — pure-logic tests; export the internal `processRows` helper so no React renderer is needed for sort/filter/search)

**Interfaces:**
- Produces (Tasks 8-12 rely on these exact names):

```ts
// app/lib/useListControls.ts
export interface ListColumn<T> {
  key: string;
  label: string;
  accessor: (row: T) => string | number | null | undefined;
  sortable?: boolean;    // appears in sort dropdown
  filterable?: boolean;  // gets a distinct-value filter dropdown
  searchable?: boolean;  // included in text search (default: true for string accessors)
}
export interface ListControlsState<T> {
  rows: T[];                                   // processed output
  sortKey: string | null; sortDir: 'asc' | 'desc';
  setSort: (key: string) => void;              // same key toggles direction
  search: string; setSearch: (s: string) => void;
  filters: Record<string, string>;             // columnKey -> selected value
  setFilter: (key: string, value: string | null) => void;
  clearAll: () => void;
  activeCount: number;                         // active filters + search (for badge)
}
export function useListControls<T>(rows: T[], columns: ListColumn<T>[],
  opts?: { defaultSortKey?: string; defaultSortDir?: 'asc' | 'desc' }): ListControlsState<T>
export function processRows<T>(rows: T[], columns: ListColumn<T>[], state: {
  sortKey: string | null; sortDir: 'asc' | 'desc'; search: string; filters: Record<string, string>;
}): T[]   // exported for tests

// app/components/ListControlsBar.tsx
export function ListControlsBar<T>(props: {
  columns: ListColumn<T>[];
  controls: ListControlsState<T>;
  searchPlaceholder?: string;
}): JSX.Element
```

- [ ] **Step 1: Write failing tests for `processRows`:**

```js
const columns = [
  { key: 'name', label: 'Name', accessor: (r) => r.name, sortable: true },
  { key: 'count', label: 'Actions', accessor: (r) => r.count, sortable: true },
  { key: 'status', label: 'Status', accessor: (r) => r.status, filterable: true },
];
const rows = [
  { name: 'beta', count: 10, status: 'ok' },
  { name: 'alpha', count: 200, status: 'ok' },
  { name: 'gamma', count: 3, status: 'failed' },
  { name: 'delta', count: null, status: 'ok' },
];
// sort string asc -> alpha,beta,delta,gamma ; numeric desc -> alpha(200),beta(10),gamma(3),delta(null LAST both dirs)
// search 'gam' -> [gamma] (case-insensitive substring, any searchable column)
// filters {status:'failed'} -> [gamma] ; filter + search compose (AND)
// no sortKey -> original order preserved
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement.**
  - `processRows`: filter by per-column equality (`String(accessor(row)) === value`), then search (lowercase substring over searchable columns — default searchable = every column unless `searchable: false`), then stable sort: both-null keep order, null always last, numbers compared numerically when both values are numbers (or numeric strings via `Number.isFinite(Number(v))` on both), else `String(a).localeCompare(String(b))`; `desc` negates.
  - `useListControls`: `useState` for each piece; `useMemo` over `processRows`; `setSort(key)` toggles dir when key unchanged, else sets key + `desc` default for numeric-looking columns? NO — keep simple: new key always starts `'asc'`.
  - `ListControlsBar`: one flex row, height-matched to existing filter selects (`bg-surface-tertiary border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs`, the select style from `app/identities/page.tsx:511`): `Search` icon + `<input>` (w-40), sort `<select>` (options = sortable columns, empty option "Sort…"), `ArrowUpDown` direction toggle button (only when sortKey set), one `<select>` per filterable column (first option = `All <label>`, options = distinct values from the UNPROCESSED rows, sorted), and an `X` clear-all button visible when `activeCount > 0`. All controls labeled via `aria-label`. Tokens only.

- [ ] **Step 4: Run tests** → PASS. `npm run typecheck`.

- [ ] **Step 5: Commit**: `feat(ui): useListControls hook + ListControlsBar`

---

### Task 8: /identities — cleanup button, bulk delete, show-test-agents toggle, sections

The worked example the rollout tasks copy.

**Files:**
- Modify: `app/identities/page.tsx`
- Test: extend the identities page test if one exists (Glob `__tests__/**/*identit*`); otherwise verification is Task 13's frontend-verify pass.

**Interfaces:**
- Consumes: `isSyntheticAgentId` (Task 1), `DELETE /api/actions?synthetic=true` / `?agent_ids=` (Task 3), `GET /api/agents?include_synthetic=true` (Task 4), `CollapsibleSection` (Task 6), `useListControls`/`ListControlsBar` (Task 7).

- [ ] **Step 1: Fetch the full fleet.** In `fetchAll` (page.tsx:101) change `fetch('/api/agents')` → `fetch('/api/agents?include_synthetic=true')` — this page is the management surface, so it always sees everything; visibility is a client-side toggle here (everywhere else stays clean by default).

- [ ] **Step 2: State + derived values:**

```ts
const [showTestAgents, setShowTestAgents] = useState(false);
const [cleaning, setCleaning] = useState(false);
const syntheticCount = unidentified.filter((a) => isSyntheticAgentId(a.agent_id)).length;
const visibleUnidentified = showTestAgents ? unidentified : unidentified.filter((a) => !isSyntheticAgentId(a.agent_id));
```

Feed `visibleUnidentified` to `useSelection`, the list render, and the count badge (replacing `unidentified` at page.tsx:258, 382-446, and the summary stat at 362).

- [ ] **Step 3: Cleanup + bulk-delete handlers:**

```ts
const handleCleanupTestAgents = async () => {
  if (!window.confirm(`Delete ${syntheticCount} test agents and ALL their recorded actions? The decisions ledger totals will shrink. This cannot be undone.`)) return;
  setCleaning(true);
  try {
    const res = await fetch('/api/actions?synthetic=true', { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Cleanup failed'); return; }
    showSuccess(`Deleted ${data.deleted} test-agent actions. Roster refreshed.`);
    await fetchAll();
  } catch { setError('Cleanup failed'); }
  finally { setCleaning(false); }
};

const handleBulkDeleteAgents = async () => {
  const ids = unidentifiedSelection.selectedIds;
  if (ids.length === 0) return;
  if (!window.confirm(`Delete ${ids.length} agent(s) and ALL their recorded actions? This cannot be undone.`)) return;
  const res = await fetch(`/api/actions?agent_ids=${encodeURIComponent(ids.join(','))}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { setError(data.error || 'Delete failed'); return; }
  showSuccess(`Deleted ${data.deleted} actions across ${ids.length} agent(s).`);
  unidentifiedSelection.clear();
  await fetchAll();
};
```

Add `{ id: 'delete', label: 'Delete', icon: Trash2, danger: true, onClick: handleBulkDeleteAgents }` to the unidentified section's `BulkActionBar` actions (page.tsx:395).

- [ ] **Step 4: Wrap the three sections in `CollapsibleSection`** (ids `identities.unidentified`, `identities.pending`, `identities.approved`), moving each existing header row's icon/title/count into the props and the checkbox + BulkActionBar into `actions`. Unidentified section header also gets, in `actions`:
  - the cleanup button (only when `isAdmin && syntheticCount > 0 && !demo`): `Trash2` icon, label `` `Clean up test agents (${syntheticCount})` ``, `danger`-styled like the BulkActionBar danger button, disabled while `cleaning` with label `Cleaning…`;
  - the toggle: a small labeled checkbox or pill button `Show test agents` flipping `showTestAgents` (shown whenever `syntheticCount > 0`).
  - Render the unidentified section when `unidentified.length > 0` (not `visibleUnidentified.length`), so the cleanup button remains reachable when all synthetic agents are hidden and only synthetic remain.

- [ ] **Step 5: List controls.** Add to the unidentified section (`controls` prop):

```ts
const unidentifiedColumns: ListColumn<UnidentifiedAgent>[] = [
  { key: 'agent', label: 'Agent', accessor: (a) => a.agent_name || a.agent_id, sortable: true },
  { key: 'actions', label: 'Actions', accessor: (a) => a.action_count, sortable: true },
  { key: 'last_active', label: 'Last active', accessor: (a) => a.last_active, sortable: true },
];
const unidentifiedControls = useListControls(visibleUnidentified, unidentifiedColumns, { defaultSortKey: 'actions', defaultSortDir: 'desc' });
```

Render `unidentifiedControls.rows`; pass `<ListControlsBar columns={unidentifiedColumns} controls={unidentifiedControls} searchPlaceholder="Search agents…" />`. Same pattern for approved identities (columns: agent sortable, permission filterable via `permission_level`, enrolled sortable via `created_at`). Pending pairings keeps no controls (short list, time-ordered).

NOTE: `useSelection` should receive the CONTROL-PROCESSED rows (`unidentifiedControls.rows`) so "select all" selects what's visible under the active filter.

- [ ] **Step 6: Verify locally.** `npm run typecheck` + `npx next build`. Then Task 13 drives the rendered page.

- [ ] **Step 7: Commit**: `feat(identities): test-agent cleanup, bulk delete, visibility toggle, list controls`

---

### Tasks 9-12: Site-wide rollout (2-3 pages per task, same recipe)

Each rollout task follows the identical recipe on its pages — Read the page first; every page differs in section markup but all follow the header-row + Card + divide-y list shape seen in identities:

1. Wrap each major section (`<h2>`-headed block) in `CollapsibleSection` with a stable id (`<page>.<section>`), moving icon/title/count/bulk-bar into props.
2. Where the section renders a client-side-complete list, add a `ListColumn[]` + `useListControls` + `ListControlsBar` (in `controls`), and render `controls.rows`. Feed processed rows to any `useSelection` on that list.
3. Server-paginated lists (decisions, audit-log): sort-only columns over the loaded page, keep every existing server-side filter dropdown untouched, and DO NOT add a search box that shadows an existing server-side search.
4. `npm run typecheck`; pages are under `app/**` so the build gate applies at push time.
5. One commit per task: `feat(ui): collapsible sections + list controls on <pages>`.

- [ ] **Task 9: /decisions + /approvals.**
  - `app/decisions/page.tsx`: section id `decisions.stream`. Sort columns: time (`timestamp_start`/`created_at` field — read the row shape first), risk (`risk_score`), agent (`agent_id`), status. Sort-only (rule 3) — the page already has 6 server-side filter dropdowns. Existing filter bar can live in `controls` alongside the sort control if it composes cleanly; otherwise leave the filter bar where it is and only add sort.
  - `app/approvals/page.*`: sections for pending/resolved queues (`approvals.pending`, `approvals.resolved`), columns: requested time sortable, agent sortable, risk sortable, status filterable (on the resolved list).

- [ ] **Task 10: /audit-log + /assumptions.**
  - `app/audit-log/page.*`: `audit.entries`; sort-only: time, actor, action; keep server filters.
  - `app/assumptions/page.*`: `assumptions.list` (plus per-status sections if the page already groups them): columns agent sortable, status filterable, created sortable.

- [ ] **Task 11: /sessions + /webhooks + /api-keys.**
  - `app/sessions/page.*`: `sessions.list`; agent sortable, started sortable, status filterable.
  - `app/webhooks/page.*`: `webhooks.destinations` (+ deliveries section if present); url/name sortable, event-type filterable, created sortable.
  - `app/api-keys/page.*`: `apikeys.list`; name sortable, created sortable, last-used sortable, role/scope filterable.

- [ ] **Task 12: /policies + /team-tasks.**
  - `app/policies/page.*`: this is the One-Ledger redesign surface (memory: `project_policies_redesign_one_ledger.md`) — wrap the ledger groups in `CollapsibleSection` only where it does not fight the existing grouping design; sort/filter on the rule list (name sortable, mode/status filterable). If a section already has its own bespoke collapse, leave it — no double-chrome.
  - `app/team-tasks/page.*` (route may be `/tasks` — Glob for it): sections per status lane if present; columns: title sortable, agent sortable, status filterable, updated sortable.

---

### Task 13: Verification gates + rendered proof

- [ ] **Step 1: Full gates** (delegate to the `dashclaw-gate-runner` subagent to keep logs out of context): `npm run lint`, `npm run typecheck`, `npx vitest run` (FULL suite), `npx next build`, `node scripts/check-doc-counts.mjs --strict`.

- [ ] **Step 2: DB safety drill on local data.** Local dev DB has real smoke rows. Boot dev server (per memory: `npx next build && npx next start -p 3001` if the dev-spawn panic bites), then via the frontend-verify skill / headless browser:
  - /identities renders; "Clean up test agents (N)" shows N > 0; global agent dropdown contains NO `smoke-*` entries (Task 4 proof).
  - Toggle "Show test agents" → smoke rows appear; select 2 → bulk Delete → count drops by 2.
  - Click cleanup button → confirm → success banner with deleted count; N goes to 0; /decisions totals drop.
  - Collapse a section, reload → stays collapsed (localStorage proof).
  - Every rollout page (approvals, decisions, audit-log, assumptions, sessions, webhooks, api-keys, policies, team-tasks) renders without console errors; sort dropdown reorders a list on at least 2 pages.

- [ ] **Step 3: Fix anything found, re-run the failing gate, commit.**

- [ ] **Step 4: Ship** is a separate step — run `/dashclaw-preship-sweep` then `dashclaw-ship` (version bump, CHANGELOG, docs realignment, push). A push is its own turn per repo rules.

---

## Self-review notes

- Spec coverage: A1→T1, A2→T2+T3, A3→T8, A4→T4(+T8 toggle), A5→T5, B1→T6, B2→T7, B3→T8-T12, testing→per-task+T13. Deviation (org-scoped sweep) recorded in Global Constraints.
- Type consistency: `ActionDeleteFilter.agentIds` (repo) ↔ `agent_ids` (query param) ↔ `handleBulkDeleteAgents` (UI); `ListColumn`/`ListControlsState` names match between T7 and T8-T12; `include_synthetic` param consistent T4↔T8.
- Known risk: `listAgentsForOrg` fake-sql tests must satisfy both template-tag and `.query` call styles (see the fakeSql helper in T2/T4).

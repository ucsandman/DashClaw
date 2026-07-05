# v4.6 Funnel Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hosted-trial activation funnel (mint → first key used → first governed action → retained week 1) that survives trial deletion, exposed at `GET /api/hosted/funnel` and rendered as a card on `/setup` in hosted mode.

**Architecture:** A new `hosted_trial_snapshots` table (no FK to `organizations`, deliberately) freezes each trial's funnel milestones inside `deleteHostedWorkspace` *before* the FK child sweep destroys the evidence — fail-closed. A repository function merges live-org facts (computed on the fly with the shared synthetic-exclusion patterns) with frozen snapshots; a pure `computeFunnelAggregates` function turns facts into the response shape so the math is unit-testable without a DB.

**Tech Stack:** Next.js 16 App Router, Neon/Postgres via tagged-template `sql`, drizzle schema + raw SQL migrations, vitest, `scripts/policy-smoke.mjs`.

Spec: `docs/superpowers/specs/2026-07-05-funnel-truth-design.md`.

## Global Constraints

- No direct SQL in route files or pages — repository functions only (`route-sql:check`).
- `guard_decisions.created_at` is TEXT on fresh schemas — always cast `::timestamptz` in SQL.
- Synthetic exclusion uses `SYNTHETIC_AGENT_LIKE_PATTERNS` / `SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS` from `app/lib/calibration-mining.js` with the `NOT LIKE ALL(${...}::text[])` idiom.
- A mint = `hosted_mode = TRUE AND trial_action_cap > 0` (cap-0 rows are `markTrialFull` capacity placeholders, never mints).
- Timestamps cross the SQL/JS boundary as epoch milliseconds (`(EXTRACT(EPOCH FROM …) * 1000)::float8`) — never parse pg text timestamps in JS.
- No hardcoded hex colors; use existing token classes on `/setup`.
- Response is aggregate-only: no org ids, slugs, or key prefixes.

---

### Task 1: Schema + migration

**Files:**
- Modify: `schema/schema.js` (append after `looseningProposalDecisions`)
- Create: `drizzle/0052_hosted_trial_snapshots.sql`

**Interfaces:**
- Produces: table `hosted_trial_snapshots(org_id text PK, minted_at timestamptz, deleted_at timestamptz, key_used bool, first_action_at timestamptz?, last_action_at timestamptz?, action_count int, retained_week1 bool)`.

- [ ] **Step 1: Add the drizzle table to `schema/schema.js`** (append near the other v4.x tables):

```js
// v4.6 funnel truth: frozen funnel milestones for hosted trial workspaces,
// written by deleteHostedWorkspace BEFORE the FK child sweep (which would
// otherwise destroy the evidence and undercount mints — survivorship bias).
// No FK to organizations, deliberately: the catalog-driven sweep deletes
// every row that references the org; this row must survive it.
export const hostedTrialSnapshots = pgTable('hosted_trial_snapshots', {
  orgId: text('org_id').primaryKey(),
  mintedAt: timestamp('minted_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  keyUsed: boolean('key_used').notNull().default(false),
  firstActionAt: timestamp('first_action_at', { withTimezone: true }),
  lastActionAt: timestamp('last_action_at', { withTimezone: true }),
  actionCount: integer('action_count').notNull().default(0),
  retainedWeek1: boolean('retained_week1').notNull().default(false),
});
```

- [ ] **Step 2: Create `drizzle/0052_hosted_trial_snapshots.sql`:**

```sql
-- v4.6 funnel truth: frozen funnel milestones for hosted trial workspaces.
-- deleteHostedWorkspace hard-deletes an expired trial org and every
-- FK-referencing child row; without this snapshot the activation funnel
-- (mint → first key used → first governed action → retained week 1)
-- undercounts mints as history is purged — survivorship bias. Deliberately
-- NO foreign key to organizations: the catalog-driven child sweep deletes
-- every referencing row, and this one must survive it. Written fail-closed
-- inside deleteHostedWorkspace before the child sweep.
CREATE TABLE IF NOT EXISTS "hosted_trial_snapshots" (
  "org_id" text PRIMARY KEY,
  "minted_at" timestamptz NOT NULL,
  "deleted_at" timestamptz NOT NULL DEFAULT now(),
  "key_used" boolean NOT NULL DEFAULT false,
  "first_action_at" timestamptz,
  "last_action_at" timestamptz,
  "action_count" integer NOT NULL DEFAULT 0,
  "retained_week1" boolean NOT NULL DEFAULT false
);
```

- [ ] **Step 3: Apply and verify**

Run: `npm run db:migrate`
Expected: applies 0052 without error (idempotent on re-run).

- [ ] **Step 4: Commit** — `feat(v4.6): hosted_trial_snapshots table (drizzle/0052)`

---

### Task 2: Repository — facts query, snapshot, fail-closed delete

**Files:**
- Modify: `app/lib/repositories/hosted-workspace.repository.ts`
- Test: `__tests__/unit/hosted-workspace-repository.test.ts` (new)

**Interfaces:**
- Consumes: `SYNTHETIC_AGENT_LIKE_PATTERNS`, `SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS` from `../calibration-mining.js`.
- Produces:
  - `type TrialFunnelFacts = { orgId: string; mintedAtMs: number; keyUsed: boolean; firstActionAtMs: number | null; lastActionAtMs: number | null; actionCount: number; frozenRetainedWeek1: boolean | null; archived: boolean }`
  - `queryLiveTrialFacts(sql, orgId: string | null): Promise<TrialFunnelFacts[]>`
  - `snapshotTrialFunnelFacts(sql, orgId): Promise<{ snapshotted: boolean }>`
  - `deleteHostedWorkspace` now snapshots before the child sweep and throws (aborting the delete) if the snapshot write fails.

- [ ] **Step 1: Add imports + facts query + snapshot to the repository.** At the top, add:

```ts
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../calibration-mining.js';
```

After `findExpiredWorkspaces`, add:

```ts
// ── v4.6 funnel truth ───────────────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-07-05-funnel-truth-design.md

const WEEK_MS = 7 * 86_400_000;

export type TrialFunnelFacts = {
  orgId: string;
  mintedAtMs: number;
  keyUsed: boolean;
  firstActionAtMs: number | null;
  lastActionAtMs: number | null;
  actionCount: number;
  /** Frozen at deletion time on archived rows; null on live rows (computed on read). */
  frozenRetainedWeek1: boolean | null;
  archived: boolean;
};

function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Funnel facts for live trial orgs (all when orgId is null, one otherwise).
 * A mint = hosted_mode AND trial_action_cap > 0 — cap-0 rows are
 * markTrialFull capacity placeholders that can never act, not mints.
 * Timestamps come back as epoch ms (float8): pg text timestamps are not
 * safely Date.parse-able, and guard_decisions.created_at is TEXT on fresh
 * schemas — hence the ::timestamptz casts.
 */
export async function queryLiveTrialFacts(
  sql: SqlTag,
  orgId: string | null,
): Promise<TrialFunnelFacts[]> {
  const rows = await sql`
    SELECT
      o.id AS org_id,
      (EXTRACT(EPOCH FROM COALESCE(o.created_at, NOW())::timestamptz) * 1000)::float8 AS minted_at_ms,
      EXISTS(
        SELECT 1 FROM api_keys k
        WHERE k.org_id = o.id AND k.last_used_at IS NOT NULL
      ) AS key_used,
      (EXTRACT(EPOCH FROM activity.first_action_at) * 1000)::float8 AS first_action_at_ms,
      (EXTRACT(EPOCH FROM activity.last_action_at) * 1000)::float8 AS last_action_at_ms,
      COALESCE(activity.action_count, 0)::int AS action_count
    FROM organizations o
    LEFT JOIN LATERAL (
      SELECT MIN(ts) AS first_action_at, MAX(ts) AS last_action_at, COUNT(*)::int AS action_count
      FROM (
        SELECT gd.created_at::timestamptz AS ts
        FROM guard_decisions gd
        WHERE gd.org_id = o.id
          AND (gd.action_type IS NULL OR gd.action_type NOT LIKE ALL(${SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS}::text[]))
          AND (gd.agent_id IS NULL OR gd.agent_id NOT LIKE ALL(${SYNTHETIC_AGENT_LIKE_PATTERNS}::text[]))
        UNION ALL
        SELECT ar.created_at::timestamptz AS ts
        FROM action_records ar
        WHERE ar.org_id = o.id
          AND (ar.action_type IS NULL OR ar.action_type NOT LIKE ALL(${SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS}::text[]))
          AND (ar.agent_id IS NULL OR ar.agent_id NOT LIKE ALL(${SYNTHETIC_AGENT_LIKE_PATTERNS}::text[]))
      ) evts
    ) activity ON TRUE
    WHERE o.hosted_mode = TRUE
      AND o.trial_action_cap > 0
      AND (${orgId}::text IS NULL OR o.id = ${orgId})
  `;
  return rows.map((r) => ({
    orgId: String(r.org_id),
    mintedAtMs: toMs(r.minted_at_ms) ?? 0,
    keyUsed: r.key_used === true,
    firstActionAtMs: toMs(r.first_action_at_ms),
    lastActionAtMs: toMs(r.last_action_at_ms),
    actionCount: Number(r.action_count) || 0,
    frozenRetainedWeek1: null,
    archived: false,
  }));
}

/**
 * Freeze a trial's funnel milestones before deletion destroys the evidence.
 * Returns snapshotted:false for cap-0 capacity placeholders (not mints).
 * Idempotent (ON CONFLICT DO NOTHING) so cleanup retries are safe.
 */
export async function snapshotTrialFunnelFacts(
  sql: SqlTag,
  orgId: string,
): Promise<{ snapshotted: boolean }> {
  const facts = await queryLiveTrialFacts(sql, orgId);
  const f = facts[0];
  if (!f) return { snapshotted: false };
  const retainedWeek1 =
    f.lastActionAtMs !== null && f.lastActionAtMs - f.mintedAtMs >= WEEK_MS;
  await sql`
    INSERT INTO hosted_trial_snapshots
      (org_id, minted_at, key_used, first_action_at, last_action_at, action_count, retained_week1)
    VALUES (
      ${orgId},
      to_timestamp(${f.mintedAtMs} / 1000.0),
      ${f.keyUsed},
      ${f.firstActionAtMs === null ? null : new Date(f.firstActionAtMs).toISOString()},
      ${f.lastActionAtMs === null ? null : new Date(f.lastActionAtMs).toISOString()},
      ${f.actionCount},
      ${retainedWeek1}
    )
    ON CONFLICT (org_id) DO NOTHING
  `;
  return { snapshotted: true };
}
```

- [ ] **Step 2: Wire the snapshot into `deleteHostedWorkspace`.** Immediately after the key-revoke `UPDATE api_keys ...` statement and before the `children` catalog query, insert:

```ts
  // v4.6 funnel truth: freeze this trial's funnel milestones BEFORE the FK
  // child sweep destroys the evidence. REQUIRED, not best-effort — a failed
  // snapshot throws and aborts the delete (the cleanup sweep retries next
  // run); a best-effort write would silently recreate the survivorship bias
  // this table exists to prevent. Keys are already revoked, so the workspace
  // stays dead either way.
  await snapshotTrialFunnelFacts(sql, orgId);
```

- [ ] **Step 3: Write the failing tests** — `__tests__/unit/hosted-workspace-repository.test.ts`, tagged-template mock style (mirrors `__tests__/unit/posture.repository.test.ts`):

```ts
/**
 * app/lib/repositories/hosted-workspace.repository.ts — v4.6 funnel truth:
 * live-facts SQL shape, snapshot-before-delete (fail-closed), cap-0 skip.
 * Spec: docs/superpowers/specs/2026-07-05-funnel-truth-design.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  queryLiveTrialFacts,
  snapshotTrialFunnelFacts,
  deleteHostedWorkspace,
} from '../../app/lib/repositories/hosted-workspace.repository';
import type { SqlTag } from '../../app/lib/types/db';

type Call = { text: string; values: unknown[] };

function makeSqlMock(responses: unknown[][], opts: { failOn?: (text: string) => boolean } = {}) {
  const queue = [...responses];
  const calls: Call[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    calls.push({ text, values });
    if (opts.failOn?.(text)) return Promise.reject(new Error('injected failure'));
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: Call[] };
  (fn as unknown as { calls: Call[] }).calls = calls;
  return fn;
}

beforeEach(() => vi.clearAllMocks());

const factsRow = {
  org_id: 'org_abc',
  minted_at_ms: 1_000,
  key_used: true,
  first_action_at_ms: 5_000,
  last_action_at_ms: 700_000_000, // ≥ 7 days after mint
  action_count: 42,
};

describe('queryLiveTrialFacts', () => {
  it('filters to real mints and excludes synthetic traffic in SQL', async () => {
    const sql = makeSqlMock([[factsRow]]);
    const facts = await queryLiveTrialFacts(sql, null);
    const { text } = (sql as any).calls[0];
    expect(text).toContain('hosted_mode = TRUE');
    expect(text).toContain('trial_action_cap > 0');
    expect(text).toContain('NOT LIKE ALL');
    expect(text).toContain('::timestamptz');
    expect(text).toContain('last_used_at IS NOT NULL');
    expect(facts).toEqual([{
      orgId: 'org_abc', mintedAtMs: 1000, keyUsed: true,
      firstActionAtMs: 5000, lastActionAtMs: 700_000_000,
      actionCount: 42, frozenRetainedWeek1: null, archived: false,
    }]);
  });

  it('coerces pg string numerics and null activity', async () => {
    const sql = makeSqlMock([[{
      org_id: 'org_x', minted_at_ms: '1000', key_used: false,
      first_action_at_ms: null, last_action_at_ms: null, action_count: '0',
    }]]);
    const [f] = await queryLiveTrialFacts(sql, 'org_x');
    expect(f).toMatchObject({ mintedAtMs: 1000, keyUsed: false, firstActionAtMs: null, actionCount: 0 });
  });
});

describe('snapshotTrialFunnelFacts', () => {
  it('inserts a frozen row with retained_week1 computed from last activity', async () => {
    const sql = makeSqlMock([[factsRow], []]);
    const r = await snapshotTrialFunnelFacts(sql, 'org_abc');
    expect(r.snapshotted).toBe(true);
    const insert = (sql as any).calls[1];
    expect(insert.text).toContain('INSERT INTO hosted_trial_snapshots');
    expect(insert.text).toContain('ON CONFLICT (org_id) DO NOTHING');
    // values: orgId, mintedAtMs, keyUsed, firstIso, lastIso, count, retained
    expect(insert.values[0]).toBe('org_abc');
    expect(insert.values[6]).toBe(true); // 700_000_000ms - 1000ms ≥ 7 days
  });

  it('skips cap-0 placeholders (no facts row → no insert)', async () => {
    const sql = makeSqlMock([[]]);
    const r = await snapshotTrialFunnelFacts(sql, 'org_full');
    expect(r.snapshotted).toBe(false);
    expect((sql as any).calls).toHaveLength(1);
  });
});

describe('deleteHostedWorkspace (v4.6 fail-closed snapshot)', () => {
  it('snapshots before the child sweep and before the org delete', async () => {
    const sql = makeSqlMock([
      [{ hosted_mode: true }], // existence check
      [],                      // revoke keys
      [factsRow],              // snapshot: facts
      [],                      // snapshot: insert
      [],                      // children catalog query
      [],                      // DELETE FROM organizations
    ]);
    (sql as any).query = vi.fn(async () => []);
    await deleteHostedWorkspace(sql, 'org_abc');
    const texts = (sql as any).calls.map((c: Call) => c.text);
    const snapIdx = texts.findIndex((t: string) => t.includes('INSERT INTO hosted_trial_snapshots'));
    const orgDeleteIdx = texts.findIndex((t: string) => t.includes('DELETE FROM organizations'));
    expect(snapIdx).toBeGreaterThan(-1);
    expect(orgDeleteIdx).toBeGreaterThan(snapIdx);
  });

  it('aborts the delete when the snapshot write fails', async () => {
    const sql = makeSqlMock(
      [[{ hosted_mode: true }], [], [factsRow]],
      { failOn: (t) => t.includes('INSERT INTO hosted_trial_snapshots') },
    );
    (sql as any).query = vi.fn(async () => []);
    await expect(deleteHostedWorkspace(sql, 'org_abc')).rejects.toThrow('injected failure');
    const texts = (sql as any).calls.map((c: Call) => c.text);
    expect(texts.some((t: string) => t.includes('DELETE FROM organizations'))).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests** — `npx vitest run __tests__/unit/hosted-workspace-repository.test.ts`. Expected: all pass (Step 1/2 already implemented; if any fail, fix the implementation, not the assertion intent).
- [ ] **Step 5: Commit** — `feat(v4.6): trial funnel facts + fail-closed snapshot-before-delete`

---

### Task 3: Repository — aggregates + `getTrialFunnel`

**Files:**
- Modify: `app/lib/repositories/hosted-workspace.repository.ts`
- Test: extend `__tests__/unit/hosted-workspace-repository.test.ts`

**Interfaces:**
- Produces:
  - `type TrialFunnel = { computedAt: string; funnel: { minted; keyUsed; firstAction; retainedWeek1; week1Eligible; week1Pending }; medianHoursToFirstAction: number | null; cohorts: Array<{ weekStart: string; minted; keyUsed; firstAction; retainedWeek1; week1Eligible }>; source: { live: number; archived: number; truthfulSince: string | null } }`
  - `computeFunnelAggregates(facts: TrialFunnelFacts[], now: Date): TrialFunnel` (pure)
  - `getTrialFunnel(sql, { now }?): Promise<TrialFunnel>`

- [ ] **Step 1: Add to the repository** (below the Task-2 block):

```ts
export type TrialFunnelCounts = {
  minted: number;
  keyUsed: number;
  firstAction: number;
  retainedWeek1: number;
  week1Eligible: number;
};

export type TrialFunnel = {
  computedAt: string;
  funnel: TrialFunnelCounts & { week1Pending: number };
  medianHoursToFirstAction: number | null;
  cohorts: Array<TrialFunnelCounts & { weekStart: string }>;
  source: { live: number; archived: number; truthfulSince: string | null };
};

function weekStartUtc(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
    .toISOString()
    .slice(0, 10);
}

/**
 * Pure funnel math over merged live + archived facts. Truthful zeros: an
 * org younger than 7 days is week1Pending, never counted as not-retained.
 * Archived rows use the retained_week1 boolean frozen at deletion time.
 */
export function computeFunnelAggregates(facts: TrialFunnelFacts[], now: Date): TrialFunnel {
  const nowMs = now.getTime();
  const isEligible = (f: TrialFunnelFacts) => nowMs - f.mintedAtMs >= WEEK_MS;
  const isRetained = (f: TrialFunnelFacts) =>
    f.archived
      ? f.frozenRetainedWeek1 === true
      : isEligible(f) && f.lastActionAtMs !== null && f.lastActionAtMs - f.mintedAtMs >= WEEK_MS;
  const count = (list: TrialFunnelFacts[]): TrialFunnelCounts => ({
    minted: list.length,
    keyUsed: list.filter((f) => f.keyUsed).length,
    firstAction: list.filter((f) => f.firstActionAtMs !== null).length,
    retainedWeek1: list.filter(isRetained).length,
    week1Eligible: list.filter(isEligible).length,
  });

  const overall = count(facts);
  const deltas = facts
    .filter((f) => f.firstActionAtMs !== null)
    .map((f) => ((f.firstActionAtMs as number) - f.mintedAtMs) / 3_600_000)
    .sort((a, b) => a - b);
  const median =
    deltas.length === 0
      ? null
      : deltas.length % 2 === 1
        ? deltas[(deltas.length - 1) / 2]!
        : (deltas[deltas.length / 2 - 1]! + deltas[deltas.length / 2]!) / 2;

  const byWeek = new Map<string, TrialFunnelFacts[]>();
  for (const f of facts) {
    const ws = weekStartUtc(f.mintedAtMs);
    const list = byWeek.get(ws) ?? [];
    list.push(f);
    byWeek.set(ws, list);
  }
  const cohorts = [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 8)
    .map(([weekStart, list]) => ({ weekStart, ...count(list) }));

  return {
    computedAt: now.toISOString(),
    funnel: { ...overall, week1Pending: overall.minted - overall.week1Eligible },
    medianHoursToFirstAction: median === null ? null : Math.round(median * 10) / 10,
    cohorts,
    source: {
      live: facts.filter((f) => !f.archived).length,
      archived: facts.filter((f) => f.archived).length,
      truthfulSince: facts.length
        ? new Date(Math.min(...facts.map((f) => f.mintedAtMs))).toISOString()
        : null,
    },
  };
}

async function querySnapshotFacts(sql: SqlTag): Promise<TrialFunnelFacts[]> {
  const rows = await sql`
    SELECT
      org_id,
      (EXTRACT(EPOCH FROM minted_at) * 1000)::float8 AS minted_at_ms,
      key_used,
      (EXTRACT(EPOCH FROM first_action_at) * 1000)::float8 AS first_action_at_ms,
      (EXTRACT(EPOCH FROM last_action_at) * 1000)::float8 AS last_action_at_ms,
      action_count,
      retained_week1
    FROM hosted_trial_snapshots
  `;
  return rows.map((r) => ({
    orgId: String(r.org_id),
    mintedAtMs: toMs(r.minted_at_ms) ?? 0,
    keyUsed: r.key_used === true,
    firstActionAtMs: toMs(r.first_action_at_ms),
    lastActionAtMs: toMs(r.last_action_at_ms),
    actionCount: Number(r.action_count) || 0,
    frozenRetainedWeek1: r.retained_week1 === true,
    archived: true,
  }));
}

/** Live trial orgs + deletion-time snapshots, aggregated. Aggregate-only: no org ids leave this function. */
export async function getTrialFunnel(
  sql: SqlTag,
  { now = new Date() }: { now?: Date } = {},
): Promise<TrialFunnel> {
  const live = await queryLiveTrialFacts(sql, null);
  const archived = await querySnapshotFacts(sql);
  return computeFunnelAggregates([...live, ...archived], now);
}
```

- [ ] **Step 2: Add the math tests** (same test file):

```ts
import { computeFunnelAggregates, getTrialFunnel } from '../../app/lib/repositories/hosted-workspace.repository';
// (merge into the existing import statement)

const DAY = 86_400_000;
const NOW = new Date('2026-07-05T00:00:00.000Z');
const mk = (over: Partial<import('../../app/lib/repositories/hosted-workspace.repository').TrialFunnelFacts>) => ({
  orgId: 'org_1', mintedAtMs: NOW.getTime() - 10 * DAY, keyUsed: false,
  firstActionAtMs: null, lastActionAtMs: null, actionCount: 0,
  frozenRetainedWeek1: null, archived: false, ...over,
});

describe('computeFunnelAggregates', () => {
  it('returns truthful zeros on no facts', () => {
    const agg = computeFunnelAggregates([], NOW);
    expect(agg.funnel).toEqual({ minted: 0, keyUsed: 0, firstAction: 0, retainedWeek1: 0, week1Eligible: 0, week1Pending: 0 });
    expect(agg.medianHoursToFirstAction).toBeNull();
    expect(agg.cohorts).toEqual([]);
    expect(agg.source).toEqual({ live: 0, archived: 0, truthfulSince: null });
  });

  it('a young org is week1Pending, never not-retained', () => {
    const agg = computeFunnelAggregates([mk({ mintedAtMs: NOW.getTime() - 2 * DAY })], NOW);
    expect(agg.funnel.week1Eligible).toBe(0);
    expect(agg.funnel.week1Pending).toBe(1);
    expect(agg.funnel.retainedWeek1).toBe(0);
  });

  it('retention: eligible + activity ≥7d after mint = retained; eligible without = not', () => {
    const minted = NOW.getTime() - 10 * DAY;
    const agg = computeFunnelAggregates([
      mk({ orgId: 'a', mintedAtMs: minted, lastActionAtMs: minted + 8 * DAY, firstActionAtMs: minted + DAY, keyUsed: true }),
      mk({ orgId: 'b', mintedAtMs: minted, lastActionAtMs: minted + 2 * DAY, firstActionAtMs: minted + 2 * DAY }),
    ], NOW);
    expect(agg.funnel).toMatchObject({ minted: 2, keyUsed: 1, firstAction: 2, retainedWeek1: 1, week1Eligible: 2, week1Pending: 0 });
  });

  it('archived rows use the frozen retained_week1 verdict', () => {
    const agg = computeFunnelAggregates([
      mk({ orgId: 'a', archived: true, frozenRetainedWeek1: true, mintedAtMs: NOW.getTime() - 40 * DAY }),
      mk({ orgId: 'b', archived: true, frozenRetainedWeek1: false, mintedAtMs: NOW.getTime() - 40 * DAY, lastActionAtMs: NOW.getTime() - 1 * DAY }),
    ], NOW);
    expect(agg.funnel.retainedWeek1).toBe(1);
    expect(agg.source).toMatchObject({ live: 0, archived: 2 });
  });

  it('median hours to first action (even count → average of middles, 1dp)', () => {
    const minted = NOW.getTime() - 10 * DAY;
    const agg = computeFunnelAggregates([
      mk({ orgId: 'a', mintedAtMs: minted, firstActionAtMs: minted + 3_600_000 }),
      mk({ orgId: 'b', mintedAtMs: minted, firstActionAtMs: minted + 2 * 3_600_000 }),
    ], NOW);
    expect(agg.medianHoursToFirstAction).toBe(1.5);
  });

  it('cohorts group by UTC Monday mint week, newest first, max 8', () => {
    const facts = Array.from({ length: 10 }, (_, i) =>
      mk({ orgId: `o${i}`, mintedAtMs: NOW.getTime() - i * 7 * DAY }));
    const agg = computeFunnelAggregates(facts, NOW);
    expect(agg.cohorts).toHaveLength(8);
    expect(agg.cohorts[0]!.weekStart > agg.cohorts[1]!.weekStart).toBe(true);
    expect(agg.cohorts.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.weekStart))).toBe(true);
  });

  it('truthfulSince is the earliest mint across live + archived', () => {
    const agg = computeFunnelAggregates([
      mk({ mintedAtMs: Date.parse('2026-07-01T00:00:00Z') }),
      mk({ orgId: 'o2', archived: true, frozenRetainedWeek1: false, mintedAtMs: Date.parse('2026-06-01T00:00:00Z') }),
    ], NOW);
    expect(agg.source.truthfulSince).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('getTrialFunnel', () => {
  it('merges live facts with snapshot facts', async () => {
    const sql = makeSqlMock([
      [factsRow],                                 // live
      [{ org_id: 'org_gone', minted_at_ms: 1000, key_used: true,
         first_action_at_ms: 2000, last_action_at_ms: 3000,
         action_count: 5, retained_week1: true }], // snapshots
    ]);
    const agg = await getTrialFunnel(sql, { now: NOW });
    expect(agg.funnel.minted).toBe(2);
    expect(agg.source).toMatchObject({ live: 1, archived: 1 });
  });
});
```

- [ ] **Step 3: Run** — `npx vitest run __tests__/unit/hosted-workspace-repository.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit** — `feat(v4.6): getTrialFunnel — live + archived facts, pure aggregate math`

---

### Task 4: `GET /api/hosted/funnel`

**Files:**
- Create: `app/api/hosted/funnel/route.ts`
- Test: `__tests__/unit/hosted-funnel-route.test.ts` (new)

**Interfaces:**
- Consumes: `getTrialFunnel` (Task 3), `isHostedMode` (`app/lib/hosted/flag`).
- Produces: `GET /api/hosted/funnel` → 404 `{error:'Not found'}` when hosted off; else 200 `{ hosted: true, ...TrialFunnel }`.

- [ ] **Step 1: Create the route** (capacity-route precedent — hosted-mode gate, aggregate-only, no further auth; the spec records why):

```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../lib/hosted/flag';
import { getTrialFunnel } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';

// v4.6 funnel truth: the trial activation funnel, aggregate-only (no org
// ids, slugs, or key prefixes ever leave the repository). Same exposure
// class and gate as /api/hosted/capacity — see the spec's design decisions.
export async function GET() {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const funnel = await getTrialFunnel(getSql());
  return NextResponse.json({ hosted: true, ...funnel });
}
```

- [ ] **Step 2: Route test** — `__tests__/unit/hosted-funnel-route.test.ts`:

```ts
/** GET /api/hosted/funnel — hosted-mode gate + aggregate passthrough (v4.6). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsHostedMode, mockGetTrialFunnel } = vi.hoisted(() => ({
  mockIsHostedMode: vi.fn(),
  mockGetTrialFunnel: vi.fn(),
}));
vi.mock('@/lib/hosted/flag', () => ({ isHostedMode: mockIsHostedMode }));
vi.mock('@/lib/repositories/hosted-workspace.repository', () => ({ getTrialFunnel: mockGetTrialFunnel }));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

import { GET } from '../../app/api/hosted/funnel/route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/hosted/funnel', () => {
  it('404s when hosted mode is off', async () => {
    mockIsHostedMode.mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(mockGetTrialFunnel).not.toHaveBeenCalled();
  });

  it('returns the aggregate funnel when hosted mode is on', async () => {
    mockIsHostedMode.mockReturnValue(true);
    mockGetTrialFunnel.mockResolvedValue({
      computedAt: 'x', funnel: { minted: 0, keyUsed: 0, firstAction: 0, retainedWeek1: 0, week1Eligible: 0, week1Pending: 0 },
      medianHoursToFirstAction: null, cohorts: [], source: { live: 0, archived: 0, truthfulSince: null },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hosted).toBe(true);
    expect(body.funnel.minted).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/org_/);
  });
});
```

Note: if the repo's vitest aliases don't resolve `@/lib/...` for these mocks, mirror the exact `vi.mock` specifiers used in `__tests__/unit/policy-tuning-repository.test.ts` (they use `@/lib/...`) — keep specifiers consistent with what the route file imports after alias resolution.

- [ ] **Step 3: Run** — `npx vitest run __tests__/unit/hosted-funnel-route.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit** — `feat(v4.6): GET /api/hosted/funnel (hosted-gated, aggregate-only)`

---

### Task 5: `/setup` funnel card

**Files:**
- Modify: `app/setup/page.tsx`

**Interfaces:**
- Consumes: `isHostedMode`, `getTrialFunnel`, `TrialFunnel` type, `getSql` (already imported in the page).

- [ ] **Step 1: Imports + data fetch.** Add imports:

```ts
import { isHostedMode } from '../lib/hosted/flag';
import { getTrialFunnel, type TrialFunnel } from '../lib/repositories/hosted-workspace.repository';
```

In `SetupPage`, after the existing `Promise.all` block, add (error rendered, never swallowed — the canary-card norm):

```ts
  // v4.6 funnel truth: the trial activation funnel, hosted instances only.
  // Aggregate-only; an error renders as an error line, never silence.
  let trialFunnel: TrialFunnel | null = null;
  let trialFunnelError = false;
  if (isHostedMode()) {
    try {
      trialFunnel = await getTrialFunnel(getSql());
    } catch (err) {
      trialFunnelError = true;
      console.error('[setup] trial funnel query failed:', err);
    }
  }
```

- [ ] **Step 2: Render the card.** Immediately after the "Enforcement posture" `</article>` (before the `view.sections.map(...)` cards), add:

```tsx
          {isHostedMode() ? (
            <article className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-primary">Trial activation funnel</h2>
                {trialFunnel?.source.truthfulSince ? (
                  <span className="text-xs text-secondary">
                    evidence since {new Date(trialFunnel.source.truthfulSince).toISOString().slice(0, 10)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-secondary">
                Mint → first key used → first governed action → retained week 1, computed
                from this instance&apos;s ledgers. Expired trials keep counting through
                deletion-time snapshots{trialFunnel ? ` (${trialFunnel.source.archived} archived)` : ''}.
              </p>
              {trialFunnelError ? (
                <p className="mt-4 text-sm text-error">
                  Funnel query failed. The exact database error is in server logs.
                </p>
              ) : trialFunnel ? (
                <>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                    {[
                      { label: 'Minted', value: trialFunnel.funnel.minted, of: null },
                      { label: 'First key used', value: trialFunnel.funnel.keyUsed, of: trialFunnel.funnel.minted },
                      { label: 'First governed action', value: trialFunnel.funnel.firstAction, of: trialFunnel.funnel.minted },
                      { label: 'Retained week 1', value: trialFunnel.funnel.retainedWeek1, of: trialFunnel.funnel.week1Eligible },
                    ].map((step) => (
                      <div key={step.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <dt className="text-xs uppercase tracking-wide text-secondary">{step.label}</dt>
                        <dd className="mt-1 text-2xl font-semibold text-primary">{step.value}</dd>
                        <dd className="text-xs text-secondary">
                          {step.of === null ? ' ' : step.of > 0 ? `${Math.round((step.value / step.of) * 100)}% of ${step.of}` : 'no eligible orgs yet'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 space-y-1 text-xs text-secondary">
                    {trialFunnel.funnel.week1Pending > 0 ? (
                      <p>{trialFunnel.funnel.week1Pending} workspace{trialFunnel.funnel.week1Pending === 1 ? '' : 's'} minted less than 7 days ago — too young to judge retention.</p>
                    ) : null}
                    {trialFunnel.medianHoursToFirstAction !== null ? (
                      <p>Median time to first governed action: {trialFunnel.medianHoursToFirstAction}h.</p>
                    ) : null}
                  </div>
                  {trialFunnel.cohorts.length > 0 ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-secondary">
                            <th className="py-1 pr-3 font-medium">Mint week</th>
                            <th className="py-1 pr-3 font-medium">Minted</th>
                            <th className="py-1 pr-3 font-medium">Key used</th>
                            <th className="py-1 pr-3 font-medium">First action</th>
                            <th className="py-1 pr-3 font-medium">Retained wk1</th>
                          </tr>
                        </thead>
                        <tbody className="text-primary">
                          {trialFunnel.cohorts.map((c) => (
                            <tr key={c.weekStart} className="border-t border-white/10">
                              <td className="py-1 pr-3">{c.weekStart}</td>
                              <td className="py-1 pr-3">{c.minted}</td>
                              <td className="py-1 pr-3">{c.keyUsed}</td>
                              <td className="py-1 pr-3">{c.firstAction}</td>
                              <td className="py-1 pr-3">{c.week1Eligible > 0 ? `${c.retainedWeek1}/${c.week1Eligible}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          ) : null}
```

- [ ] **Step 3: Build gate** — `npx next build`. Expected: compiles; `/setup` still prerenders/renders dynamically without error.
- [ ] **Step 4: Rendered proof** — with `DASHCLAW_HOSTED=true` via `next start -p 3001` (dev server spawn-panic workaround), verify `/setup` shows the card (frontend-verify skill); with it unset, verify the card is absent.
- [ ] **Step 5: Commit** — `feat(v4.6): trial activation funnel card on /setup (hosted mode)`

---

### Task 6: Smoke section AA

**Files:**
- Modify: `scripts/policy-smoke.mjs` (after the Z5 block closes, before the `// cleanup` comment)

- [ ] **Step 1: Add the AA check** (mode-aware so it passes on local hosted-off AND a hosted instance):

```js
  // ---------------------------------------------------------------- AA ----
  // v4.6 funnel truth. Hosted-off instances must 404 the funnel (the gate);
  // hosted-on instances must serve the aggregate shape with no org ids.
  // The funnel MATH is pinned by vitest, not smoke: flipping DASHCLAW_HOSTED
  // means restarting the server mid-run (v4.4 precedent for non-live-smokeable).
  console.log('\nAA. v4.6 funnel truth...');
  {
    const cap = await api('GET', '/api/hosted/capacity');
    const fun = await api('GET', '/api/hosted/funnel');
    if (cap.status === 404) {
      check('AA1', 'hosted off: GET /api/hosted/funnel is gated (404)',
        fun.status === 404, `capacity=${cap.status} funnel=${fun.status}`);
    } else {
      check('AA1', 'hosted on: funnel serves aggregate shape with no org ids',
        fun.status === 200
          && fun.json?.hosted === true
          && typeof fun.json?.funnel?.minted === 'number'
          && !JSON.stringify(fun.json).includes('org_'),
        `funnel=${fun.status} minted=${fun.json?.funnel?.minted}`);
    }
  }
```

- [ ] **Step 2: Run smoke locally** — `node scripts/policy-smoke.mjs` against the local instance. Expected: `AA1 PASS` (hosted-off branch) and total checks 113 → 114 all passing.
- [ ] **Step 3: Commit** — `test(v4.6): smoke AA1 — funnel hosted gate / aggregate shape`

---

### Task 7: Full gates

- [ ] `npm run lint` — clean.
- [ ] `npm run typecheck` — clean (repository + route + page are `.ts`/`.tsx`).
- [ ] `npx vitest run` — FULL suite, no regressions.
- [ ] `npx next build` — required (`app/**` changed).
- [ ] `node scripts/policy-smoke.mjs` — 114/114.
- [ ] Ship via `dashclaw-preship-sweep` → `dashclaw-ship` (version bump, doc counts — route total 331 → 332 — maintainer log, CHANGELOG, roadmap status line, livingcode regeneration).

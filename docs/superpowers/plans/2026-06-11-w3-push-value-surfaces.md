# W3 Push-Value Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the interruption budget / approval flood guard, the fleet digest pushed through notification adapters, and two new signal types, per `docs/superpowers/specs/2026-06-11-w3-push-value-surfaces-design.md`.

**Architecture:** A new `app/lib/approval-flood.ts` evaluates per-policy/fleet approval rates (data: `guard_decisions.matched_policies`) against org-setting budgets, stores tripped state in a settings-key marker, and gates the existing per-action Discord/Telegram prompts inside `fireApprovalSurfaces`. Flood events and the daily digest deliver through the existing `deliverNativeNotifications` adapter fan-out. Digest cadence uses the drift-tick claimed-marker pattern, piggybacked on `POST /api/actions` via `after()`. Three new routes: `GET /api/approvals/floods`, `POST /api/approvals/bulk`, `GET /api/digest/fleet`.

**Tech Stack:** Next.js 16 App Router routes (TS), repository pattern (no SQL in routes), vitest, existing notification adapters.

**Resolved spec questions (owner approved):** budgets 10/15min per policy + 30 fleet-wide; digest default-on at 24h when adapter creds exist (no creds → no-op); pause-rule leaves pending actions pending.

**Deliberate deviations from the spec (smaller, same goals):**
1. The flood event notifies via `deliverNativeNotifications` only. Discord/Telegram approval-bridge users get the budgeted per-action prompts (≤10) then silence + dashboard banner; the bridges have no plain-message transport and building one is out of scope.
2. `coverage_drop` = coverage < 90% with ≥ 50 actions in the 7d window (no prior-window comparison); the cron's signal-hash dedup prevents repeats.
3. Bulk resolution filters pending actions by the flooding policy's `action_types` + a time window (`guard_decisions` has no `action_id` column to join on). `protected_path` floods return 400 (path floods are rare; resolve those from /approvals manually).

**Key existing interfaces (verified against source):**
- `fireApprovalSurfaces(createdAction, sql, orgId, guardDecision)` — `app/lib/approvalSurfaces.ts:35` (sync, uses `after()`); `POST /api/actions` route.ts:368-376 currently has an identical inline copy.
- `deliverNativeNotifications(orgId, signals: GovernanceSignal[], settings: SettingRow[], sql?)` — `app/lib/notification-adapters/index.ts:64`; settings come from `getSettings(sql, orgId, { category: 'integration' })`.
- `GovernanceSignal { severity, label, detail, agent_id?, help? }`.
- `recordApproval(sql, orgId, actionId, { newStatus, errorMessage, decision, userId, safeReasoning })`, `getActionSummary`, `clearApprovalNotifications(sql, { orgId, actionId, decision, resolvedBy, resolvedVia })`, `fireWebhooksForApproval` — see `app/api/approvals/[actionId]/route.ts` for the canonical resolution sequence.
- `upsertSetting(sql, orgId, { key, value, category })` validates against `VALID_SETTING_KEYS` (`app/lib/repositories/settings.repository.ts:8-83`).
- Drift-tick marker pattern: `app/lib/drift-tick.ts:41-73` (read marker → debounce → claim-before-run).
- `computeSignals(orgId, filterAgentId, sql)` — `app/lib/signals.ts`; cron dedup `hashSignal` in `app/api/cron/signals/route.ts:19-47`.
- Numeric org-setting read pattern: `app/lib/signals.ts:50-59`.
- Admin-gate pattern: `app/api/policies/review/verdict/route.ts:28-31` (`getOrgId` + `getOrgRole !== 'admin'` → 403).

---

## Phase 1 — Flood guard

### Task 1: Settings keys + flood repository queries

**Files:**
- Modify: `app/lib/repositories/settings.repository.ts` (VALID_SETTING_KEYS array, lines 8-83)
- Modify: `app/lib/repositories/guardrails.repository.ts` (append two functions)
- Test: `__tests__/unit/approval-flood.repository.test.js` (new)

- [ ] **Step 1: Add the new setting keys**

In `settings.repository.ts`, append to `VALID_SETTING_KEYS` (keep the array's existing grouping style, add a comment block):

```js
  // W3 interruption budget / digest (close-the-loop spec 2026-06-11)
  'DASHCLAW_INTERRUPT_BUDGET',
  'DASHCLAW_INTERRUPT_WINDOW_MIN',
  'DASHCLAW_INTERRUPT_BUDGET_FLEET',
  'APPROVAL_FLOOD_STATE',
  'DASHCLAW_DIGEST_INTERVAL_HOURS',
  'DIGEST_TICK_LAST_RUN_AT',
```

- [ ] **Step 2: Write failing tests for the two new repository functions**

```js
// __tests__/unit/approval-flood.repository.test.js
import { describe, it, expect, vi } from 'vitest';
import { getRecentApprovalCountsByPolicy, getPolicyNamesByIds } from '../../app/lib/repositories/guardrails.repository';

function mockSql(rows) {
  const fn = vi.fn(async () => rows);
  fn.query = vi.fn(async () => rows);
  return fn;
}

describe('getRecentApprovalCountsByPolicy', () => {
  it('returns a policy_id → count map from require_approval decisions in the window', async () => {
    const sql = mockSql([
      { policy_id: 'gp_a', cnt: 47 },
      { policy_id: 'gp_b', cnt: 3 },
    ]);
    const counts = await getRecentApprovalCountsByPolicy(sql, 'org1', 15);
    expect(counts).toEqual({ gp_a: 47, gp_b: 3 });
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain("decision = 'require_approval'");
    expect(text).toContain('make_interval(mins =>');
    expect(sql.query.mock.calls[0][1]).toEqual(['org1', 15]);
  });
});

describe('getPolicyNamesByIds', () => {
  it('returns id → name for the requested policies only', async () => {
    const sql = mockSql([{ id: 'gp_a', name: '[Tightened] other' }]);
    const names = await getPolicyNamesByIds(sql, 'org1', ['gp_a', 'gp_missing']);
    expect(names).toEqual({ gp_a: '[Tightened] other' });
  });
  it('returns {} for an empty id list without querying', async () => {
    const sql = mockSql([]);
    expect(await getPolicyNamesByIds(sql, 'org1', [])).toEqual({});
    expect(sql.query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run __tests__/unit/approval-flood.repository.test.js`
Expected: FAIL — functions not exported.

- [ ] **Step 4: Implement in `guardrails.repository.ts`**

Mirror `getDecisionCountsByPolicy` (same file, lines ~178-205) exactly in style:

```ts
/**
 * require_approval decision counts per matched policy inside a short window
 * (minutes). Drives the W3 interruption budget / approval flood guard.
 */
export async function getRecentApprovalCountsByPolicy(
  sql: SqlClient,
  orgId: string,
  windowMinutes = 15,
): Promise<Record<string, number>> {
  const rows = await sql.query(
    `SELECT sub.policy_id AS policy_id, COUNT(*)::int AS cnt
     FROM (
       SELECT jsonb_array_elements_text(matched_policies::jsonb) AS policy_id
       FROM guard_decisions
       WHERE org_id = $1
         AND decision = 'require_approval'
         AND created_at::timestamptz > NOW() - make_interval(mins => $2::int)
         AND matched_policies IS NOT NULL
         AND matched_policies LIKE '[%'
     ) sub
     GROUP BY sub.policy_id`,
    [orgId, windowMinutes],
  );
  const out: Record<string, number> = {};
  for (const r of rows as Array<{ policy_id: string; cnt: number }>) {
    out[r.policy_id] = Number(r.cnt) || 0;
  }
  return out;
}

/** id → name for a bounded set of guard policies (flood labels). */
export async function getPolicyNamesByIds(
  sql: SqlClient,
  orgId: string,
  ids: string[],
): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await sql.query(
    `SELECT id, name FROM guard_policies WHERE org_id = $1 AND id = ANY($2) LIMIT 100`,
    [orgId, ids],
  );
  const out: Record<string, string> = {};
  for (const r of rows as Array<{ id: string; name: string }>) out[r.id] = r.name;
  return out;
}
```

(Confirm the policies table is named `guard_policies` by checking an existing query in the same file — `insertPolicy` uses it; if it differs, match the file.)

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run __tests__/unit/approval-flood.repository.test.js` → PASS. Also `npx vitest run __tests__/unit/settings.repository.test.js` if it exists (key-allowlist tests may enumerate keys).

- [ ] **Step 6: Commit**

```bash
git add app/lib/repositories/settings.repository.ts app/lib/repositories/guardrails.repository.ts __tests__/unit/approval-flood.repository.test.js
git commit -m "feat(flood): settings keys + approval-rate repository queries for interruption budget"
```

### Task 2: `app/lib/approval-flood.ts` — budgets, state, evaluation

**Files:**
- Create: `app/lib/approval-flood.ts`
- Test: `__tests__/unit/approval-flood.test.js` (new)

- [ ] **Step 1: Write failing tests**

```js
// __tests__/unit/approval-flood.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings, mockUpsert, mockCounts } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpsert: vi.fn(),
  mockCounts: vi.fn(),
}));
vi.mock('../../app/lib/repositories/settings.repository', () => ({
  getSettings: mockGetSettings,
  upsertSetting: mockUpsert,
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({
  getRecentApprovalCountsByPolicy: mockCounts,
  getPolicyNamesByIds: vi.fn(async () => ({})),
}));

import { evaluateApprovalFlood, getInterruptBudget, FLEET_KEY } from '../../app/lib/approval-flood';

const sql = {};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue([]); // no overrides, no prior state
  mockUpsert.mockResolvedValue(undefined);
});

describe('getInterruptBudget', () => {
  it('returns defaults 10/15/30 when no settings exist', async () => {
    expect(await getInterruptBudget(sql, 'org1')).toEqual({ perPolicy: 10, windowMin: 15, fleetWide: 30 });
  });
  it('honors org-setting overrides', async () => {
    mockGetSettings.mockResolvedValue([
      { key: 'DASHCLAW_INTERRUPT_BUDGET', value: '5' },
      { key: 'DASHCLAW_INTERRUPT_WINDOW_MIN', value: '10' },
    ]);
    expect(await getInterruptBudget(sql, 'org1')).toEqual({ perPolicy: 5, windowMin: 10, fleetWide: 30 });
  });
});

describe('evaluateApprovalFlood', () => {
  it('trips a policy over budget, persists state, reports it newly tripped', async () => {
    mockCounts.mockResolvedValue({ gp_a: 47, gp_b: 2 });
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.newlyTripped.map((t) => t.policy_id)).toContain('gp_a');
    expect(r.suppressed.has('gp_a')).toBe(true);
    expect(r.suppressed.has('gp_b')).toBe(false);
    expect(r.fleetTripped).toBe(true); // 49 > 30 fleet budget
    const written = JSON.parse(mockUpsert.mock.calls.at(-1)[2].value);
    expect(written.gp_a.count).toBe(47);
  });

  it('does not re-report an already-tripped policy', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) =>
      filter.key === 'APPROVAL_FLOOD_STATE'
        ? [{ key: 'APPROVAL_FLOOD_STATE', value: JSON.stringify({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 40 } }) }]
        : []);
    mockCounts.mockResolvedValue({ gp_a: 41 });
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.newlyTripped.find((t) => t.policy_id === 'gp_a')).toBeUndefined();
    expect(r.suppressed.has('gp_a')).toBe(true);
  });

  it('clears (hysteresis) when the rate falls below half the budget', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) =>
      filter.key === 'APPROVAL_FLOOD_STATE'
        ? [{ key: 'APPROVAL_FLOOD_STATE', value: JSON.stringify({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 40 } }) }]
        : []);
    mockCounts.mockResolvedValue({ gp_a: 3 }); // < 10/2
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.suppressed.has('gp_a')).toBe(false);
    const written = JSON.parse(mockUpsert.mock.calls.at(-1)[2].value);
    expect(written.gp_a).toBeUndefined();
  });

  it('fails open: a counts query error yields no suppression', async () => {
    mockCounts.mockRejectedValue(new Error('db down'));
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.suppressed.size).toBe(0);
    expect(r.newlyTripped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/unit/approval-flood.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `app/lib/approval-flood.ts`**

```ts
// W3 interruption budget: no single policy (or the fleet) may generate
// unbounded approval interruptions. Detection over guard_decisions; state in
// a settings-key marker (drift-tick pattern). Collapses NOTIFICATIONS only —
// never resolves or suppresses the pending approvals themselves.
import { getSettings, upsertSetting } from './repositories/settings.repository';
import { getRecentApprovalCountsByPolicy } from './repositories/guardrails.repository';

export const APPROVAL_FLOOD_STATE_KEY = 'APPROVAL_FLOOD_STATE';
export const FLEET_KEY = '_fleet';

type SqlTag = unknown; // repositories own typing; this module just threads it

export interface FloodBudget { perPolicy: number; windowMin: number; fleetWide: number }
export interface FloodEntry { tripped_at: string; count: number }
export type FloodState = Record<string, FloodEntry>;

export interface FloodEvaluation {
  state: FloodState;
  /** policy ids currently tripped (plus FLEET_KEY when fleet budget exceeded) */
  suppressed: Set<string>;
  newlyTripped: Array<{ policy_id: string; count: number }>;
  fleetTripped: boolean;
}

const DEFAULTS: FloodBudget = { perPolicy: 10, windowMin: 15, fleetWide: 30 };

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export async function getInterruptBudget(sql: SqlTag, orgId: string): Promise<FloodBudget> {
  try {
    const rows = (await getSettings(sql as never, orgId, {})) as Array<{ key?: string; value?: unknown }>;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      perPolicy: num(byKey.DASHCLAW_INTERRUPT_BUDGET, DEFAULTS.perPolicy),
      windowMin: num(byKey.DASHCLAW_INTERRUPT_WINDOW_MIN, DEFAULTS.windowMin),
      fleetWide: num(byKey.DASHCLAW_INTERRUPT_BUDGET_FLEET, DEFAULTS.fleetWide),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function getFloodState(sql: SqlTag, orgId: string): Promise<FloodState> {
  try {
    const rows = (await getSettings(sql as never, orgId, { key: APPROVAL_FLOOD_STATE_KEY })) as Array<{ value?: unknown }>;
    const parsed = JSON.parse(String(rows[0]?.value ?? '{}'));
    return parsed && typeof parsed === 'object' ? (parsed as FloodState) : {};
  } catch {
    return {};
  }
}

/**
 * Evaluate flood state for the org. Fail-open: any error returns an empty
 * evaluation so per-action notifications proceed (worst case = today's
 * behavior, never silence).
 */
export async function evaluateApprovalFlood(sql: SqlTag, orgId: string): Promise<FloodEvaluation> {
  const empty: FloodEvaluation = { state: {}, suppressed: new Set(), newlyTripped: [], fleetTripped: false };
  try {
    const budget = await getInterruptBudget(sql, orgId);
    const counts = await getRecentApprovalCountsByPolicy(sql as never, orgId, budget.windowMin);
    const state = await getFloodState(sql, orgId);
    const now = new Date().toISOString();
    const newlyTripped: FloodEvaluation['newlyTripped'] = [];
    let changed = false;

    for (const [policyId, count] of Object.entries(counts)) {
      if (count > budget.perPolicy && !state[policyId]) {
        state[policyId] = { tripped_at: now, count };
        newlyTripped.push({ policy_id: policyId, count });
        changed = true;
      } else if (state[policyId] && state[policyId].count !== count) {
        state[policyId].count = count;
        changed = true;
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > budget.fleetWide && !state[FLEET_KEY]) {
      state[FLEET_KEY] = { tripped_at: now, count: total };
      newlyTripped.push({ policy_id: FLEET_KEY, count: total });
      changed = true;
    } else if (state[FLEET_KEY] && state[FLEET_KEY].count !== total) {
      state[FLEET_KEY].count = total;
      changed = true;
    }

    // Hysteresis: clear once the current window falls below half the budget.
    for (const key of Object.keys(state)) {
      const current = key === FLEET_KEY ? total : (counts[key] ?? 0);
      const bar = key === FLEET_KEY ? budget.fleetWide : budget.perPolicy;
      if (current < bar / 2) {
        delete state[key];
        changed = true;
      }
    }

    if (changed) {
      try {
        await upsertSetting(sql as never, orgId, {
          key: APPROVAL_FLOOD_STATE_KEY,
          value: JSON.stringify(state),
          category: 'system',
        });
      } catch (err) {
        console.warn('[approval-flood] state write failed:', (err as Error)?.message);
      }
    }

    return { state, suppressed: new Set(Object.keys(state)), newlyTripped, fleetTripped: !!state[FLEET_KEY] };
  } catch (err) {
    console.warn('[approval-flood] evaluation failed — failing open:', (err as Error)?.message);
    return empty;
  }
}

/** Parse matched_policies off a guard decision (JSON text or array). */
export function matchedPolicyIds(guardDecision: { matched_policies?: unknown } | null | undefined): string[] {
  const raw = guardDecision?.matched_policies;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return (JSON.parse(raw) as unknown[]).map(String); } catch { return []; }
  }
  return [];
}
```

- [ ] **Step 4: Run tests** — `npx vitest run __tests__/unit/approval-flood.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/approval-flood.ts __tests__/unit/approval-flood.test.js
git commit -m "feat(flood): interruption-budget evaluation with settings-marker state + hysteresis"
```

### Task 3: Gate per-action prompts + send the flood event

**Files:**
- Modify: `app/lib/approval-flood.ts` (add `notifyNewFloods`)
- Modify: `app/lib/approvalSurfaces.ts`
- Modify: `app/api/actions/route.ts:368-376` (replace inline block with the shared helper)
- Test: `__tests__/unit/approval-surfaces-flood.test.js` (new)

- [ ] **Step 1: Add `notifyNewFloods` to `approval-flood.ts`**

```ts
import { getPolicyNamesByIds } from './repositories/guardrails.repository';

/** One native notification per newly tripped budget (never throws). */
export async function notifyNewFloods(
  sql: SqlTag,
  orgId: string,
  newlyTripped: Array<{ policy_id: string; count: number }>,
  windowMin: number,
): Promise<void> {
  if (!newlyTripped.length) return;
  try {
    const { deliverNativeNotifications } = await import('./notification-adapters/index');
    const { getSettings } = await import('./repositories/settings.repository');
    const ids = newlyTripped.map((t) => t.policy_id).filter((id) => id !== FLEET_KEY);
    const names = await getPolicyNamesByIds(sql as never, orgId, ids);
    const signals = newlyTripped.map((t) => ({
      severity: 'red',
      label: t.policy_id === FLEET_KEY
        ? `Approval flood: fleet-wide (${t.count} interrupts in ${windowMin}m)`
        : `Approval flood: ${names[t.policy_id] ?? t.policy_id} (${t.count} interrupts in ${windowMin}m)`,
      detail: 'Per-action approval pings are paused for this source. Pending approvals are intact — review on /approvals: pause the rule or bulk-resolve.',
      help: 'A flood almost always means an over-broad require_approval rule, not N risky actions.',
    }));
    const settings = await getSettings(sql as never, orgId, { category: 'integration' });
    await deliverNativeNotifications(orgId, signals as never, settings as never, sql);
  } catch (err) {
    console.warn('[approval-flood] flood notification failed:', (err as Error)?.message);
  }
}
```

- [ ] **Step 2: Rework `fireApprovalSurfaces` in `app/lib/approvalSurfaces.ts`**

Replace the body (keep signature and the webhook call — machine consumers are never suppressed):

```ts
export function fireApprovalSurfaces(
  createdAction: CreatedAction | null | undefined,
  sql: SqlTag,
  orgId: string,
  guardDecision: GuardDecisionLike | null = null,
): void {
  if (!createdAction || createdAction.status !== 'pending_approval') return;

  // Human-facing prompts go through the interruption budget. Fail-open: any
  // flood-check error falls back to today's per-action behavior.
  after(async () => {
    let suppress = false;
    try {
      const { evaluateApprovalFlood, notifyNewFloods, matchedPolicyIds, getInterruptBudget } = await import('./approval-flood');
      const flood = await evaluateApprovalFlood(sql, orgId);
      if (flood.newlyTripped.length) {
        const budget = await getInterruptBudget(sql, orgId);
        await notifyNewFloods(sql, orgId, flood.newlyTripped, budget.windowMin);
      }
      const matched = matchedPolicyIds(guardDecision);
      suppress = flood.fleetTripped || matched.some((id) => flood.suppressed.has(id));
    } catch (err) {
      console.warn('[approval-flood] check failed — keeping per-action prompts:', (err as Error)?.message);
    }
    if (!suppress) {
      await Promise.allSettled([
        fireTelegramApproval(createdAction, sql, orgId),
        fireDiscordApproval(createdAction, sql, orgId),
      ]);
    }
  });

  after(() => fireWebhooksForApproval(orgId, 'approval_pending', {
    ...createdAction,
    matched_policies: guardDecision?.matched_policies as unknown[] | undefined,
    reason: guardDecision?.reason as string | null | undefined,
  }, sql).catch(() => {}));
}
```

- [ ] **Step 3: Replace the inline block in `app/api/actions/route.ts`**

Replace lines 368-376 (the `if (createdAction?.status === 'pending_approval') { ... }` block firing telegram/discord/webhooks) with:

```ts
    fireApprovalSurfaces(createdAction as Record<string, unknown>, sql, orgId, guardDecision as Record<string, unknown> | null);
```

Add the import, and remove `fireTelegramApproval` / `fireDiscordApproval` / `fireWebhooksForApproval` imports from route.ts **only if** they have no other call sites in the file (grep the file first).

- [ ] **Step 4: Write tests**

```js
// __tests__/unit/approval-surfaces-flood.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEval, mockNotify, mockTelegram, mockDiscord, mockWebhooks, afterCalls } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockNotify: vi.fn(async () => {}),
  mockTelegram: vi.fn(async () => {}),
  mockDiscord: vi.fn(async () => {}),
  mockWebhooks: vi.fn(async () => {}),
  afterCalls: [],
}));
vi.mock('next/server', () => ({ after: (fn) => { afterCalls.push(fn); } }));
vi.mock('../../app/lib/approval-flood', () => ({
  evaluateApprovalFlood: mockEval,
  notifyNewFloods: mockNotify,
  getInterruptBudget: vi.fn(async () => ({ perPolicy: 10, windowMin: 15, fleetWide: 30 })),
  matchedPolicyIds: (gd) => (Array.isArray(gd?.matched_policies) ? gd.matched_policies : []),
}));
vi.mock('../../app/lib/telegramApprovals', () => ({ fireTelegramApproval: mockTelegram }));
vi.mock('../../app/lib/discordApprovals', () => ({ fireDiscordApproval: mockDiscord }));
vi.mock('../../app/lib/webhooks', () => ({ fireWebhooksForApproval: mockWebhooks }));

import { fireApprovalSurfaces } from '../../app/lib/approvalSurfaces';

const action = { status: 'pending_approval', action_id: 'act_1' };

beforeEach(() => { vi.clearAllMocks(); afterCalls.length = 0; });

async function drainAfter() { for (const fn of afterCalls.splice(0)) await fn(); }

describe('fireApprovalSurfaces flood gating', () => {
  it('fires per-action prompts when not flooding', async () => {
    mockEval.mockResolvedValue({ state: {}, suppressed: new Set(), newlyTripped: [], fleetTripped: false });
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockTelegram).toHaveBeenCalled();
    expect(mockDiscord).toHaveBeenCalled();
    expect(mockWebhooks).toHaveBeenCalled();
  });

  it('suppresses prompts (not webhooks) when a matched policy is tripped', async () => {
    mockEval.mockResolvedValue({ state: {}, suppressed: new Set(['gp_a']), newlyTripped: [], fleetTripped: false });
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockTelegram).not.toHaveBeenCalled();
    expect(mockDiscord).not.toHaveBeenCalled();
    expect(mockWebhooks).toHaveBeenCalled();
  });

  it('sends the flood notification exactly when newly tripped', async () => {
    mockEval.mockResolvedValue({ state: {}, suppressed: new Set(['gp_a']), newlyTripped: [{ policy_id: 'gp_a', count: 47 }], fleetTripped: false });
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('fails open to per-action prompts when the flood check throws', async () => {
    mockEval.mockRejectedValue(new Error('boom'));
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockTelegram).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run** — `npx vitest run __tests__/unit/approval-surfaces-flood.test.js` → PASS. Then `npx vitest run` (full) — existing actions-route tests must stay green.

- [ ] **Step 6: Commit**

```bash
git add app/lib/approval-flood.ts app/lib/approvalSurfaces.ts app/api/actions/route.ts __tests__/unit/approval-surfaces-flood.test.js
git commit -m "feat(flood): gate per-action approval prompts behind the interruption budget; collapse to one flood event"
```

### Task 4: `approval_flood` + `coverage_drop` signals (16 → 18)

**Files:**
- Modify: `app/lib/signals.ts` (Signal interface, docstring, two new categories)
- Modify: `app/api/cron/signals/route.ts:19-47` (`hashSignal` gains `policy_id`)
- Test: `__tests__/unit/signals-w3.test.js` (new)

- [ ] **Step 1: Write failing tests**

```js
// __tests__/unit/signals-w3.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFloodState, mockCost } = vi.hoisted(() => ({
  mockFloodState: vi.fn(async () => ({})),
  mockCost: vi.fn(async () => ({ attribution: { attributed_count: 100, total_count: 100, coverage_pct: 100 } })),
}));
vi.mock('../../app/lib/approval-flood', () => ({ getFloodState: mockFloodState, FLEET_KEY: '_fleet' }));
vi.mock('../../app/lib/repositories/actions.repository', () => ({ getCostAggregation: mockCost }));

import { computeSignals } from '../../app/lib/signals';

// Tagged-template sql mock: every category query resolves empty.
function emptySql() {
  const fn = vi.fn(async () => []);
  fn.query = vi.fn(async () => []);
  return fn;
}

beforeEach(() => vi.clearAllMocks());

describe('W3 signals', () => {
  it('emits a red approval_flood signal per tripped entry', async () => {
    mockFloodState.mockResolvedValue({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 } });
    const signals = await computeSignals('org1', null, emptySql());
    const flood = signals.find((s) => s.type === 'approval_flood');
    expect(flood).toBeTruthy();
    expect(flood.severity).toBe('red');
    expect(flood.policy_id).toBe('gp_a');
  });

  it('emits amber coverage_drop below 90% with enough volume', async () => {
    mockCost.mockResolvedValue({ attribution: { attributed_count: 40, total_count: 100, coverage_pct: 40 } });
    const signals = await computeSignals('org1', null, emptySql());
    expect(signals.find((s) => s.type === 'coverage_drop')?.severity).toBe('amber');
  });

  it('stays silent on low volume even with low coverage', async () => {
    mockCost.mockResolvedValue({ attribution: { attributed_count: 1, total_count: 10, coverage_pct: 10 } });
    const signals = await computeSignals('org1', null, emptySql());
    expect(signals.find((s) => s.type === 'coverage_drop')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/unit/signals-w3.test.js` → FAIL.

- [ ] **Step 3: Implement in `signals.ts`**

1. Add `policy_id?: string | null;` to the `Signal` interface (after `provider?`).
2. Update the docstring `Compute all 16 risk signal types` → `Compute all 18 risk signal types`.
3. After the existing category mapping loops (end of `computeSignals`, before `return signals`), append:

```ts
  // ── W3: approval flood (red) — mirrors the interruption-budget state ──
  try {
    const { getFloodState, FLEET_KEY } = await import('./approval-flood');
    const flood = await getFloodState(sql, orgId);
    for (const [policyId, entry] of Object.entries(flood)) {
      signals.push({
        type: 'approval_flood',
        severity: 'red',
        label: policyId === FLEET_KEY
          ? `Approval flood: fleet-wide (${entry.count} interrupts in window)`
          : `Approval flood: policy ${policyId} (${entry.count} interrupts in window)`,
        detail: 'A single source is generating bulk approval interruptions. Per-action pings are paused; pending approvals are intact.',
        help: 'Review /approvals — pause the rule or bulk-resolve. A flood almost always means an over-broad require_approval rule.',
        policy_id: policyId,
        detected_at: entry.tripped_at,
      });
    }
  } catch (e) { warnNull('approval_flood')(e); }

  // ── W3: attribution coverage drop (amber) ──
  try {
    const { getCostAggregation } = await import('./repositories/actions.repository');
    const cost = await getCostAggregation(sql as never, orgId, { period: '7d' });
    const cov = cost.attribution;
    if (cov && cov.total_count >= 50 && cov.coverage_pct !== null && cov.coverage_pct < 90) {
      signals.push({
        type: 'coverage_drop',
        severity: 'amber',
        label: `Token attribution coverage at ${cov.coverage_pct}%`,
        detail: `${cov.attributed_count} of ${cov.total_count} actions in the last 7d carry token usage — cost reporting is undercounting.`,
        help: 'Check that runtime plugins emit usage (see /spend). A disabled plugin or unsupported runtime drops attribution.',
      });
    }
  } catch (e) { warnNull('coverage_drop')(e); }
```

(Match the file's actual variable names — the signals array and `warnNull` already exist; place the blocks so `signals` is in scope, i.e. after the array is declared and populated.)

4. In `app/api/cron/signals/route.ts`, add `policy_id` to `hashSignal`: extend the function's parameter type with `policy_id?: string | null` and append `signal.policy_id || ''` to the `parts` array.

- [ ] **Step 4: Run** — `npx vitest run __tests__/unit/signals-w3.test.js` and any existing signals tests → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/signals.ts app/api/cron/signals/route.ts __tests__/unit/signals-w3.test.js
git commit -m "feat(signals): approval_flood + coverage_drop signal types (16 -> 18)"
```

### Task 5: `GET /api/approvals/floods`

**Files:**
- Create: `app/api/approvals/floods/route.ts`
- Test: `__tests__/unit/approvals-floods-route.test.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
// __tests__/unit/approvals-floods-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEval, mockNames, mockBudget } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockNames: vi.fn(async () => ({ gp_a: '[Tightened] other' })),
  mockBudget: vi.fn(async () => ({ perPolicy: 10, windowMin: 15, fleetWide: 30 })),
}));
vi.mock('../../app/lib/approval-flood', () => ({
  evaluateApprovalFlood: mockEval,
  getInterruptBudget: mockBudget,
  FLEET_KEY: '_fleet',
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({ getPolicyNamesByIds: mockNames }));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org1' }));
vi.mock('../../app/lib/db', () => ({ getSql: () => ({}) }));

import { GET } from '../../app/api/approvals/floods/route';

beforeEach(() => vi.clearAllMocks());

it('returns flood entries with names and budget', async () => {
  mockEval.mockResolvedValue({
    state: { gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 } },
    suppressed: new Set(['gp_a']), newlyTripped: [], fleetTripped: false,
  });
  const res = await GET(new Request('http://x/api/approvals/floods'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.floods).toEqual([
    { policy_id: 'gp_a', name: '[Tightened] other', count: 47, tripped_at: '2026-06-11T00:00:00Z' },
  ]);
  expect(body.budget).toEqual({ perPolicy: 10, windowMin: 15, fleetWide: 30 });
  expect(body.fleet).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**, then implement:

```ts
// app/api/approvals/floods/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { evaluateApprovalFlood, getInterruptBudget, FLEET_KEY } from '../../../lib/approval-flood';
import { getPolicyNamesByIds } from '../../../lib/repositories/guardrails.repository';

/**
 * GET /api/approvals/floods — current interruption-budget (approval flood)
 * state. Re-evaluates on read so banners stay fresh without a scheduler.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const [evaluation, budget] = await Promise.all([
      evaluateApprovalFlood(sql, orgId),
      getInterruptBudget(sql, orgId),
    ]);
    const policyIds = Object.keys(evaluation.state).filter((k) => k !== FLEET_KEY);
    const names = await getPolicyNamesByIds(sql, orgId, policyIds);
    const floods = policyIds.map((id) => ({
      policy_id: id,
      name: names[id] ?? id,
      count: evaluation.state[id].count,
      tripped_at: evaluation.state[id].tripped_at,
    }));
    const fleetEntry = evaluation.state[FLEET_KEY] ?? null;
    return NextResponse.json({ floods, fleet: fleetEntry, budget });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVALS_FLOODS GET');
  }
}
```

- [ ] **Step 3: Run test → PASS. Step 4: Commit**

```bash
git add app/api/approvals/floods/route.ts __tests__/unit/approvals-floods-route.test.ts
git commit -m "feat(flood): GET /api/approvals/floods state endpoint"
```

### Task 6: `POST /api/approvals/bulk`

**Files:**
- Modify: `app/lib/repositories/actions.repository.ts` (add `listPendingApprovalIdsByActionTypes`)
- Create: `app/api/approvals/bulk/route.ts`
- Test: `__tests__/unit/approvals-bulk-route.test.ts` (new)

- [ ] **Step 1: Add the repository query** (in `actions.repository.ts`, near `listActions`):

```ts
/** Pending-approval action ids matching a set of action_types since a cutoff (bulk flood resolution). */
export async function listPendingApprovalIdsByActionTypes(
  sql: SqlClient,
  orgId: string,
  actionTypes: string[],
  sinceIso: string,
  limit = 500,
): Promise<string[]> {
  if (!actionTypes.length) return [];
  const rows = await sql.query(
    `SELECT action_id FROM action_records
     WHERE org_id = $1 AND status = 'pending_approval'
       AND action_type = ANY($2)
       AND created_at::timestamptz >= $3::timestamptz
     ORDER BY created_at ASC
     LIMIT $4`,
    [orgId, actionTypes, sinceIso, Math.min(Math.max(1, limit), 500)],
  );
  return (rows as Array<{ action_id: string }>).map((r) => r.action_id);
}
```

- [ ] **Step 2: Write failing route tests**

```ts
// __tests__/unit/approvals-bulk-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListIds, mockRecord, mockClear, mockRole } = vi.hoisted(() => ({
  mockListIds: vi.fn(async () => ['act_1', 'act_2']),
  mockRecord: vi.fn(async () => ({ action_id: 'x', status: 'running' })),
  mockClear: vi.fn(async () => {}),
  mockRole: vi.fn(() => 'admin'),
}));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org1', getOrgRole: mockRole, getUserId: () => 'user1' }));
vi.mock('../../app/lib/db', () => ({
  getSql: () => {
    const fn = vi.fn(async () => []);
    (fn as never as { query: unknown }).query = vi.fn(async () => [
      { rules: JSON.stringify({ action_types: ['other'], _tightened: true }), name: '[Tightened] other', policy_type: 'require_approval' },
    ]);
    return fn;
  },
}));
vi.mock('../../app/lib/repositories/actions.repository', () => ({
  listPendingApprovalIdsByActionTypes: mockListIds,
  recordApproval: mockRecord,
}));
vi.mock('../../app/lib/approvalNotifications', () => ({ clearApprovalNotifications: mockClear }));
vi.mock('../../app/lib/audit', () => ({ logActivity: vi.fn() }));
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, after: (fn: () => unknown) => { void fn(); } };
});

import { POST } from '../../app/api/approvals/bulk/route';

function req(body: unknown) {
  return new Request('http://x/api/approvals/bulk', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { vi.clearAllMocks(); mockRole.mockReturnValue('admin'); });

describe('POST /api/approvals/bulk', () => {
  it('requires admin', async () => {
    mockRole.mockReturnValue('member');
    expect((await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }))).status).toBe(403);
  });
  it('rejects bad decisions', async () => {
    expect((await POST(req({ decision: 'nuke', filter: { policy_id: 'gp_a' } }))).status).toBe(400);
  });
  it('resolves each matching pending action via recordApproval', async () => {
    const res = await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.resolved).toBe(2);
    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockRecord.mock.calls[0][3]).toMatchObject({ decision: 'allow', newStatus: 'running' });
  });
  it('reports per-action failures without aborting the batch', async () => {
    mockRecord.mockResolvedValueOnce(null); // already resolved by someone else
    const res = await POST(req({ decision: 'deny', filter: { policy_id: 'gp_a' } }));
    const body = await res.json();
    expect(body.resolved).toBe(1);
    expect(body.failed).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**, then implement the route:

```ts
// app/api/approvals/bulk/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { listPendingApprovalIdsByActionTypes, recordApproval } from '../../../lib/repositories/actions.repository';
import { clearApprovalNotifications } from '../../../lib/approvalNotifications';

const MAX_BULK = 500;

/**
 * POST /api/approvals/bulk — admin-only bulk resolution for approval floods.
 * Body: { decision: 'allow'|'deny', filter: { policy_id }, limit? }
 * Matches pending_approval actions by the policy's compiled action_types in
 * the last 24h. Each action resolves through recordApproval (full audit
 * trail); per-action failures don't abort the batch. NEVER auto-invoked.
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const userId = getUserId(request);
    const body = await request.json().catch(() => ({})) as {
      decision?: string; filter?: { policy_id?: string }; limit?: number;
    };
    if (!['allow', 'deny'].includes(body.decision ?? '')) {
      return NextResponse.json({ error: 'decision must be allow or deny' }, { status: 400 });
    }
    const policyId = body.filter?.policy_id;
    if (!policyId || typeof policyId !== 'string') {
      return NextResponse.json({ error: 'filter.policy_id is required' }, { status: 400 });
    }

    const sql = getSql();
    const policyRows = await sql.query(
      `SELECT rules, name, policy_type FROM guard_policies WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, policyId],
    ) as Array<{ rules?: string; name?: string; policy_type?: string }>;
    if (!policyRows.length) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }
    if (policyRows[0].policy_type === 'protected_path') {
      return NextResponse.json({ error: 'Bulk resolution does not support protected_path policies — resolve from /approvals' }, { status: 400 });
    }
    let actionTypes: string[] = [];
    try {
      const rules = JSON.parse(policyRows[0].rules || '{}');
      if (Array.isArray(rules.action_types)) actionTypes = rules.action_types.map(String);
    } catch { /* fall through to 400 below */ }
    if (!actionTypes.length) {
      return NextResponse.json({ error: 'Policy has no action_types to match' }, { status: 400 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ids = await listPendingApprovalIdsByActionTypes(sql, orgId, actionTypes, since, Math.min(body.limit ?? MAX_BULK, MAX_BULK));

    const decision = body.decision as 'allow' | 'deny';
    const newStatus = decision === 'allow' ? 'running' : 'failed';
    const reasoning = `Bulk ${decision} via approval-flood resolution (policy ${policyRows[0].name ?? policyId})`;
    let resolved = 0;
    let failed = 0;
    for (const actionId of ids) {
      try {
        const updated = await recordApproval(sql, orgId, actionId, {
          newStatus,
          errorMessage: decision === 'deny' ? reasoning : null,
          decision,
          userId,
          safeReasoning: reasoning,
        });
        if (!updated) { failed++; continue; }
        resolved++;
        after(() => clearApprovalNotifications(sql, { orgId, actionId, decision, resolvedBy: userId, resolvedVia: 'dashboard' }));
      } catch {
        failed++;
      }
    }

    logActivity({
      orgId, actorId: userId, action: `approvals.bulk_${decision}`,
      resourceType: 'policy', resourceId: policyId,
      details: { resolved, failed, matched: ids.length }, request,
    }, sql);

    return NextResponse.json({ resolved, failed, matched: ids.length });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVALS_BULK POST');
  }
}
```

**Route-SQL note:** the single `SELECT rules...` violates the no-SQL-in-routes guardrail (`npm run route-sql:check` blocks *increases*). Move it into `guardrails.repository.ts` as `getPolicyById(sql, orgId, id)` if the check fails — preferred; only inline if the repository already has an equivalent (check for an existing `getPolicy`/`getPolicyById` first and reuse it).

- [ ] **Step 4: Run tests → PASS. Run `npm run route-sql:check`.**

- [ ] **Step 5: Commit**

```bash
git add app/api/approvals/bulk/route.ts app/lib/repositories/actions.repository.ts app/lib/repositories/guardrails.repository.ts __tests__/unit/approvals-bulk-route.test.ts
git commit -m "feat(flood): POST /api/approvals/bulk — capped, admin-only, audited bulk resolution"
```

### Task 7: Flood banner on /approvals and /policies

**Files:**
- Create: `app/components/ApprovalFloodBanner.tsx`
- Modify: `app/approvals/page.tsx` (mount above the existing Banner region, lines ~169)
- Modify: `app/policies/components/PolicyCockpit.tsx` (mount above `<ContractPanel … />`)
- Test: `__tests__/unit/approval-flood-banner.test.tsx` (new)

- [ ] **Step 1: Implement the component** (design rules: calm warning, tokens only, two-step confirm like ReviewFeed, no modal):

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

const BTN_NEUTRAL =
  'rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none';
const BTN_WARNING =
  'rounded-md border border-border bg-status-warning-subtle px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:border-border-hover motion-reduce:transition-none';

interface Flood { policy_id: string; name: string; count: number; tripped_at: string }
type Confirm = { policyId: string; kind: 'pause' | 'allow' | 'deny' } | null;

/**
 * Approval-flood banner: shown only while the interruption budget is tripped.
 * One row per flooding policy with pause / bulk-allow / bulk-deny, each behind
 * a labeled confirm. Renders nothing when there is no flood.
 */
export default function ApprovalFloodBanner({ onResolved }: { onResolved?: () => void }) {
  const [floods, setFloods] = useState<Flood[]>([]);
  const [budget, setBudget] = useState<{ windowMin: number } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals/floods', { cache: 'no-store' });
      if (!res.ok) return; // banner is best-effort; absence of data = no banner
      const json = await res.json();
      setFloods(json.floods ?? []);
      setBudget(json.budget ?? null);
    } catch { /* best-effort surface — stay hidden on fetch failure */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (flood: Flood, kind: 'pause' | 'allow' | 'deny') => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'pause') {
        const res = await fetch('/api/policies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: flood.policy_id, active: 0 }),
        });
        if (!res.ok) throw new Error(`Failed to pause rule (${res.status})`);
      } else {
        const res = await fetch('/api/approvals/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: kind, filter: { policy_id: flood.policy_id } }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Bulk ${kind} failed (${res.status})`);
        }
      }
      setConfirm(null);
      await load();
      onResolved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [load, onResolved]);

  if (floods.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-status-warning-subtle px-4 py-3 space-y-2">
      {floods.map((flood) => {
        const confirming = confirm?.policyId === flood.policy_id ? confirm : null;
        return (
          <div key={flood.policy_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AlertTriangle size={14} className="shrink-0 text-status-warning" aria-hidden="true" />
            <span className="text-sm text-primary">
              Approval flood: <span className="font-medium">{flood.name}</span>
              <span className="ml-1.5 tabular-nums text-xs text-secondary">
                {flood.count} interrupts in {budget?.windowMin ?? 15}m — per-action pings paused
              </span>
            </span>
            {confirming ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-status-warning">
                  {confirming.kind === 'pause' && `Deactivate "${flood.name}"? Pending approvals stay pending.`}
                  {confirming.kind === 'allow' && `Approve all pending actions matched by "${flood.name}"?`}
                  {confirming.kind === 'deny' && `Deny all pending actions matched by "${flood.name}"?`}
                </span>
                <button type="button" disabled={busy} onClick={() => act(flood, confirming.kind)} className={`${BTN_WARNING} disabled:opacity-50`}>
                  Confirm
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={BTN_NEUTRAL}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => setConfirm({ policyId: flood.policy_id, kind: 'pause' })} className={BTN_NEUTRAL}>
                  Pause rule&hellip;
                </button>
                <button type="button" onClick={() => setConfirm({ policyId: flood.policy_id, kind: 'allow' })} className={BTN_NEUTRAL}>
                  Approve all&hellip;
                </button>
                <button type="button" onClick={() => setConfirm({ policyId: flood.policy_id, kind: 'deny' })} className={BTN_WARNING}>
                  Deny all&hellip;
                </button>
              </span>
            )}
          </div>
        );
      })}
      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Mount it.** In `app/approvals/page.tsx`, render `<ApprovalFloodBanner onResolved={() => fetchPending({ silent: true })} />` immediately above the existing demo/read-only `Banner` region (~line 169). In `app/policies/components/PolicyCockpit.tsx`, render `<ApprovalFloodBanner onResolved={load} />` as the first child of the governed `<div className="max-w-3xl space-y-8">`.

- [ ] **Step 3: Component test**

```tsx
// __tests__/unit/approval-flood-banner.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import ApprovalFloodBanner from '@/components/ApprovalFloodBanner';

const flood = { policy_id: 'gp_a', name: '[Tightened] other', count: 47, tripped_at: '2026-06-11T00:00:00Z' };

beforeEach(() => vi.restoreAllMocks());

describe('ApprovalFloodBanner', () => {
  it('renders nothing when there is no flood', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ floods: [], budget: null }) })));
    const { container } = render(<ApprovalFloodBanner />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders the flood with two-step confirmed bulk deny', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ resolved: 47, failed: 0, matched: 47 }) };
      return { ok: true, json: async () => ({ floods: [flood], budget: { perPolicy: 10, windowMin: 15, fleetWide: 30 } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<ApprovalFloodBanner />);
    await waitFor(() => expect(container.textContent).toContain('[Tightened] other'));

    fireEvent.click(getByText(/deny all/i));
    // No POST yet — confirm step armed.
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')).toHaveLength(0);
    fireEvent.click(getByText(/^confirm$/i));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({ decision: 'deny', filter: { policy_id: 'gp_a' } });
    });
  });

  it('pause rule PATCHes the policy inactive after confirm', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => ({ floods: [flood], budget: { perPolicy: 10, windowMin: 15, fleetWide: 30 } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<ApprovalFloodBanner />);
    await waitFor(() => expect(container.textContent).toContain('[Tightened] other'));
    fireEvent.click(getByText(/pause rule/i));
    fireEvent.click(getByText(/^confirm$/i));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH');
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ id: 'gp_a', active: 0 });
    });
  });
});
```

- [ ] **Step 4: Run** new test + `__tests__/unit/policy-cockpit.test.tsx` (the cockpit test stubs leaf children — add a `vi.mock('@/components/ApprovalFloodBanner', …)` stub there if it fails on fetch).

- [ ] **Step 5: Commit**

```bash
git add app/components/ApprovalFloodBanner.tsx app/approvals/page.tsx app/policies/components/PolicyCockpit.tsx __tests__/unit/approval-flood-banner.test.tsx __tests__/unit/policy-cockpit.test.tsx
git commit -m "feat(flood): flood banner with pause/bulk-resolve on /approvals and /policies"
```

---

## Phase 2 — Fleet digest

### Task 8: Digest repository queries

**Files:**
- Modify: `app/lib/repositories/guardrails.repository.ts` (add `getGuardDecisionMix`)
- Modify: `app/lib/repositories/actions.repository.ts` (add `getPendingApprovalSummary`)
- Test: `__tests__/unit/fleet-digest.repository.test.js` (new)

- [ ] **Step 1: Failing tests**

```js
// __tests__/unit/fleet-digest.repository.test.js
import { describe, it, expect, vi } from 'vitest';
import { getGuardDecisionMix } from '../../app/lib/repositories/guardrails.repository';
import { getPendingApprovalSummary } from '../../app/lib/repositories/actions.repository';

function mockSql(rows) {
  const fn = vi.fn(async () => rows);
  fn.query = vi.fn(async () => rows);
  return fn;
}

it('getGuardDecisionMix splits current vs prior window per decision', async () => {
  const sql = mockSql([
    { decision: 'allow', current_cnt: 100, prior_cnt: 90 },
    { decision: 'require_approval', current_cnt: 12, prior_cnt: 2 },
  ]);
  const mix = await getGuardDecisionMix(sql, 'org1', 24);
  expect(mix.current).toEqual({ allow: 100, require_approval: 12 });
  expect(mix.prior).toEqual({ allow: 90, require_approval: 2 });
});

it('getPendingApprovalSummary returns count and oldest age', async () => {
  const sql = mockSql([{ pending: 3, oldest_at: '2026-06-11T00:00:00Z' }]);
  const s = await getPendingApprovalSummary(sql, 'org1');
  expect(s.pending).toBe(3);
  expect(s.oldest_at).toBe('2026-06-11T00:00:00Z');
});
```

- [ ] **Step 2: Implement**

In `guardrails.repository.ts`:

```ts
/** Guard decision counts by type for the current window vs the prior window of equal length. */
export async function getGuardDecisionMix(
  sql: SqlClient,
  orgId: string,
  hours = 24,
): Promise<{ current: Record<string, number>; prior: Record<string, number> }> {
  const rows = await sql.query(
    `SELECT decision,
            COUNT(*) FILTER (WHERE created_at::timestamptz > NOW() - make_interval(hours => $2::int))::int AS current_cnt,
            COUNT(*) FILTER (WHERE created_at::timestamptz <= NOW() - make_interval(hours => $2::int))::int AS prior_cnt
     FROM guard_decisions
     WHERE org_id = $1
       AND created_at::timestamptz > NOW() - make_interval(hours => ($2::int) * 2)
     GROUP BY decision`,
    [orgId, hours],
  );
  const current: Record<string, number> = {};
  const prior: Record<string, number> = {};
  for (const r of rows as Array<{ decision: string; current_cnt: number; prior_cnt: number }>) {
    current[r.decision] = Number(r.current_cnt) || 0;
    prior[r.decision] = Number(r.prior_cnt) || 0;
  }
  return { current, prior };
}
```

In `actions.repository.ts`:

```ts
/** Pending-approval queue summary for the fleet digest / session hook. */
export async function getPendingApprovalSummary(
  sql: SqlClient,
  orgId: string,
): Promise<{ pending: number; oldest_at: string | null }> {
  const rows = await sql.query(
    `SELECT COUNT(*)::int AS pending, MIN(created_at::timestamptz) AS oldest_at
     FROM action_records
     WHERE org_id = $1 AND status = 'pending_approval'`,
    [orgId],
  );
  const row = (rows as Array<{ pending: number; oldest_at: string | null }>)[0] ?? { pending: 0, oldest_at: null };
  return { pending: Number(row.pending) || 0, oldest_at: row.oldest_at ? String(row.oldest_at) : null };
}
```

- [ ] **Step 3: Run → PASS. Step 4: Commit**

```bash
git add app/lib/repositories/guardrails.repository.ts app/lib/repositories/actions.repository.ts __tests__/unit/fleet-digest.repository.test.js
git commit -m "feat(digest): decision-mix and pending-approval summary queries"
```

### Task 9: Digest composer + `GET /api/digest/fleet`

**Files:**
- Create: `app/lib/fleet-digest.ts`
- Create: `app/api/digest/fleet/route.ts`
- Test: `__tests__/unit/fleet-digest.test.js` (new)

- [ ] **Step 1: Failing tests**

```js
// __tests__/unit/fleet-digest.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMix, mockPending, mockCost, mockFlood, mockSignals, mockNames } = vi.hoisted(() => ({
  mockMix: vi.fn(),
  mockPending: vi.fn(),
  mockCost: vi.fn(),
  mockFlood: vi.fn(async () => ({})),
  mockSignals: vi.fn(async () => []),
  mockNames: vi.fn(async () => ({})),
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({
  getGuardDecisionMix: mockMix,
  getPolicyNamesByIds: mockNames,
}));
vi.mock('../../app/lib/repositories/actions.repository', () => ({
  getPendingApprovalSummary: mockPending,
  getCostAggregation: mockCost,
}));
vi.mock('../../app/lib/approval-flood', () => ({ getFloodState: mockFlood, FLEET_KEY: '_fleet' }));
vi.mock('../../app/lib/signals', () => ({ computeSignals: mockSignals }));

import { composeFleetDigest } from '../../app/lib/fleet-digest';

beforeEach(() => {
  vi.clearAllMocks();
  mockMix.mockResolvedValue({ current: { allow: 1204 }, prior: { allow: 1100 } });
  mockPending.mockResolvedValue({ pending: 0, oldest_at: null });
  mockCost.mockResolvedValue({ total_cost_usd: 4.1, attribution: { attributed_count: 95, total_count: 100, coverage_pct: 95 } });
});

describe('composeFleetDigest', () => {
  it('is quiet when nothing needs attention', async () => {
    const d = await composeFleetDigest({}, 'org1');
    expect(d.quiet).toBe(true);
    expect(d.text).toMatch(/quiet/i);
    expect(d.text).toContain('1204');
  });

  it('surfaces pending approvals, floods, and red signals', async () => {
    mockMix.mockResolvedValue({ current: { allow: 900, require_approval: 47 }, prior: { allow: 880, require_approval: 1 } });
    mockPending.mockResolvedValue({ pending: 47, oldest_at: new Date(Date.now() - 3 * 3600e3).toISOString() });
    mockFlood.mockResolvedValue({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 } });
    mockSignals.mockResolvedValue([
      { type: 'approval_flood', severity: 'red', label: 'Approval flood: gp_a' },
    ]);
    const d = await composeFleetDigest({}, 'org1');
    expect(d.quiet).toBe(false);
    expect(d.text).toMatch(/47 pending/i);
    expect(d.text).toMatch(/approval flood/i);
    expect(d.pending_approvals).toBe(47);
    expect(d.floods).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `app/lib/fleet-digest.ts`**

```ts
// W3 fleet digest: one compact, evidence-first message a day. Sections are
// skipped when zero/unchanged; a fully quiet fleet is one line.
import { getGuardDecisionMix, getPolicyNamesByIds } from './repositories/guardrails.repository';
import { getPendingApprovalSummary, getCostAggregation } from './repositories/actions.repository';
import { getFloodState, FLEET_KEY } from './approval-flood';
import { computeSignals } from './signals';

type SqlTag = unknown;

export interface FleetDigest {
  quiet: boolean;
  text: string;
  pending_approvals: number;
  oldest_pending_minutes: number | null;
  floods: Array<{ policy_id: string; name: string; count: number }>;
  coverage_pct: number | null;
}

function delta(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? ' (new)' : '';
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (Math.abs(pct) < 10) return '';
  return ` (${pct > 0 ? '+' : ''}${pct}% vs prior 24h)`;
}

export async function composeFleetDigest(sql: SqlTag, orgId: string): Promise<FleetDigest> {
  const [mix, pendingSummary, cost, floodState] = await Promise.all([
    getGuardDecisionMix(sql as never, orgId, 24),
    getPendingApprovalSummary(sql as never, orgId),
    getCostAggregation(sql as never, orgId, { period: '1d' }),
    getFloodState(sql, orgId),
  ]);

  const floodIds = Object.keys(floodState).filter((k) => k !== FLEET_KEY);
  const names = await getPolicyNamesByIds(sql as never, orgId, floodIds);
  const floods = floodIds.map((id) => ({ policy_id: id, name: names[id] ?? id, count: floodState[id].count }));

  let signals: Array<{ severity: string; label: string }> = [];
  try {
    const all = await computeSignals(orgId, null, sql as never);
    signals = [...all].sort((a, b) => (a.severity === 'red' ? -1 : 1) - (b.severity === 'red' ? -1 : 1)).slice(0, 3);
  } catch { /* signals are garnish — digest still ships */ }

  const total = Object.values(mix.current).reduce((a, b) => a + b, 0);
  const totalPrior = Object.values(mix.prior).reduce((a, b) => a + b, 0);
  const interrupts = (mix.current.require_approval ?? 0) + (mix.current.block ?? 0);
  const cov = cost.attribution?.coverage_pct ?? null;
  const oldestMin = pendingSummary.oldest_at
    ? Math.max(0, Math.round((Date.now() - new Date(pendingSummary.oldest_at).getTime()) / 60000))
    : null;

  const quiet = pendingSummary.pending === 0 && floods.length === 0
    && !signals.some((s) => s.severity === 'red')
    && interrupts === 0;

  const lines: string[] = [];
  if (quiet) {
    lines.push(`Fleet quiet: ${total} decisions${delta(total, totalPrior)}, 0 interrupts, $${(Number(cost.total_cost_usd) || 0).toFixed(2)} (24h)`);
  } else {
    lines.push(`Fleet digest (24h): ${total} decisions${delta(total, totalPrior)} · ${interrupts} interrupt${interrupts === 1 ? '' : 's'} · $${(Number(cost.total_cost_usd) || 0).toFixed(2)}`);
    if (pendingSummary.pending > 0) {
      lines.push(`${pendingSummary.pending} pending approval${pendingSummary.pending === 1 ? '' : 's'}${oldestMin !== null ? ` (oldest ${oldestMin}m)` : ''}`);
    }
    for (const f of floods) lines.push(`Approval flood active: ${f.name} (${f.count} in window)`);
    if (cov !== null && cov < 90) lines.push(`Attribution coverage ${cov}% — cost is undercounting`);
    for (const s of signals) lines.push(`${s.severity === 'red' ? '[red]' : '[amber]'} ${s.label}`);
  }

  return {
    quiet,
    text: lines.join('\n'),
    pending_approvals: pendingSummary.pending,
    oldest_pending_minutes: oldestMin,
    floods,
    coverage_pct: cov,
  };
}
```

- [ ] **Step 3: Implement the route**

```ts
// app/api/digest/fleet/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { composeFleetDigest } from '../../../lib/fleet-digest';

/**
 * GET /api/digest/fleet — the operator fleet digest.
 * ?lite=1 returns only the fields the SessionStart hook needs.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const digest = await composeFleetDigest(getSql(), orgId);
    const lite = new URL(request.url).searchParams.get('lite') === '1';
    if (lite) {
      return NextResponse.json({
        pending_approvals: digest.pending_approvals,
        oldest_pending_minutes: digest.oldest_pending_minutes,
        floods: digest.floods,
      });
    }
    return NextResponse.json(digest);
  } catch (err) {
    return apiErrorResponse(err, 'DIGEST_FLEET GET');
  }
}
```

- [ ] **Step 4: Run** `npx vitest run __tests__/unit/fleet-digest.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/fleet-digest.ts app/api/digest/fleet/route.ts __tests__/unit/fleet-digest.test.js
git commit -m "feat(digest): fleet digest composer + GET /api/digest/fleet (?lite=1 for hooks)"
```

### Task 10: Digest tick (no-cron cadence)

**Files:**
- Create: `app/lib/digest-tick.ts`
- Modify: `app/api/actions/route.ts` (one `after()` line)
- Test: `__tests__/unit/digest-tick.test.js` (new)

- [ ] **Step 1: Failing tests**

```js
// __tests__/unit/digest-tick.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings, mockUpsert, mockCompose, mockDeliver } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpsert: vi.fn(async () => {}),
  mockCompose: vi.fn(async () => ({ quiet: true, text: 'Fleet quiet: 10 decisions', pending_approvals: 0, oldest_pending_minutes: null, floods: [], coverage_pct: 100 })),
  mockDeliver: vi.fn(async () => [{ provider: 'slack', success: true, message: 'ok' }]),
}));
vi.mock('../../app/lib/repositories/settings.repository', () => ({ getSettings: mockGetSettings, upsertSetting: mockUpsert }));
vi.mock('../../app/lib/fleet-digest', () => ({ composeFleetDigest: mockCompose }));
vi.mock('../../app/lib/notification-adapters/index', () => ({ deliverNativeNotifications: mockDeliver }));

import { maybeRunDigestTick } from '../../app/lib/digest-tick';

const integrationCreds = [{ key: 'SLACK_WEBHOOK_URL', value: 'enc' }];

beforeEach(() => {
  vi.clearAllMocks();
  // default: creds configured, no marker, no interval override
  mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) => {
    if (filter.category === 'integration') return integrationCreds;
    return [];
  });
});

describe('maybeRunDigestTick', () => {
  it('skips without adapter credentials (before claiming the marker)', async () => {
    mockGetSettings.mockResolvedValue([]);
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'no_adapters' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('debounces inside the interval', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) => {
      if (filter.category === 'integration') return integrationCreds;
      if (filter.key === 'DIGEST_TICK_LAST_RUN_AT') return [{ key: 'DIGEST_TICK_LAST_RUN_AT', value: new Date().toISOString() }];
      return [];
    });
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'debounced' });
  });

  it('claims the marker, composes, and delivers when due', async () => {
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r.ran).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith({}, 'org1', expect.objectContaining({ key: 'DIGEST_TICK_LAST_RUN_AT' }));
    expect(mockDeliver).toHaveBeenCalledTimes(1);
  });

  it('interval 0 disables', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) => {
      if (filter.category === 'integration') return integrationCreds;
      if (filter.key === 'DASHCLAW_DIGEST_INTERVAL_HOURS') return [{ key: 'DASHCLAW_DIGEST_INTERVAL_HOURS', value: '0' }];
      return [];
    });
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'disabled' });
  });

  it('rolls the marker back when every delivery fails', async () => {
    mockDeliver.mockResolvedValue([{ provider: 'slack', success: false, message: 'down' }]);
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: true, delivered: 0 });
    // last upsert restores the previous marker (null → epoch-ish restore is fine; assert 2 writes)
    expect(mockUpsert.mock.calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Implement `app/lib/digest-tick.ts`** (mirror `drift-tick.ts`):

```ts
// W3 digest cadence without cron: piggyback on request traffic with a
// claimed settings marker (drift-tick pattern). Fail-quiet — never affects
// the request that triggered it (callers run it inside after()).
import { getSettings, upsertSetting } from './repositories/settings.repository';
import { composeFleetDigest } from './fleet-digest';
import { deliverNativeNotifications } from './notification-adapters/index';

export const DIGEST_TICK_MARKER_KEY = 'DIGEST_TICK_LAST_RUN_AT';
const DEFAULT_INTERVAL_HOURS = 24;

type SqlTag = unknown;

export interface DigestTickResult {
  ran: boolean;
  reason?: 'no_adapters' | 'disabled' | 'debounced' | 'marker_write_failed' | 'error';
  delivered?: number;
}

async function readSetting(sql: SqlTag, orgId: string, key: string): Promise<string | null> {
  try {
    const rows = (await getSettings(sql as never, orgId, { key })) as Array<{ value?: unknown }>;
    return rows[0]?.value != null ? String(rows[0].value) : null;
  } catch {
    return null;
  }
}

export async function maybeRunDigestTick(sql: SqlTag, orgId: string): Promise<DigestTickResult> {
  try {
    // Cheapest checks first: creds, then interval, then marker.
    const integration = (await getSettings(sql as never, orgId, { category: 'integration' })) as unknown[];
    if (!integration.length) return { ran: false, reason: 'no_adapters' };

    const intervalRaw = await readSetting(sql, orgId, 'DASHCLAW_DIGEST_INTERVAL_HOURS');
    const intervalHours = intervalRaw === null ? DEFAULT_INTERVAL_HOURS : Number(intervalRaw);
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) return { ran: false, reason: 'disabled' };

    const markerRaw = await readSetting(sql, orgId, DIGEST_TICK_MARKER_KEY);
    const lastRunAt = markerRaw ? Date.parse(markerRaw) : NaN;
    if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < intervalHours * 3600_000) {
      return { ran: false, reason: 'debounced' };
    }

    // Claim before running (thundering-herd guard, same as drift-tick).
    try {
      await upsertSetting(sql as never, orgId, { key: DIGEST_TICK_MARKER_KEY, value: new Date().toISOString(), category: 'system' });
    } catch (err) {
      console.warn('[digest-tick] marker claim failed — skipping run:', (err as Error)?.message);
      return { ran: false, reason: 'marker_write_failed' };
    }

    const digest = await composeFleetDigest(sql, orgId);
    const signal = {
      severity: digest.quiet ? 'amber' : 'red',
      label: digest.quiet ? 'Daily fleet digest' : 'Daily fleet digest — needs attention',
      detail: digest.text,
    };
    const results = await deliverNativeNotifications(orgId, [signal] as never, integration as never, sql);
    const delivered = results.filter((r: { success?: boolean }) => r.success).length;

    if (delivered === 0 && results.length > 0) {
      // Total failure: restore the previous marker so the next traffic retries.
      try {
        await upsertSetting(sql as never, orgId, {
          key: DIGEST_TICK_MARKER_KEY,
          value: markerRaw ?? new Date(0).toISOString(),
          category: 'system',
        });
      } catch { /* next interval catches up */ }
      console.warn('[digest-tick] all deliveries failed — marker rolled back');
    }
    return { ran: true, delivered };
  } catch (err) {
    console.warn('[digest-tick] failed:', (err as Error)?.message);
    return { ran: false, reason: 'error' };
  }
}
```

- [ ] **Step 3: Hook into `POST /api/actions`.** In `app/api/actions/route.ts`, next to the existing `after(...)` calls (after the approval-surfaces call added in Task 3), add:

```ts
    // W3 digest cadence: piggyback on agent traffic (post-response, fail-quiet).
    after(() => {
      void import('../../lib/digest-tick').then(({ maybeRunDigestTick }) => maybeRunDigestTick(sql, orgId))
        .catch((err) => console.warn('[digest-tick] hook failed:', (err as Error)?.message));
    });
```

- [ ] **Step 4: Run** `npx vitest run __tests__/unit/digest-tick.test.js` plus the existing actions-route tests → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/digest-tick.ts app/api/actions/route.ts __tests__/unit/digest-tick.test.js
git commit -m "feat(digest): request-piggybacked digest tick with claimed marker + rollback on total send failure"
```

### Task 11: SessionStart hook — pending approvals + flood lines

**Files:**
- Modify: `hooks/dashclaw_session_digest.py` (**canonical source** — `plugins/dashclaw/hooks/` is a livingcode mirror; the pre-commit refresh syncs it)
- Test: manual run (the Python hooks have no pytest harness in this repo; verify by execution)

- [ ] **Step 1: Add the fleet-lite section to `main()`**, after the handoff block and before the `if len(lines) > 1:` tail:

```python
    # W3: pending approvals + flood state (one extra request, fail-silent).
    try:
        lite = _get("/api/digest/fleet?lite=1") or {}
        pa = lite.get("pending_approvals")
        if isinstance(pa, int) and pa > 0:
            age = lite.get("oldest_pending_minutes")
            suffix = f" (oldest {int(age)}m)" if isinstance(age, (int, float)) else ""
            lines.append(f"{pa} approval(s) pending{suffix} - review at {BASE_URL}/approvals")
        for f in (lite.get("floods") or [])[:2]:
            name = f.get("name") or f.get("policy_id") or "policy"
            lines.append(f"WARNING approval flood active: {name} ({f.get('count')} in window)")
    except Exception:
        pass
```

(Confirm `BASE_URL` is the variable name used by `_get` in the file; reuse whatever it has.)

- [ ] **Step 2: Verify by execution** (PowerShell, with a real local key):

```powershell
$env:DASHCLAW_URL = "http://localhost:3000"; python hooks/dashclaw_session_digest.py
```

Expected: digest prints (or exits silently without creds) — no traceback either way.

- [ ] **Step 3: Run `npm run livingcode:refresh`** (or let the pre-commit hook do it) so `plugins/dashclaw/hooks/` mirrors the change. Commit both copies:

```bash
git add hooks/dashclaw_session_digest.py plugins/dashclaw/hooks/dashclaw_session_digest.py
git commit -m "feat(digest): session digest surfaces pending approvals + active floods"
```

---

## Phase 3 — Docs, counts, gates

### Task 12: Documentation + drift gates + full verification

**Files:**
- Modify: `.env.example` (tuning-knobs section, ~line 270)
- Modify: `README.md:187`, `PROJECT_DETAILS.md:28` (route counts 317 → 320; experimental 239 → 242)
- Modify: `docs/superpowers/specs/2026-06-11-close-the-loop-design.md` — mark W3 shipped (one status line)
- Generated surfaces: regenerated by the pre-commit hook (api-inventory, openapi, livingcode)

- [ ] **Step 1: `.env.example`** — add to the tuning-knobs comment block:

```bash
# DASHCLAW_INTERRUPT_BUDGET=10        # org setting (settings table) — approval interrupts per policy per window before flood collapse
# DASHCLAW_INTERRUPT_WINDOW_MIN=15    # flood window in minutes
# DASHCLAW_INTERRUPT_BUDGET_FLEET=30  # fleet-wide interrupt budget per window
# DASHCLAW_DIGEST_INTERVAL_HOURS=24   # fleet digest cadence (0 disables); needs notification adapter creds
```

- [ ] **Step 2: Optional scheduler doc.** Create `docs/fleet-digest.md`:

```markdown
# Fleet digest

A daily digest (decision mix, pending approvals, interruption-budget state,
spend, top signals) delivered through your configured notification adapters
(Slack/Discord/email/...). Cadence: `DASHCLAW_DIGEST_INTERVAL_HOURS` org
setting (default 24, `0` disables). Requires adapter credentials in Settings.

Delivery piggybacks on agent traffic (no cron needed). If your fleet can be
idle for days and you still want a digest on schedule, add a GitHub Actions
kicker that exercises the tick:

​```yaml
# .github/workflows/digest-kicker.yml (optional — in YOUR ops repo, not required here)
on:
  schedule: [{ cron: '0 13 * * *' }]
jobs:
  kick:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s -X POST "$DASHCLAW_URL/api/actions" \
            -H "x-api-key: $DASHCLAW_API_KEY" -H "Content-Type: application/json" \
            -d '{"agent_id":"digest-kicker","action_type":"monitor","declared_goal":"digest tick"}'
        env:
          DASHCLAW_URL: ${{ secrets.DASHCLAW_URL }}
          DASHCLAW_API_KEY: ${{ secrets.DASHCLAW_API_KEY }}
​```
```

- [ ] **Step 3: Counts.** Run `node scripts/generate-api-inventory.mjs` (or rely on pre-commit), read the new totals from `docs/api-inventory.md`, and update README.md:187 and PROJECT_DETAILS.md:28 to the regenerated numbers (expected 320 total / 242 experimental — trust the generated file, not this plan). Run:

```bash
node scripts/check-doc-counts.mjs --strict
```

Expected: PASS. If it flags other stale counts (signal types in livingcode artifacts), `npm run livingcode:refresh` and re-run.

- [ ] **Step 4: Full gates** (read the output):

```bash
npm run lint
npm run typecheck
npx vitest run
npx next build
npm run route-sql:check
```

Expected: all pass; vitest count grows by the new test files.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md PROJECT_DETAILS.md docs/
git commit -m "docs(w3): interruption-budget + digest settings, route counts 317->320, W3 status"
```

- [ ] **Step 6: Ship.** Hand off to the owner's standing flow: `/dashclaw-preship-sweep`, then `dashclaw-ship` (version bump + release notes + deploy). SDKs unchanged — no `release:sdks` needed (no SDK source touched).

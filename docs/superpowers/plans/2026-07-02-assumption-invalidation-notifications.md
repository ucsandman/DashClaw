# Assumption-Invalidation Notifications (Advocate v2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an operator invalidates an assumption, the owning agent hears about it — a durable inbox message plus an `assumption_alerts` advisory riding every guard response until acknowledged.

**Architecture:** No new tables. The invalidation PATCH writes an `agent_messages` row (`message_type: 'assumption_invalidated'`, `doc_ref` = the `asm_*` id); the guard POST attaches unread alerts as a sibling field (like `secret_scan`); the pretool hook prints them and marks them read (the ack). Spec: `docs/superpowers/specs/2026-07-02-assumption-invalidation-notifications-design.md`.

**Tech Stack:** Next.js 16 App Router routes (TS), Neon `sql` template tag via repositories, Python pretool hook, vitest + pytest, `scripts/policy-smoke.mjs` live harness.

## Global Constraints

- Advisory only: `assumption_alerts` must NEVER change the guard decision, block, or add an LLM call (spec §2; v2.1 lesson).
- No direct SQL in `app/api/**/route.ts` — repositories only (`npm run route-sql:check`).
- Operator-only trigger: do NOT add `assumption_invalidated` to the messages POST allowlist — only the server creates these.
- Pretool hook stays single-HTTP-call on the common path — the ack PATCH fires only when alerts are present.
- Notification failure must never fail the invalidation (PATCH still 200s; adds `notification_error`).
- Never hardcode hex colors — use existing `Badge` variants.
- For changed `.ts` files run `npm run typecheck` before pushing; full `npx vitest run` + `npm run lint` + `npx next build` before any push (app/** changed).

---

### Task 1: Notification helper `app/lib/assumption-notify.ts`

**Files:**
- Create: `app/lib/assumption-notify.ts`
- Test: `__tests__/unit/assumption-notify.test.js`

**Interfaces:**
- Consumes: `createMessage(sql, payload)` from `app/lib/repositories/messagesContext.repository.ts:125` (payload: `{ id, orgId, thread_id, from_agent_id, to_agent_id, message_type, subject, body, urgent, doc_ref, now }`); `EVENTS, publishOrgEvent` from `app/lib/events`; `baseAgentId(agentId)` from `app/lib/agent-identity-resolve.ts:14` (returns text before first `:` or null).
- Produces: `ASSUMPTION_INVALIDATED_TYPE` (string const), `notifyAssumptionInvalidated(sql, orgId, input) => Promise<{ message_id: string } | null>`, `getAssumptionAlerts(sql, orgId, agentId) => Promise<Alert[] | null>` where `Alert = { message_id, assumption_id, assumption, invalidated_reason, action_id, invalidated_at }`, and `__resetAssumptionAlertCache()` for tests. Tasks 2, 4, 7 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/assumption-notify.test.js` (mirror the mock pattern of `__tests__/unit/assumptions-route.test.js:6-15`):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
const mockCreateMessage = vi.fn();
const mockPublish = vi.fn();

vi.mock('../../app/lib/repositories/messagesContext.repository', () => ({
  createMessage: (...args) => mockCreateMessage(...args),
}));
vi.mock('../../app/lib/events', () => ({
  EVENTS: { MESSAGE_CREATED: 'message.created' },
  publishOrgEvent: (...args) => mockPublish(...args),
}));

const { notifyAssumptionInvalidated, getAssumptionAlerts, __resetAssumptionAlertCache, ASSUMPTION_INVALIDATED_TYPE } =
  await import('../../app/lib/assumption-notify');

beforeEach(() => {
  vi.clearAllMocks();
  __resetAssumptionAlertCache();
});

describe('notifyAssumptionInvalidated', () => {
  const input = {
    agent_id: 'coder-1',
    assumption_id: 'asm_abc',
    assumption: 'the flag is enabled',
    invalidated_reason: 'flag is OFF in prod',
    invalidated_at: '2026-07-02T00:00:00.000Z',
    action_id: 'act_1',
  };

  it('creates a direct message with the JSON directive and doc_ref', async () => {
    mockCreateMessage.mockResolvedValue({ id: 'msg_x' });
    const out = await notifyAssumptionInvalidated(mockSql, 'org_1', input);
    expect(out).toEqual({ message_id: expect.stringMatching(/^msg_/) });
    const payload = mockCreateMessage.mock.calls[0][1];
    expect(payload.to_agent_id).toBe('coder-1');
    expect(payload.message_type).toBe(ASSUMPTION_INVALIDATED_TYPE);
    expect(payload.doc_ref).toBe('asm_abc');
    const body = JSON.parse(payload.body);
    expect(body).toMatchObject({
      directive: 'assumption_invalidated',
      assumption_id: 'asm_abc',
      invalidated_reason: 'flag is OFF in prod',
      action_id: 'act_1',
    });
    expect(mockPublish).toHaveBeenCalledWith('message.created', expect.objectContaining({ orgId: 'org_1' }));
  });

  it('returns null (no message) when the assumption has no owning agent', async () => {
    const out = await notifyAssumptionInvalidated(mockSql, 'org_1', { ...input, agent_id: null });
    expect(out).toBeNull();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });
});

describe('getAssumptionAlerts', () => {
  const row = (id) => ({
    id,
    body: JSON.stringify({ directive: 'assumption_invalidated', assumption_id: 'asm_abc', assumption: 'x', invalidated_reason: 'r', action_id: 'act_1', invalidated_at: 't' }),
    created_at: 't',
  });

  it('returns parsed alerts for unread messages', async () => {
    mockSql.mockResolvedValueOnce([row('msg_1')]);
    const alerts = await getAssumptionAlerts(mockSql, 'org_1', 'coder-1');
    expect(alerts).toEqual([
      { message_id: 'msg_1', assumption_id: 'asm_abc', assumption: 'x', invalidated_reason: 'r', action_id: 'act_1', invalidated_at: 't' },
    ]);
  });

  it('caches the empty result for 30s (second call skips the query)', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await getAssumptionAlerts(mockSql, 'org_1', 'coder-1')).toBeNull();
    expect(await getAssumptionAlerts(mockSql, 'org_1', 'coder-1')).toBeNull();
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('notify clears the negative cache so new alerts surface immediately', async () => {
    mockSql.mockResolvedValueOnce([]);
    await getAssumptionAlerts(mockSql, 'org_1', 'coder-1');
    mockCreateMessage.mockResolvedValue({ id: 'msg_x' });
    await notifyAssumptionInvalidated(mockSql, 'org_1', {
      agent_id: 'coder-1', assumption_id: 'asm_abc', assumption: 'x',
      invalidated_reason: 'r', invalidated_at: 't', action_id: 'act_1',
    });
    mockSql.mockResolvedValueOnce([row('msg_2')]);
    const alerts = await getAssumptionAlerts(mockSql, 'org_1', 'coder-1');
    expect(alerts).toHaveLength(1);
  });

  it('swallows query errors and returns null (advisory must not break guard)', async () => {
    mockSql.mockRejectedValueOnce(new Error('boom'));
    expect(await getAssumptionAlerts(mockSql, 'org_1', 'coder-1')).toBeNull();
  });

  it('returns null without querying when agentId is missing', async () => {
    expect(await getAssumptionAlerts(mockSql, 'org_1', null)).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/assumption-notify.test.js`
Expected: FAIL — cannot resolve `app/lib/assumption-notify`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/assumption-notify.ts`:

```ts
// Advocate v2a: assumption-invalidation notifications.
// The agent_messages row IS the notification record; its read state IS the ack.
// Spec: docs/superpowers/specs/2026-07-02-assumption-invalidation-notifications-design.md
import { randomUUID } from 'crypto';
import { createMessage } from './repositories/messagesContext.repository';
import { EVENTS, publishOrgEvent } from './events';
import { baseAgentId } from './agent-identity-resolve';

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

export const ASSUMPTION_INVALIDATED_TYPE = 'assumption_invalidated';

export type AssumptionAlert = {
  message_id: string;
  assumption_id: string | null;
  assumption: string | null;
  invalidated_reason: string | null;
  action_id: string | null;
  invalidated_at: string | null;
};

type NotifyInput = {
  agent_id: string | null;
  assumption_id: string;
  assumption: string;
  invalidated_reason: string;
  invalidated_at: string;
  action_id: string | null;
};

const ALERT_CACHE_TTL_MS = 30_000;
// Negative cache only: "agent X had no unread alerts". Positive hits are rare
// and must never be served stale (the hook acks them immediately).
const noAlertCache = new Map<string, number>();

export function __resetAssumptionAlertCache(): void {
  noAlertCache.clear();
}

export async function notifyAssumptionInvalidated(
  sql: SqlClient,
  orgId: string,
  input: NotifyInput,
): Promise<{ message_id: string } | null> {
  if (!input.agent_id) return null; // parent action has no agent — nothing to notify
  const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  const subjectText = input.assumption.length > 80 ? `${input.assumption.slice(0, 80)}…` : input.assumption;
  const body = JSON.stringify({
    directive: ASSUMPTION_INVALIDATED_TYPE,
    assumption_id: input.assumption_id,
    assumption: input.assumption,
    invalidated_reason: input.invalidated_reason,
    action_id: input.action_id,
    invalidated_at: input.invalidated_at,
  });
  const created = await createMessage(sql, {
    id,
    orgId,
    thread_id: null,
    from_agent_id: 'operator',
    to_agent_id: input.agent_id,
    message_type: ASSUMPTION_INVALIDATED_TYPE,
    subject: `Assumption invalidated: ${subjectText}`,
    body,
    urgent: true,
    doc_ref: input.assumption_id,
    now,
  });
  if (!created) return null;
  void publishOrgEvent(EVENTS.MESSAGE_CREATED, { orgId, message: created });
  noAlertCache.clear(); // rare event; cheap full clear beats per-family key math
  return { message_id: id };
}

export async function getAssumptionAlerts(
  sql: SqlClient,
  orgId: string,
  agentId: string | null,
): Promise<AssumptionAlert[] | null> {
  if (!agentId) return null;
  const key = `${orgId}|${agentId}`;
  const expires = noAlertCache.get(key);
  if (expires && expires > Date.now()) return null;
  try {
    const ids = [agentId];
    const base = baseAgentId(agentId);
    if (base && base !== agentId) ids.push(base);
    // Family match both directions: a parent hears about its subagents'
    // assumptions (LIKE 'parent:%') and a subagent hears about its base's.
    const rows = await sql`
      SELECT id, body, created_at
      FROM agent_messages
      WHERE org_id = ${orgId}
        AND message_type = ${ASSUMPTION_INVALIDATED_TYPE}
        AND status = 'sent'
        AND (to_agent_id = ANY(${ids}) OR to_agent_id LIKE ${agentId + ':%'})
      ORDER BY created_at DESC
      LIMIT 3
    `;
    if (!rows.length) {
      noAlertCache.set(key, Date.now() + ALERT_CACHE_TTL_MS);
      return null;
    }
    return rows.map((r) => {
      let directive: Record<string, unknown> = {};
      try {
        directive = JSON.parse(String(r.body || '{}'));
      } catch { /* malformed body — surface what we have */ }
      return {
        message_id: String(r.id),
        assumption_id: (directive.assumption_id as string) ?? null,
        assumption: (directive.assumption as string) ?? null,
        invalidated_reason: (directive.invalidated_reason as string) ?? null,
        action_id: (directive.action_id as string) ?? null,
        invalidated_at: (directive.invalidated_at as string) ?? null,
      };
    });
  } catch (err) {
    // Advisory lookup must never break the guard decision.
    console.warn('[Guard] assumption alerts lookup failed (advisory skipped):', (err as Error).message);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/assumption-notify.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add app/lib/assumption-notify.ts __tests__/unit/assumption-notify.test.js
git commit -m "feat(advocate): assumption-invalidation notify helper + alert lookup (v2.4)"
```

---

### Task 2: Wire notification into the assumptions PATCH route

**Files:**
- Modify: `app/api/assumptions/[assumptionId]/route.ts:79-113` (the `validated === false` branch)
- Test: `__tests__/unit/assumption-invalidation-route.test.js` (create)

**Interfaces:**
- Consumes: `notifyAssumptionInvalidated` from Task 1. The `existing` row from `getAssumption` already carries `agent_id` and `assumption_id` (repository joins `action_records`, `assumptions.repository.ts:164-178`).
- Produces: PATCH response gains optional `notification: { message_id }` and `notification_error: 'notification_failed'` fields. Task 7 (smoke) asserts `notification.message_id`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/assumption-invalidation-route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
const mockGetAssumption = vi.fn();
const mockUpdateAssumption = vi.fn();
const mockNotify = vi.fn();

vi.mock('../../app/lib/db', () => ({ getSql: () => mockSql }));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org_1' }));
vi.mock('../../app/lib/security', () => ({ redactAny: (v) => v }));
vi.mock('../../app/lib/repositories/assumptions.repository', () => ({
  getAssumption: (...a) => mockGetAssumption(...a),
  updateAssumption: (...a) => mockUpdateAssumption(...a),
}));
vi.mock('../../app/lib/assumption-notify', () => ({
  notifyAssumptionInvalidated: (...a) => mockNotify(...a),
}));

const { PATCH } = await import('../../app/api/assumptions/[assumptionId]/route');

const req = (body) => new Request('http://x/api/assumptions/asm_1', {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
const params = { params: Promise.resolve({ assumptionId: 'asm_1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAssumption.mockResolvedValue({
    id: 1, assumption_id: 'asm_1', assumption: 'flag on', invalidated: 0, action_id: 'act_1', agent_id: 'coder-1',
  });
  mockUpdateAssumption.mockResolvedValue({ assumption_id: 'asm_1', invalidated: 1, action_id: 'act_1' });
});

describe('PATCH /api/assumptions/[assumptionId] — invalidation notification', () => {
  it('notifies the owning agent and returns notification.message_id', async () => {
    mockNotify.mockResolvedValue({ message_id: 'msg_1' });
    const res = await PATCH(req({ validated: false, invalidated_reason: 'wrong' }), params);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.notification).toEqual({ message_id: 'msg_1' });
    expect(mockNotify).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({
      agent_id: 'coder-1', assumption_id: 'asm_1', invalidated_reason: 'wrong', action_id: 'act_1',
    }));
  });

  it('still 200s with notification_error when notify throws', async () => {
    mockNotify.mockRejectedValue(new Error('db down'));
    const res = await PATCH(req({ validated: false, invalidated_reason: 'wrong' }), params);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.assumption).toBeTruthy();
    expect(json.notification_error).toBe('notification_failed');
  });

  it('does not notify on validate', async () => {
    const res = await PATCH(req({ validated: true }), params);
    expect(res.status).toBe(200);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('does not notify when the race-loss 409 fires', async () => {
    mockUpdateAssumption.mockResolvedValue(null);
    const res = await PATCH(req({ validated: false, invalidated_reason: 'wrong' }), params);
    expect(res.status).toBe(409);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/assumption-invalidation-route.test.js`
Expected: FAIL — `json.notification` undefined (route doesn't call notify yet).

- [ ] **Step 3: Implement the route change**

In `app/api/assumptions/[assumptionId]/route.ts`, add the import:

```ts
import { notifyAssumptionInvalidated } from '../../../lib/assumption-notify';
```

Replace the final `return NextResponse.json({ assumption: result, security: {...} })` of the invalidate branch (lines 104-112) with:

```ts
      // Advocate v2a: tell the owning agent its assumption was invalidated.
      // The notification is best-effort — the invalidation is already committed.
      let notification: { message_id: string } | null = null;
      let notificationError: string | null = null;
      try {
        notification = await notifyAssumptionInvalidated(sql, orgId, {
          agent_id: (existing.agent_id as string) ?? null,
          assumption_id: String(existing.assumption_id ?? assumptionId),
          assumption: String(existing.assumption ?? ''),
          invalidated_reason: safeReason as string,
          invalidated_at: now,
          action_id: (existing.action_id as string) ?? null,
        });
      } catch (err) {
        console.error('Assumption invalidation notify failed:', err);
        notificationError = 'notification_failed';
      }
      return NextResponse.json({
        assumption: result,
        security: {
          clean: dlpFindings.length === 0,
          findings_count: dlpFindings.length,
          critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
          categories: [...new Set(dlpFindings.map(f => f.category))],
        },
        ...(notification ? { notification } : {}),
        ...(notificationError ? { notification_error: notificationError } : {}),
      });
```

- [ ] **Step 4: Run the test and the existing assumptions tests**

Run: `npx vitest run __tests__/unit/assumption-invalidation-route.test.js __tests__/unit/assumptions-route.test.js __tests__/unit/assumptions-repository.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add app/api/assumptions/[assumptionId]/route.ts __tests__/unit/assumption-invalidation-route.test.js
git commit -m "feat(advocate): invalidation PATCH notifies the owning agent (v2.4)"
```

---

### Task 3: Fix the operator invalidate click path (latent 404)

The `/assumptions` page sets `data-entity-id={a.id}` (serial int, `app/assumptions/page.tsx:171`) but the context menu PATCHes `/api/assumptions/${entity.id}` (`app/components/context-menu/actionRegistry.tsx:198-217`) and the route resolves by `assumption_id` only (`assumptions.repository.ts:175`). The operator Validate/Invalidate menu therefore 404s. This is THE trigger for v2.4 — fix it.

**Files:**
- Modify: `app/assumptions/page.tsx:171` (the `data-entity-id` attribute)
- Check (read-only): `app/components/AssumptionGraph.tsx` and `app/components/ActivityTimeline.tsx:207` — if either sets `data-entity-type="assumption"` with a serial id, apply the same one-line fix.
- Test: manual + covered live by Task 7's smoke (N1 PATCHes by `assumption_id`).

**Interfaces:**
- Consumes: nothing new. Produces: context-menu entity id for assumptions is now the `asm_*` id, matching the detail route.

- [ ] **Step 1: Reproduce (evidence first)**

With the dev server running (`npm run dev`) and at least one assumption present, run:

```bash
curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/assumptions/1" -H "x-api-key: $DASHCLAW_API_KEY" -H "content-type: application/json" -d "{\"validated\":true}"
```

Expected: `404` (numeric id doesn't match `assumption_id`). If this returns 200, the repository already matches both ids — skip Steps 2-3 and record that in the commit message of the next task instead.

- [ ] **Step 2: Fix the entity id on the page**

In `app/assumptions/page.tsx` change:

```tsx
<Card key={a.id} data-entity-type="assumption" data-entity-id={a.id} data-entity-status={status} hover={false}>
```

to:

```tsx
<Card key={a.id} data-entity-type="assumption" data-entity-id={a.assumption_id || a.id} data-entity-status={status} hover={false}>
```

Grep the two other components for the same pattern and apply the same fix if they target assumptions with a serial id:

```bash
grep -n "data-entity-type=\"assumption\"" app/components/AssumptionGraph.tsx app/components/ActivityTimeline.tsx
```

- [ ] **Step 3: Verify via the API shape the menu uses**

```bash
curl -s -X PATCH "http://localhost:3000/api/assumptions/<an asm_* id from GET /api/assumptions>" -H "x-api-key: $DASHCLAW_API_KEY" -H "content-type: application/json" -d "{\"validated\":true}"
```

Expected: 200 with the updated assumption.

- [ ] **Step 4: Commit**

```bash
git add app/assumptions/page.tsx
git commit -m "fix(assumptions): context-menu validate/invalidate targeted serial id, route matches assumption_id (v2.4 trigger path)"
```

---

### Task 4: Guard response carries `assumption_alerts`

**Files:**
- Modify: `app/api/guard/route.ts` (import; attach after line 363 `secret_scan` set; attach on the idempotent-replay object after line 331)
- Test: `__tests__/unit/guard-assumption-alerts.test.js` (create)

**Interfaces:**
- Consumes: `getAssumptionAlerts(sql, orgId, agentId)` from Task 1; `data.agent_id` (already JWT-normalized upstream at `route.ts:186-193`).
- Produces: guard POST response optionally includes `assumption_alerts: AssumptionAlert[]` (max 3). Tasks 5 and 7 rely on this field name.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/guard-assumption-alerts.test.js`, mirroring the mock stack of `__tests__/unit/guard.route.test.js:11-14` (copy its full `vi.mock` preamble — db, validate, guard, guard.repository — then add):

```js
const mockGetAssumptionAlerts = vi.fn();
vi.mock('@/lib/assumption-notify', () => ({
  getAssumptionAlerts: (...a) => mockGetAssumptionAlerts(...a),
}));
```

Tests (adapt the existing file's request-builder helper for a valid guard POST body):

```js
describe('guard POST — assumption_alerts advisory', () => {
  it('attaches alerts for the calling agent', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', allowed: true, risk_score: 10 });
    mockGetAssumptionAlerts.mockResolvedValue([{ message_id: 'msg_1', assumption_id: 'asm_1' }]);
    const res = await POST(guardRequest({ agent_id: 'coder-1', action_type: 'x', declared_goal: 'y' }));
    const json = await res.json();
    expect(json.decision).toBe('allow');
    expect(json.assumption_alerts).toEqual([{ message_id: 'msg_1', assumption_id: 'asm_1' }]);
  });

  it('omits the field when there are no alerts', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', allowed: true, risk_score: 10 });
    mockGetAssumptionAlerts.mockResolvedValue(null);
    const res = await POST(guardRequest({ agent_id: 'coder-1', action_type: 'x', declared_goal: 'y' }));
    const json = await res.json();
    expect('assumption_alerts' in json).toBe(false);
  });

  it('never calls the lookup without an agent_id', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', allowed: true, risk_score: 10 });
    const res = await POST(guardRequest({ action_type: 'x', declared_goal: 'y' }));
    await res.json();
    expect(mockGetAssumptionAlerts).not.toHaveBeenCalled();
  });

  it('decision is unchanged when alerts are present on a block', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'block', allowed: false, risk_score: 90 });
    mockGetAssumptionAlerts.mockResolvedValue([{ message_id: 'msg_1' }]);
    const res = await POST(guardRequest({ agent_id: 'coder-1', action_type: 'x', declared_goal: 'y' }));
    const json = await res.json();
    expect(json.decision).toBe('block');
    expect(json.assumption_alerts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/guard-assumption-alerts.test.js`
Expected: FAIL — `assumption_alerts` undefined.

- [ ] **Step 3: Implement the route attach**

In `app/api/guard/route.ts` add the import:

```ts
import { getAssumptionAlerts } from '../../lib/assumption-notify';
```

Immediately after `if (secretScan) (result as Record<string, unknown>).secret_scan = secretScan;` (line 363) add:

```ts
    // Advocate v2a advisory — rides until acknowledged; never changes the decision.
    {
      const alertAgent = typeof data.agent_id === 'string' && data.agent_id ? data.agent_id : null;
      if (alertAgent) {
        const alerts = await getAssumptionAlerts(sql, orgId, alertAgent);
        if (alerts && alerts.length) (result as Record<string, unknown>).assumption_alerts = alerts;
      }
    }
```

And in the idempotent-replay branch, after `if (secretScan) replay.secret_scan = secretScan;` (line 331) add the same block with `replay` in place of `result`.

- [ ] **Step 4: Run the new test plus the guard suites**

Run: `npx vitest run __tests__/unit/guard-assumption-alerts.test.js __tests__/unit/guard.route.test.js __tests__/unit/guard-route-idempotency.test.js __tests__/unit/guard-hotpath.test.js __tests__/unit/guard-mcp-parity.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add app/api/guard/route.ts __tests__/unit/guard-assumption-alerts.test.js
git commit -m "feat(guard): assumption_alerts advisory rides guard responses until acked (v2.4)"
```

---

### Task 5: Pretool hook surfaces alerts and acknowledges them

**Files:**
- Modify: `hooks/dashclaw_pretool.py` (new `_warn_assumption_alerts` next to `_warn_secret_scan:1204`; call it at the step-6 site, line 1303)
- Test: `hooks/tests/test_pretool_assumption_alerts.py` (create; copy the sys.path/import bootstrap from `hooks/tests/test_pretool_guard_unavailable.py`)

**Interfaces:**
- Consumes: `guard_resp["assumption_alerts"]` (Task 4 shape); existing `api_request(method, path, body=None, timeout=None, retries=2, ...)` (`dashclaw_pretool.py:206`), `log()` (line 171), module global `AGENT_ID`.
- Produces: `_warn_assumption_alerts(guard_resp)`.

- [ ] **Step 1: Write the failing test**

Create `hooks/tests/test_pretool_assumption_alerts.py` (mirror the existing bootstrap for importing `dashclaw_pretool`):

```python
import dashclaw_pretool as pretool  # via the same sys.path bootstrap the other hook tests use


def test_prints_and_acks_when_alerts_present(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(pretool, "api_request", lambda *a, **k: calls.append((a, k)) or {})
    guard_resp = {
        "decision": "allow",
        "assumption_alerts": [
            {"message_id": "msg_1", "assumption": "flag is on", "invalidated_reason": "flag is OFF"},
        ],
    }
    pretool._warn_assumption_alerts(guard_resp)
    err = capsys.readouterr().err
    assert "invalidated an assumption" in err
    assert "flag is OFF" in err
    assert len(calls) == 1
    (method, path), kwargs = calls[0][0], calls[0][1]
    assert method == "PATCH" and path == "/api/messages"
    assert kwargs["body"]["message_ids"] == ["msg_1"]
    assert kwargs["body"]["action"] == "read"


def test_no_alerts_no_output_no_http(monkeypatch, capsys):
    called = []
    monkeypatch.setattr(pretool, "api_request", lambda *a, **k: called.append(1))
    pretool._warn_assumption_alerts({"decision": "allow"})
    assert capsys.readouterr().err == ""
    assert called == []


def test_ack_failure_is_silent(monkeypatch, capsys):
    def boom(*a, **k):
        raise RuntimeError("network down")
    monkeypatch.setattr(pretool, "api_request", boom)
    pretool._warn_assumption_alerts({"assumption_alerts": [{"message_id": "msg_1", "assumption": "x", "invalidated_reason": "r"}]})
    assert "invalidated an assumption" in capsys.readouterr().err  # warning printed, no exception
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest hooks/tests/test_pretool_assumption_alerts.py -v`
Expected: FAIL — `_warn_assumption_alerts` does not exist.

- [ ] **Step 3: Implement the hook function**

In `hooks/dashclaw_pretool.py`, directly below `_warn_secret_scan` (after line 1214), add:

```python
def _warn_assumption_alerts(guard_resp):
    """Advocate v2a: an operator invalidated an assumption this agent recorded.
    Advisory only — printed even on allow, never changes the decision. After
    surfacing, acknowledge (mark the inbox message read) so the alert stops
    riding future guard responses. The ack is the ONLY extra HTTP call and it
    fires solely when alerts are present, so the common path stays single-call."""
    try:
        alerts = guard_resp.get("assumption_alerts") or []
        if not alerts:
            return
        message_ids = []
        for a in alerts[:3]:
            text = (a.get("assumption") or "an assumption")[:120]
            reason = (a.get("invalidated_reason") or "no reason given")[:200]
            log('[DashClaw] ⚠ Operator invalidated an assumption you recorded: "%s" — reason: %s. Re-verify before relying on it.' % (text, reason))
            if a.get("message_id"):
                message_ids.append(a["message_id"])
        if message_ids:
            api_request("PATCH", "/api/messages",
                        body={"message_ids": message_ids, "action": "read", "agent_id": AGENT_ID},
                        retries=0)
    except Exception:
        pass  # fail-silent: the alert simply rides again next call
```

At the step-6 call site (line 1303), after `_warn_secret_scan(guard_resp, decision)`, add:

```python
    _warn_assumption_alerts(guard_resp)
```

- [ ] **Step 4: Run the hook test suite**

Run: `python -m pytest hooks/tests/test_pretool_assumption_alerts.py hooks/tests/test_pretool_integration.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/dashclaw_pretool.py hooks/tests/test_pretool_assumption_alerts.py
git commit -m "feat(hooks): pretool surfaces + acks assumption-invalidation alerts (v2.4)"
```

Note: the RUNNING hooks are the repo files — this takes effect for new sessions/next hook invocation (known gotcha).

---

### Task 6: Human-visible surfaces — /assumptions delivery chip, /messages type option

**Files:**
- Modify: `app/lib/repositories/messagesContext.repository.ts` (add `getAssumptionNotificationStates`)
- Modify: `app/api/assumptions/route.ts` GET (attach `notification_status` to invalidated rows)
- Modify: `app/assumptions/page.tsx` (chip next to the drift badge, lines 166-213 block)
- Modify: `app/messages/page.tsx:28` (`MESSAGE_TYPES` array)
- Test: extend `__tests__/unit/assumptions-route.test.js` with one new test

**Interfaces:**
- Consumes: messages written by Task 1 (`message_type = 'assumption_invalidated'`, `doc_ref` = `asm_*` id, `status` column).
- Produces: `getAssumptionNotificationStates(sql, orgId, assumptionIds) => Promise<Map<string, 'unread'|'acknowledged'>>`; list-route rows gain `notification_status`.

- [ ] **Step 1: Write the failing route test**

Append to `__tests__/unit/assumptions-route.test.js` (reuse its existing mock setup; add a mock for the new repository export alongside the existing messagesContext mocks if that file mocks it, otherwise add `vi.mock` for `messagesContext.repository`):

```js
it('annotates invalidated rows with notification_status', async () => {
  mockListAssumptions.mockResolvedValue({
    assumptions: [
      { id: 1, assumption_id: 'asm_1', invalidated: 1, validated: 0, created_at: '2026-07-01' },
      { id: 2, assumption_id: 'asm_2', invalidated: 0, validated: 0, created_at: '2026-07-01' },
    ],
    total: 2,
  });
  mockGetAssumptionNotificationStates.mockResolvedValue(new Map([['asm_1', 'acknowledged']]));
  const res = await GET(new Request('http://x/api/assumptions'));
  const json = await res.json();
  expect(json.assumptions[0].notification_status).toBe('acknowledged');
  expect(json.assumptions[1].notification_status).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/assumptions-route.test.js`
Expected: FAIL — `notification_status` undefined.

- [ ] **Step 3: Implement repository + route + UI**

In `app/lib/repositories/messagesContext.repository.ts` add:

```ts
export async function getAssumptionNotificationStates(
  sql: SqlClient,
  orgId: string,
  assumptionIds: string[],
): Promise<Map<string, 'unread' | 'acknowledged'>> {
  const map = new Map<string, 'unread' | 'acknowledged'>();
  if (!assumptionIds.length) return map;
  const rows = await sql`
    SELECT doc_ref, status
    FROM agent_messages
    WHERE org_id = ${orgId}
      AND message_type = 'assumption_invalidated'
      AND doc_ref = ANY(${assumptionIds})
  `;
  for (const r of rows) {
    const state = r.status === 'read' || r.status === 'archived' ? 'acknowledged' : 'unread';
    map.set(String(r.doc_ref), state);
  }
  return map;
}
```

In `app/api/assumptions/route.ts` GET, right after `const total = result.total;` (before the drift branch so both branches carry it):

```ts
    // Advocate v2a: delivery state for invalidated rows (message read = acked).
    const invalidatedIds = assumptions
      .filter((a) => a.invalidated === 1 && a.assumption_id)
      .map((a) => String(a.assumption_id));
    if (invalidatedIds.length) {
      try {
        const states = await getAssumptionNotificationStates(sql, orgId, invalidatedIds);
        for (const asm of assumptions) {
          const st = states.get(String(asm.assumption_id));
          if (st) asm.notification_status = st;
        }
      } catch (err) {
        console.warn('Assumption notification-state lookup failed (list unannotated):', (err as Error).message);
      }
    }
```

with the import added to the existing repository import line's neighborhood:

```ts
import { getAssumptionNotificationStates } from '../../lib/repositories/messagesContext.repository';
```

In `app/assumptions/page.tsx`, inside the badge column (after the drift-score badge, ~line 208):

```tsx
{status === 'invalidated' && typeof a.notification_status === 'string' && (
  <Badge variant={a.notification_status === 'acknowledged' ? 'success' : 'warning'} size="xs">
    {a.notification_status === 'acknowledged' ? 'agent acknowledged' : 'agent notified · unread'}
  </Badge>
)}
```

In `app/messages/page.tsx:28`:

```tsx
const MESSAGE_TYPES = ['info', 'action', 'question', 'lesson', 'status', 'assumption_invalidated'];
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `npx vitest run __tests__/unit/assumptions-route.test.js && npm run lint && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Verify rendered (feature-visibility gate)**

Use the frontend-verify skill (or drive headless) against `npm run dev`: seed one invalidated assumption with a notification (Task 7's smoke scenario does this), load `/assumptions`, confirm the "agent notified · unread" badge renders; mark the message read via `PATCH /api/messages`, reload, confirm "agent acknowledged".

- [ ] **Step 6: Commit**

```bash
git add app/lib/repositories/messagesContext.repository.ts app/api/assumptions/route.ts app/assumptions/page.tsx app/messages/page.tsx __tests__/unit/assumptions-route.test.js
git commit -m "feat(assumptions): delivery/ack chip on /assumptions + message type surfaced (v2.4)"
```

---

### Task 7: Policy-smoke scenario (live proof, N1–N5)

**Files:**
- Modify: `scripts/policy-smoke.mjs` (new block before the summary section; uses the existing `api()` helper at lines 56-65 and `check()` at 86-89)

**Interfaces:**
- Consumes: everything shipped in Tasks 1-6, live against a running instance.
- Produces: 5 new checks; smoke total rises 67 → 72.

- [ ] **Step 1: Add the scenario block**

```js
// ── Advocate v2a: assumption-invalidation notifications (N1–N5) ──────────
{
  const agent = `smoke-asm-${RUN}`;
  const act = await api('POST', '/api/actions', {
    agent_id: agent, action_type: `smoke.assumption.${RUN}`,
    declared_goal: `assumption invalidation scenario ${RUN}`,
  });
  const actionId = act.json?.action?.action_id || act.json?.action_id;
  const asm = await api('POST', '/api/assumptions', {
    action_id: actionId, assumption: `the flag is enabled (${RUN})`, basis: 'smoke seed',
  });
  const asmRow = asm.json?.assumption || asm.json || {};

  const inv = await api('PATCH', `/api/assumptions/${asmRow.assumption_id}`, {
    validated: false, invalidated_reason: `operator says the flag is OFF (${RUN})`,
  });
  check('N1', 'operator invalidation 200s and reports notification.message_id',
    inv.status === 200 && !!inv.json?.notification?.message_id,
    `status=${inv.status} body=${JSON.stringify(inv.json)?.slice(0, 200)}`);

  const inbox = await api('GET', `/api/messages?agent_id=${agent}&type=assumption_invalidated&unread=true`);
  const msgs = inbox.json?.messages || [];
  check('N2', 'invalidation lands as one unread inbox message with doc_ref',
    msgs.length === 1 && msgs[0]?.doc_ref === asmRow.assumption_id,
    `count=${msgs.length} doc_ref=${msgs[0]?.doc_ref}`);

  const g1 = await api('POST', '/api/guard', {
    agent_id: agent, action_type: `smoke.assumption.next.${RUN}`,
    declared_goal: `act after invalidation ${RUN}`,
  });
  const alerts = g1.json?.assumption_alerts || [];
  check('N3', 'guard response carries assumption_alerts until acked',
    alerts.length >= 1 && alerts[0]?.assumption_id === asmRow.assumption_id,
    `alerts=${JSON.stringify(alerts)?.slice(0, 200)}`);

  await api('PATCH', '/api/messages', {
    message_ids: [alerts[0]?.message_id].filter(Boolean), action: 'read', agent_id: agent,
  });
  const g2 = await api('POST', '/api/guard', {
    agent_id: agent, action_type: `smoke.assumption.after.${RUN}`,
    declared_goal: `act after ack ${RUN}`,
  });
  check('N4', 'after ack, guard response carries no assumption_alerts',
    !(g2.json?.assumption_alerts?.length),
    `alerts=${JSON.stringify(g2.json?.assumption_alerts)?.slice(0, 200)}`);

  const list = await api('GET', `/api/assumptions?agent_id=${agent}`);
  const row = (list.json?.assumptions || []).find(r => r.assumption_id === asmRow.assumption_id);
  check('N5', '/api/assumptions exposes notification_status=acknowledged',
    row?.notification_status === 'acknowledged',
    `row=${JSON.stringify(row)?.slice(0, 200)}`);
}
```

Ordering note: N3 must run before any other guard call for this agent in the scenario — the negative cache only forms on an empty lookup, and the notify clears it anyway; this ordering keeps the checks deterministic even cross-instance.

- [ ] **Step 2: Run the smoke live**

Kill anything on :3000 first (two dev servers fighting one `.next` lock produce phantom 500s), start `npm run dev`, then:

Run: `node scripts/policy-smoke.mjs`
Expected: `72 checks, 72 passed, 0 failed` (all N1–N5 PASS).

- [ ] **Step 3: Commit**

```bash
git add scripts/policy-smoke.mjs
git commit -m "test(smoke): N1-N5 pin assumption-invalidation notifications live (67 -> 72)"
```

---

### Task 8: Docs, counts, changelog

**Files:**
- Modify: `docs/architecture/runtime-api.md` (guard response: `assumption_alerts` field; assumptions PATCH: notification side effect + `notification`/`notification_error` response fields)
- Check/modify: grep `README.md`, `PROJECT_DETAILS.md`, `docs/`, memory-cited smoke count — anything citing message types or "67 checks"
- Modify: `CHANGELOG.md` (entry under the next version — the version bump itself happens at ship via `npm run version:set`)
- Modify: `docs/maintainer-log.md` (outside-reader-voice entry, per MAINTAINER.md)

**Interfaces:** none — documentation of Tasks 1-7's surfaces exactly as built.

- [ ] **Step 1: Update runtime-api.md**

Add to the guard response documentation (next to `secret_scan`):

```markdown
- `assumption_alerts` (optional): present when an operator invalidated an
  assumption this agent (or its identity family) recorded and the alert has
  not been acknowledged. Array of up to 3:
  `{ message_id, assumption_id, assumption, invalidated_reason, action_id, invalidated_at }`.
  Advisory only — never changes the decision. Acknowledge by marking the
  message read (`PATCH /api/messages { message_ids, action: "read" }`);
  governed hooks do this automatically after surfacing the warning.
```

And to the assumptions PATCH documentation: invalidating (`validated: false`) also sends the owning agent an inbox message (`message_type: assumption_invalidated`, `doc_ref` = assumption id); response gains `notification: { message_id }` or `notification_error: "notification_failed"`.

- [ ] **Step 2: Sweep the counts**

```bash
node scripts/check-doc-counts.mjs --strict
grep -rn "67 checks\|smoke = 67" README.md PROJECT_DETAILS.md docs/ .claude/ 2>/dev/null
```

Fix any hits (new truth: 72 checks). Expected: checker exits 0 after fixes.

- [ ] **Step 3: CHANGELOG + maintainer log entries**

CHANGELOG (under the upcoming version heading; ship bumps the number):

```markdown
### Added
- Assumption-invalidation notifications (Advocate v2a, roadmap v2.4): operator
  invalidation now notifies the owning agent — durable inbox message
  (`assumption_invalidated`) plus an `assumption_alerts` advisory on every
  guard response until acknowledged. The pretool hook surfaces the warning and
  auto-acks. `/assumptions` shows delivery state (notified/acknowledged).

### Fixed
- `/assumptions` context-menu Validate/Invalidate targeted the serial row id
  while the API matches `asm_*` ids — the operator invalidate path 404'd.
```

Maintainer-log: one entry in the established outside-reader voice describing what shipped and why (the write-only-ledger problem, the ack semantics).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/runtime-api.md CHANGELOG.md docs/maintainer-log.md
git commit -m "docs(advocate): assumption-invalidation notifications — runtime API, changelog, maintainer log (v2.4)"
```

---

### Task 9: Full verification gates

- [ ] **Step 1: Run the full gate set and READ the output**

```bash
npm run lint
npx vitest run
npm run typecheck
npx next build
python -m pytest hooks/tests/ -v
node scripts/policy-smoke.mjs
node scripts/check-doc-counts.mjs --strict
```

Expected: all pass; smoke = 72. Any failure gets fixed before proceeding — no deferrals.

- [ ] **Step 2: Ship**

Hand off to the `dashclaw-ship` skill (version bump to next minor, roadmap table update marking v2.4 DONE, push to main). Do not push before the gates above are green.

---

## Self-Review Notes

- Spec §1 (notify on invalidate) → Tasks 1-2. §2 (guard advisory + cache + family) → Tasks 1, 4. §3 (hook + ack) → Task 5. §4 (UI surfaces) → Task 6. Verification section → Tasks 7, 9. Out-of-scope items: none implemented anywhere. Error-handling section → Task 1 (swallow lookup), Task 2 (notification_error), Task 5 (silent ack failure).
- Extra beyond spec, justified: Task 3 fixes the latent 404 in the operator invalidate click path — v2.4's trigger — discovered during planning (repo rule: fix bugs found in scope, same turn).
- Type consistency: `assumption_alerts` / `notification_status` / `notification.message_id` / `getAssumptionAlerts` / `notifyAssumptionInvalidated` used identically across Tasks 1, 2, 4, 5, 6, 7, 8.
- MCP server needs no change: `dashclaw_guard` returns raw guard JSON (`mcp-server/src/tools.ts:658-708`), so `assumption_alerts` flows through; ack is the existing `dashclaw_messages_mark_read`. SDKs need no change for the same reason (spec's explicit no-new-SDK-methods decision — no SDK publish owed by this ship).

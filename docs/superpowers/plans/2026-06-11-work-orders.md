# Work Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Work Orders — task-grade contracts + self-verifying receipts ledger — natively in DashClaw, per the approved spec at `docs/superpowers/specs/2026-06-11-work-orders-design.md`, then realign the marketing site and ship via `/dashclaw-ship`.

**Architecture:** DashClaw is the contract + receipt **system of record only** — it never executes agent work. Orgs register work order types (JSON-Schema input/output contracts + budget/timeout defaults). Callers submit orders (guard-gated). External workers claim (leased) and complete them. Every terminal order gets a canonical, SHA-256-hashed receipt. No cron: lease expiry and approval release are swept lazily on read/claim.

**Tech Stack:** Next.js 16 App Router routes (TS), Postgres/Neon via repositories (tagged-template SQL), drizzle handwritten migrations, vitest, Node+Python SDKs, MCP server tools.

---

## Conventions & gotchas (read first, they all bite)

- **No direct SQL in `app/api/**/route.*`** — everything goes through `app/lib/repositories/work-orders.repository.ts`. `npm run route-sql:check` blocks violations.
- **After editing `schema/schema.js` + adding the migration, run `npm run db:migrate`** or every authenticated request 401s ("Invalid or missing API key").
- **Postgres `numeric` comes back as a string** on the Neon driver — `Number()` before comparing costs.
- **`ON CONFLICT ON CONSTRAINT` can't match a unique INDEX** — use `ON CONFLICT (col, col)`.
- **Routes are `.ts`** → run `npm run typecheck` as well as vitest (vitest transpiles without type-checking).
- **Demo dispatch must precede the demo write-block/403 fallback** in `middleware.js`.
- **Full suite always**: `npx vitest run` — adding hooks/imports to shared components breaks unrelated render tests.
- **Pre-commit regenerates** API inventory, OpenAPI, livingcode artifacts and stages them — expect extra staged files on commits touching `app/api/`.
- **`.gitattributes` may show modified-but-unstaged** — checkout or commit it before push/rebase.
- **Doc counts are gated** by `node scripts/check-doc-counts.mjs --strict`. After adding routes/SDK methods/MCP tools, update every cited count (Task 12 has the file map) using the values the scripts report — never guess numbers.
- **ID convention:** `${prefix}_${crypto.randomUUID()}` inline (`wo_`, `wot_`, `wor_`).
- **Hashing:** use `digestJson` / `canonicalizeJson` from `app/lib/integrity/canonicalize.ts` (returns `'sha256:' + base64url`). Don't invent a new canonicalizer.

## Status model (single source of truth)

```
pending_approval ──approve──▶ queued ──claim──▶ claimed ──complete──▶ completed | failed
      │ deny                     │                  │ lease expiry──▶ timed_out
      └──▶ cancelled             └──▶ cancelled     └──▶ cancelled
blocked  (terminal at submit, guard said block)
```

Receipts exist for `completed`, `failed`, `timed_out` only. Legal transitions are enforced in the repository (`LEGAL_TRANSITIONS` map); everything else throws.

---

### Task 1: Schema + migration

**Files:**
- Modify: `schema/schema.js` (append after the `behaviorDismissals`/last table block)
- Create: `drizzle/00NN_work_orders.sql` (NN = next free number — check `ls drizzle/ | sort | tail -3` first; steps below say `0034`, substitute the real next number)

- [ ] **Step 1: Add tables to `schema/schema.js`** (match existing style; `timestamp(..., { withTimezone: true })` used by newer tables):

```js
// --- Work Orders (task-grade contracts + receipts ledger) ---

export const workOrderTypes = pgTable('work_order_types', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  type: text('type').notNull(),
  version: text('version').notNull().default('1.0'),
  displayName: text('display_name'),
  description: text('description'),
  inputSchema: jsonb('input_schema').notNull().default({}),
  outputSchema: jsonb('output_schema').notNull().default({}),
  defaultMaxCostUsd: numeric('default_max_cost_usd'),
  defaultTimeoutSeconds: integer('default_timeout_seconds').notNull().default(600),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueOrgType: uniqueIndex('work_order_types_org_type_unique').on(table.orgId, table.type),
}));

export const workOrders = pgTable('work_orders', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  type: text('type').notNull(),
  typeVersion: text('type_version').notNull().default('1.0'),
  input: jsonb('input').notNull().default({}),
  inputHash: text('input_hash'),
  maxCostUsd: numeric('max_cost_usd').notNull(),
  timeoutSeconds: integer('timeout_seconds').notNull().default(600),
  status: text('status').notNull().default('queued'),
  requestedBy: text('requested_by'),
  claimedBy: text('claimed_by'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  guardDecision: jsonb('guard_decision').default({}),
  approvalActionId: text('approval_action_id'),
  errorCode: text('error_code'),
  errorDetails: text('error_details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgStatusIdx: index('work_orders_org_status_idx').on(table.orgId, table.status),
  orgTypeIdx: index('work_orders_org_type_idx').on(table.orgId, table.type),
}));

export const workOrderReceipts = pgTable('work_order_receipts', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  workOrderId: text('work_order_id').notNull(),
  receipt: jsonb('receipt').notNull().default({}),
  receiptHash: text('receipt_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueWorkOrder: uniqueIndex('work_order_receipts_work_order_unique').on(table.workOrderId),
}));
```

(Budget is two columns, not a jsonb blob — cheaper to filter/compare. Deliberate small deviation from the spec's sketch.)

- [ ] **Step 2: Write `drizzle/0034_work_orders.sql`** (handwritten, idempotent like the existing files):

```sql
CREATE TABLE IF NOT EXISTS work_order_types (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  display_name TEXT,
  description TEXT,
  input_schema JSONB NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}',
  default_max_cost_usd NUMERIC,
  default_timeout_seconds INTEGER NOT NULL DEFAULT 600,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_order_types_org_type_unique ON work_order_types (org_id, type);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,
  type_version TEXT NOT NULL DEFAULT '1.0',
  input JSONB NOT NULL DEFAULT '{}',
  input_hash TEXT,
  max_cost_usd NUMERIC NOT NULL,
  timeout_seconds INTEGER NOT NULL DEFAULT 600,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_by TEXT,
  claimed_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  guard_decision JSONB DEFAULT '{}',
  approval_action_id TEXT,
  error_code TEXT,
  error_details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS work_orders_org_status_idx ON work_orders (org_id, status);
CREATE INDEX IF NOT EXISTS work_orders_org_type_idx ON work_orders (org_id, type);

CREATE TABLE IF NOT EXISTS work_order_receipts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  receipt JSONB NOT NULL DEFAULT '{}',
  receipt_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_order_receipts_work_order_unique ON work_order_receipts (work_order_id);
```

- [ ] **Step 3: Migrate + verify**

Run: `npm run db:migrate`
Expected: migration applies cleanly (idempotent re-run OK).

- [ ] **Step 4: Commit**

```bash
git add schema/schema.js drizzle/0034_work_orders.sql
git commit -m "feat(work-orders): schema + migration for types, orders, receipts"
```

---

### Task 2: JSON-Schema-subset validator

No ajv/zod in the repo (all validation is bespoke) — do NOT add a dependency. Implement a documented subset validator: `type` (object/array/string/number/integer/boolean), `required`, `properties`, `items`, `enum`, `minimum`/`maximum`, `minLength`/`maxLength`. Anything else in a schema is ignored (documented behavior).

**Files:**
- Create: `app/lib/work-orders/schema-validate.ts`
- Test: `__tests__/unit/work-orders-schema-validate.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { validateAgainstSchema, validateSchemaDefinition } from '@/lib/work-orders/schema-validate';

const SCHEMA = {
  type: 'object',
  required: ['topic'],
  properties: {
    topic: { type: 'string', minLength: 3 },
    depth: { type: 'string', enum: ['quick', 'standard', 'deep'] },
    max_sources: { type: 'integer', minimum: 1, maximum: 50 },
    constraints: { type: 'array', items: { type: 'string' } },
  },
};

describe('validateAgainstSchema', () => {
  it('passes a valid payload', () => {
    expect(validateAgainstSchema(SCHEMA, { topic: 'agent payments', depth: 'quick' })).toEqual([]);
  });
  it('reports missing required field with path', () => {
    const errors = validateAgainstSchema(SCHEMA, {});
    expect(errors).toEqual([{ field: 'topic', message: 'required field missing', code: 'required' }]);
  });
  it('reports type, enum, and bounds violations with field paths', () => {
    const errors = validateAgainstSchema(SCHEMA, { topic: 'ok', depth: 'wild', max_sources: 99, constraints: [7] });
    const fields = errors.map((e) => e.field);
    expect(fields).toContain('depth');
    expect(fields).toContain('max_sources');
    expect(fields).toContain('constraints[0]');
  });
  it('reports minLength', () => {
    expect(validateAgainstSchema(SCHEMA, { topic: 'ab' })[0]!.code).toBe('min_length');
  });
});

describe('validateSchemaDefinition', () => {
  it('accepts an object schema', () => {
    expect(validateSchemaDefinition(SCHEMA)).toEqual([]);
  });
  it('rejects non-object roots and unknown types', () => {
    expect(validateSchemaDefinition({ type: 'string' }).length).toBeGreaterThan(0);
    expect(validateSchemaDefinition({ type: 'object', properties: { a: { type: 'wat' } } }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/unit/work-orders-schema-validate.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `app/lib/work-orders/schema-validate.ts`**

```typescript
// Minimal JSON-Schema-subset validator for work order contracts.
// Supported keywords: type, required, properties, items, enum, minimum,
// maximum, minLength, maxLength. Unknown keywords are ignored by design.

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

type Schema = Record<string, unknown>;

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(expected: string, value: unknown): boolean {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

export function validateAgainstSchema(schema: Schema, value: unknown, path = ''): ValidationError[] {
  const errors: ValidationError[] = [];
  const at = (suffix: string) => (path ? `${path}${suffix.startsWith('[') ? '' : '.'}${suffix}` : suffix);

  const expected = typeof schema.type === 'string' ? schema.type : null;
  if (expected && !typeMatches(expected, value)) {
    errors.push({ field: path || '(root)', message: `expected ${expected}, got ${typeOf(value)}`, code: 'type' });
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((v) => v === value)) {
    errors.push({ field: path || '(root)', message: `must be one of: ${schema.enum.join(', ')}`, code: 'enum' });
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ field: path || '(root)', message: `must be at least ${schema.minLength} characters`, code: 'min_length' });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({ field: path || '(root)', message: `must be at most ${schema.maxLength} characters`, code: 'max_length' });
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ field: path || '(root)', message: `must be >= ${schema.minimum}`, code: 'minimum' });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ field: path || '(root)', message: `must be <= ${schema.maximum}`, code: 'maximum' });
    }
  }

  if (expected === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === 'string' && !(key in obj)) {
        errors.push({ field: at(key), message: 'required field missing', code: 'required' });
      }
    }
    const props = (schema.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, Schema>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in obj && propSchema && typeof propSchema === 'object') {
        errors.push(...validateAgainstSchema(propSchema, obj[key], at(key)));
      }
    }
  }

  if (expected === 'array' && Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, i) => {
      errors.push(...validateAgainstSchema(schema.items as Schema, item, `${path}[${i}]`));
    });
  }

  return errors;
}

export function validateSchemaDefinition(schema: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [{ field: '(root)', message: 'schema must be an object', code: 'schema_invalid' }];
  }
  const root = schema as Schema;
  if (root.type !== 'object') {
    errors.push({ field: 'type', message: "root schema type must be 'object'", code: 'schema_root_type' });
  }
  const walk = (node: Schema, path: string) => {
    if (typeof node.type === 'string' && !TYPES.has(node.type)) {
      errors.push({ field: path || 'type', message: `unsupported type '${node.type}'`, code: 'schema_unknown_type' });
    }
    const props = (node.properties && typeof node.properties === 'object' ? node.properties : {}) as Record<string, Schema>;
    for (const [key, child] of Object.entries(props)) {
      if (child && typeof child === 'object') walk(child, path ? `${path}.${key}` : key);
    }
    if (node.items && typeof node.items === 'object') walk(node.items as Schema, `${path}[]`);
  };
  walk(root, '');
  return errors;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run __tests__/unit/work-orders-schema-validate.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/work-orders/schema-validate.ts __tests__/unit/work-orders-schema-validate.test.ts
git commit -m "feat(work-orders): JSON-Schema-subset contract validator"
```

---

### Task 3: Receipt builder (canonical + self-verifying)

**Files:**
- Create: `app/lib/work-orders/receipt.ts`
- Test: `__tests__/unit/work-orders-receipt.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { buildReceiptBody, computeReceiptHash, verifyReceiptHash } from '@/lib/work-orders/receipt';

const ORDER = {
  id: 'wo_1', org_id: 'org_1', type: 'research_brief', type_version: '1.0',
  input_hash: 'sha256:abc', max_cost_usd: '0.25', timeout_seconds: 600,
  status: 'completed', requested_by: 'caller-1', claimed_by: 'worker-1',
  created_at: '2026-06-11T00:00:00.000Z', claimed_at: '2026-06-11T00:00:05.000Z',
  completed_at: '2026-06-11T00:01:00.000Z',
};

describe('work order receipts', () => {
  it('builds a canonical body with cost, lifecycle, governance and over_budget flag', () => {
    const body = buildReceiptBody({
      order: ORDER,
      cost: { input_tokens: 100, output_tokens: 200, total_usd: 0.31 },
      outputHash: 'sha256:out',
      governance: { mode: 'governed', guard_decision_id: 'act_gd_x', audit_record_id: 'act_y' },
    });
    expect(body.work_order_id).toBe('wo_1');
    expect(body.over_budget).toBe(true); // 0.31 > 0.25
    expect(body.lifecycle.created_at).toBe(ORDER.created_at);
    expect(body.governance.audit_record_id).toBe('act_y');
  });

  it('hash round-trips and detects tamper', () => {
    const body = buildReceiptBody({ order: ORDER, cost: { total_usd: 0.1 }, outputHash: 'sha256:o', governance: { mode: 'governed' } });
    const hash = computeReceiptHash(body);
    expect(verifyReceiptHash(body, hash)).toBe(true);
    expect(verifyReceiptHash({ ...body, cost: { ...body.cost, total_usd: 9.99 } }, hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run __tests__/unit/work-orders-receipt.test.ts`

- [ ] **Step 3: Implement `app/lib/work-orders/receipt.ts`**

```typescript
import { digestJson } from '../integrity/canonicalize';

interface OrderLike {
  id: string; org_id: string; type: string; type_version: string;
  input_hash?: string | null; max_cost_usd: string | number; timeout_seconds: number;
  status: string; requested_by?: string | null; claimed_by?: string | null;
  created_at?: string | null; claimed_at?: string | null; completed_at?: string | null;
  error_code?: string | null; error_details?: string | null;
}

export interface ReceiptCost {
  input_tokens?: number;
  output_tokens?: number;
  total_usd?: number;
}

export interface ReceiptGovernance {
  mode: 'governed';
  guard_decision_id?: string | null;
  audit_record_id?: string | null;
  matched_policies?: string[];
}

export function buildReceiptBody(args: {
  order: OrderLike;
  cost?: ReceiptCost | null;
  outputHash?: string | null;
  governance: ReceiptGovernance;
}) {
  const { order, cost, outputHash, governance } = args;
  const ceiling = Number(order.max_cost_usd); // numeric arrives as a string from Neon
  const totalUsd = Number(cost?.total_usd ?? 0);
  return {
    receipt_version: '1.0',
    work_order_id: order.id,
    type: order.type,
    type_version: order.type_version,
    status: order.status,
    input_hash: order.input_hash || null,
    output_hash: outputHash || null,
    budget: { max_cost_usd: ceiling, timeout_seconds: order.timeout_seconds },
    cost: {
      input_tokens: cost?.input_tokens ?? null,
      output_tokens: cost?.output_tokens ?? null,
      total_usd: Number.isFinite(totalUsd) ? totalUsd : null,
    },
    over_budget: Number.isFinite(ceiling) && Number.isFinite(totalUsd) && totalUsd > ceiling,
    worker: order.claimed_by || null,
    requested_by: order.requested_by || null,
    lifecycle: {
      created_at: order.created_at || null,
      claimed_at: order.claimed_at || null,
      completed_at: order.completed_at || null,
    },
    error: order.error_code ? { code: order.error_code, details: order.error_details || null } : null,
    governance,
  };
}

export type ReceiptBody = ReturnType<typeof buildReceiptBody>;

// SHA-256 over the canonical JSON of the body (the hash itself is stored
// alongside, never inside, the body — recomputable by anyone).
export function computeReceiptHash(body: ReceiptBody): string {
  return digestJson(body);
}

export function verifyReceiptHash(body: ReceiptBody, hash: string): boolean {
  return computeReceiptHash(body) === hash;
}
```

- [ ] **Step 4: Run → PASS.** Then commit:

```bash
git add app/lib/work-orders/receipt.ts __tests__/unit/work-orders-receipt.test.ts
git commit -m "feat(work-orders): canonical self-verifying receipt builder"
```

---

### Task 4: Work orders repository

**Files:**
- Create: `app/lib/repositories/work-orders.repository.ts`
- Test: `__tests__/unit/work-orders.repository.test.ts`

The repository owns ALL SQL (route-sql gate). Lifecycle legality lives here. Model the file on `app/lib/repositories/artifacts.repository.ts`.

- [ ] **Step 1: Failing tests** (makeSqlMock pattern from `__tests__/unit/posture.repository.test.ts` — queue of responses, `.calls` captures interpolated values):

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  assertTransition, createWorkOrder, claimNextWorkOrder, sweepExpiredLeases,
  LEGAL_TRANSITIONS,
} from '@/lib/repositories/work-orders.repository';

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

function makeSqlMock(responses: Record<string, unknown>[][]) {
  const queue = [...responses];
  const calls: { strings: TemplateStringsArray; values: unknown[] }[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings, values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as SqlTag & { calls: typeof calls };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

describe('lifecycle legality', () => {
  it('allows documented transitions and rejects everything else', () => {
    expect(() => assertTransition('queued', 'claimed')).not.toThrow();
    expect(() => assertTransition('pending_approval', 'queued')).not.toThrow();
    expect(() => assertTransition('claimed', 'completed')).not.toThrow();
    expect(() => assertTransition('completed', 'queued')).toThrow();
    expect(() => assertTransition('queued', 'completed')).toThrow(); // no skipping claim
    expect(() => assertTransition('blocked', 'queued')).toThrow();
  });
  it('terminal states have no outgoing transitions', () => {
    for (const terminal of ['completed', 'failed', 'timed_out', 'cancelled', 'blocked']) {
      expect(LEGAL_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe('createWorkOrder', () => {
  it('inserts with wo_ id, org scoping, and input hash', async () => {
    const sql = makeSqlMock([[{ id: 'wo_x', status: 'queued' }]]);
    const row = await createWorkOrder(sql, 'org_1', {
      type: 'research_brief', typeVersion: '1.0', input: { topic: 'x' },
      inputHash: 'sha256:i', maxCostUsd: 0.25, timeoutSeconds: 600,
      status: 'queued', requestedBy: 'caller', guardDecision: { decision: 'allow' },
    });
    expect(row!.id).toBe('wo_x');
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    expect(mock.calls[0]!.values).toContain('org_1');
    expect(mock.calls[0]!.values.some((v) => typeof v === 'string' && (v as string).startsWith('wo_'))).toBe(true);
  });
});

describe('claimNextWorkOrder', () => {
  it('passes org, agent and types into the atomic claim query', async () => {
    const sql = makeSqlMock([[]]);
    await claimNextWorkOrder(sql, 'org_1', 'worker-1', ['research_brief']);
    const mock = sql as unknown as { calls: { values: unknown[] }[] };
    expect(mock.calls[0]!.values).toContain('org_1');
    expect(mock.calls[0]!.values).toContain('worker-1');
  });
});

describe('sweepExpiredLeases', () => {
  it('returns swept rows so callers can build timed_out receipts', async () => {
    const sql = makeSqlMock([[{ id: 'wo_expired', status: 'timed_out' }]]);
    const swept = await sweepExpiredLeases(sql, 'org_1');
    expect(swept).toHaveLength(1);
    expect(swept[0]!.id).toBe('wo_expired');
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run __tests__/unit/work-orders.repository.test.ts`

- [ ] **Step 3: Implement `app/lib/repositories/work-orders.repository.ts`**

```typescript
// Work Orders repository — ALL work-order SQL lives here (route-sql gate).
import crypto from 'node:crypto';

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;
type Row = Record<string, unknown>;

export const WORK_ORDER_STATUSES = [
  'pending_approval', 'queued', 'claimed', 'completed', 'failed', 'timed_out', 'cancelled', 'blocked',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const LEGAL_TRANSITIONS: Record<string, string[]> = {
  pending_approval: ['queued', 'cancelled'],
  queued: ['claimed', 'cancelled'],
  claimed: ['completed', 'failed', 'timed_out', 'cancelled'],
  completed: [], failed: [], timed_out: [], cancelled: [], blocked: [],
};

export function assertTransition(from: string, to: string): void {
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`illegal work order transition: ${from} -> ${to}`);
  }
}

// ---------- work order types (contract registry) ----------

export interface WorkOrderTypeInput {
  type: string;
  version?: string;
  displayName?: string | null;
  description?: string | null;
  inputSchema: unknown;
  outputSchema: unknown;
  defaultMaxCostUsd?: number | null;
  defaultTimeoutSeconds?: number | null;
}

export async function createWorkOrderType(sql: SqlTag, orgId: string, data: WorkOrderTypeInput): Promise<Row | null> {
  const id = `wot_${crypto.randomUUID()}`;
  const rows = await sql`
    INSERT INTO work_order_types (
      id, org_id, type, version, display_name, description,
      input_schema, output_schema, default_max_cost_usd, default_timeout_seconds, status
    ) VALUES (
      ${id}, ${orgId}, ${data.type}, ${data.version || '1.0'},
      ${data.displayName ?? null}, ${data.description ?? null},
      ${JSON.stringify(data.inputSchema)}::jsonb, ${JSON.stringify(data.outputSchema)}::jsonb,
      ${data.defaultMaxCostUsd ?? null}, ${data.defaultTimeoutSeconds ?? 600}, 'active'
    )
    ON CONFLICT (org_id, type) DO NOTHING
    RETURNING *`;
  return rows[0] ?? null;
}

export async function listWorkOrderTypes(sql: SqlTag, orgId: string, includeDisabled = false): Promise<Row[]> {
  if (includeDisabled) {
    return sql`SELECT * FROM work_order_types WHERE org_id = ${orgId} ORDER BY type ASC`;
  }
  return sql`SELECT * FROM work_order_types WHERE org_id = ${orgId} AND status = 'active' ORDER BY type ASC`;
}

export async function getWorkOrderType(sql: SqlTag, orgId: string, type: string): Promise<Row | null> {
  const rows = await sql`SELECT * FROM work_order_types WHERE org_id = ${orgId} AND type = ${type} LIMIT 1`;
  return rows[0] ?? null;
}

export async function updateWorkOrderType(
  sql: SqlTag, orgId: string, type: string,
  patch: Partial<WorkOrderTypeInput> & { version: string },
): Promise<Row | null> {
  const existing = await getWorkOrderType(sql, orgId, type);
  if (!existing) return null;
  const rows = await sql`
    UPDATE work_order_types SET
      version = ${patch.version},
      display_name = ${patch.displayName ?? (existing.display_name as string | null)},
      description = ${patch.description ?? (existing.description as string | null)},
      input_schema = ${JSON.stringify(patch.inputSchema ?? existing.input_schema)}::jsonb,
      output_schema = ${JSON.stringify(patch.outputSchema ?? existing.output_schema)}::jsonb,
      default_max_cost_usd = ${patch.defaultMaxCostUsd ?? (existing.default_max_cost_usd as string | null)},
      default_timeout_seconds = ${patch.defaultTimeoutSeconds ?? (existing.default_timeout_seconds as number)},
      updated_at = NOW()
    WHERE org_id = ${orgId} AND type = ${type}
    RETURNING *`;
  return rows[0] ?? null;
}

export async function disableWorkOrderType(sql: SqlTag, orgId: string, type: string): Promise<Row | null> {
  const rows = await sql`
    UPDATE work_order_types SET status = 'disabled', updated_at = NOW()
    WHERE org_id = ${orgId} AND type = ${type}
    RETURNING *`;
  return rows[0] ?? null;
}

// Lazily seed the example contract so a fresh org always has one working type.
export const RESEARCH_BRIEF_SEED: WorkOrderTypeInput = {
  type: 'research_brief',
  version: '1.0',
  displayName: 'Research Brief',
  description: 'Structured research synthesis: topic in, sourced findings out. Seeded example contract.',
  inputSchema: {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: { type: 'string', minLength: 3, maxLength: 500 },
      scope: { type: 'string', maxLength: 2000 },
      depth: { type: 'string', enum: ['quick', 'standard', 'deep'] },
      constraints: { type: 'array', items: { type: 'string' } },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['title', 'summary', 'findings'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      findings: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      limitations: { type: 'array', items: { type: 'string' } },
    },
  },
  defaultMaxCostUsd: 0.5,
  defaultTimeoutSeconds: 600,
};

export async function ensureSeedTypes(sql: SqlTag, orgId: string): Promise<void> {
  await createWorkOrderType(sql, orgId, RESEARCH_BRIEF_SEED); // ON CONFLICT DO NOTHING
}

// ---------- work orders ----------

export interface CreateWorkOrderInput {
  type: string;
  typeVersion: string;
  input: unknown;
  inputHash: string;
  maxCostUsd: number;
  timeoutSeconds: number;
  status: WorkOrderStatus; // queued | pending_approval | blocked at creation
  requestedBy?: string | null;
  guardDecision?: unknown;
  approvalActionId?: string | null;
  errorCode?: string | null;
}

export async function createWorkOrder(sql: SqlTag, orgId: string, data: CreateWorkOrderInput): Promise<Row | null> {
  const id = `wo_${crypto.randomUUID()}`;
  const rows = await sql`
    INSERT INTO work_orders (
      id, org_id, type, type_version, input, input_hash, max_cost_usd,
      timeout_seconds, status, requested_by, guard_decision, approval_action_id, error_code
    ) VALUES (
      ${id}, ${orgId}, ${data.type}, ${data.typeVersion},
      ${JSON.stringify(data.input)}::jsonb, ${data.inputHash}, ${data.maxCostUsd},
      ${data.timeoutSeconds}, ${data.status}, ${data.requestedBy ?? null},
      ${JSON.stringify(data.guardDecision ?? {})}::jsonb, ${data.approvalActionId ?? null},
      ${data.errorCode ?? null}
    )
    RETURNING *`;
  return rows[0] ?? null;
}

export interface WorkOrderFilters {
  status?: string;
  type?: string;
  agent?: string;
  limit?: number | string;
  offset?: number | string;
}

export async function listWorkOrders(sql: SqlTag, orgId: string, filters: WorkOrderFilters = {}): Promise<{ work_orders: Row[]; total: number }> {
  const limit = Math.min(parseInt(String(filters.limit ?? 50), 10) || 50, 200);
  const offset = parseInt(String(filters.offset ?? 0), 10) || 0;
  const status = filters.status ?? null;
  const type = filters.type ?? null;
  const agent = filters.agent ?? null;
  const rows = await sql`
    SELECT * FROM work_orders
    WHERE org_id = ${orgId}
      AND (${status}::text IS NULL OR status = ${status})
      AND (${type}::text IS NULL OR type = ${type})
      AND (${agent}::text IS NULL OR claimed_by = ${agent} OR requested_by = ${agent})
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const countRows = await sql`
    SELECT COUNT(*)::int AS total FROM work_orders
    WHERE org_id = ${orgId}
      AND (${status}::text IS NULL OR status = ${status})
      AND (${type}::text IS NULL OR type = ${type})
      AND (${agent}::text IS NULL OR claimed_by = ${agent} OR requested_by = ${agent})`;
  return { work_orders: rows, total: (countRows[0]?.total as number) ?? 0 };
}

export async function getWorkOrder(sql: SqlTag, orgId: string, id: string): Promise<Row | null> {
  const rows = await sql`SELECT * FROM work_orders WHERE org_id = ${orgId} AND id = ${id} LIMIT 1`;
  return rows[0] ?? null;
}

// Atomic claim: oldest queued order of a matching type. SKIP LOCKED prevents
// double-claims under concurrent workers; single statement works on Neon HTTP.
export async function claimNextWorkOrder(sql: SqlTag, orgId: string, agentId: string, types: string[] | null): Promise<Row | null> {
  const typeFilter = types && types.length ? types : null;
  const rows = await sql`
    UPDATE work_orders SET
      status = 'claimed', claimed_by = ${agentId}, claimed_at = NOW(),
      lease_expires_at = NOW() + make_interval(secs => timeout_seconds), updated_at = NOW()
    WHERE id = (
      SELECT id FROM work_orders
      WHERE org_id = ${orgId} AND status = 'queued'
        AND (${typeFilter}::text[] IS NULL OR type = ANY(${typeFilter}))
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) AND org_id = ${orgId}
    RETURNING *`;
  return rows[0] ?? null;
}

export async function transitionWorkOrder(
  sql: SqlTag, orgId: string, id: string, to: WorkOrderStatus,
  patch: { errorCode?: string | null; errorDetails?: string | null } = {},
): Promise<Row | null> {
  const current = await getWorkOrder(sql, orgId, id);
  if (!current) return null;
  assertTransition(String(current.status), to);
  const terminal = LEGAL_TRANSITIONS[to]?.length === 0;
  const rows = await sql`
    UPDATE work_orders SET
      status = ${to},
      error_code = ${patch.errorCode ?? (current.error_code as string | null)},
      error_details = ${patch.errorDetails ?? (current.error_details as string | null)},
      completed_at = ${terminal ? new Date().toISOString() : (current.completed_at as string | null)},
      updated_at = NOW()
    WHERE org_id = ${orgId} AND id = ${id}
    RETURNING *`;
  return rows[0] ?? null;
}

// Lazy sweep (no cron): expired claimed leases -> timed_out. Returns swept rows
// so the caller builds their timed_out receipts.
export async function sweepExpiredLeases(sql: SqlTag, orgId: string): Promise<Row[]> {
  return sql`
    UPDATE work_orders SET
      status = 'timed_out', error_code = 'timed_out',
      error_details = 'lease expired before completion',
      completed_at = NOW(), updated_at = NOW()
    WHERE org_id = ${orgId} AND status = 'claimed' AND lease_expires_at < NOW()
    RETURNING *`;
}

// Lazy approval release: pending_approval orders whose linked approval action
// was decided in Mission Control. running -> queued (approved); failed -> cancelled (denied).
export async function sweepApprovalReleases(sql: SqlTag, orgId: string): Promise<Row[]> {
  const released = await sql`
    UPDATE work_orders wo SET status = 'queued', updated_at = NOW()
    FROM action_records ar
    WHERE wo.org_id = ${orgId} AND wo.status = 'pending_approval'
      AND ar.org_id = ${orgId} AND ar.action_id = wo.approval_action_id
      AND ar.status = 'running'
    RETURNING wo.*`;
  const denied = await sql`
    UPDATE work_orders wo SET status = 'cancelled', error_code = 'approval_denied', updated_at = NOW()
    FROM action_records ar
    WHERE wo.org_id = ${orgId} AND wo.status = 'pending_approval'
      AND ar.org_id = ${orgId} AND ar.action_id = wo.approval_action_id
      AND ar.status = 'failed'
    RETURNING wo.*`;
  return [...released, ...denied];
}

// ---------- receipts ----------

export async function createWorkOrderReceipt(
  sql: SqlTag, orgId: string, workOrderId: string, receipt: unknown, receiptHash: string,
): Promise<Row | null> {
  const id = `wor_${crypto.randomUUID()}`;
  const rows = await sql`
    INSERT INTO work_order_receipts (id, org_id, work_order_id, receipt, receipt_hash)
    VALUES (${id}, ${orgId}, ${workOrderId}, ${JSON.stringify(receipt)}::jsonb, ${receiptHash})
    ON CONFLICT (work_order_id) DO NOTHING
    RETURNING *`;
  return rows[0] ?? null;
}

export async function getWorkOrderReceipt(sql: SqlTag, orgId: string, workOrderId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT * FROM work_order_receipts WHERE org_id = ${orgId} AND work_order_id = ${workOrderId} LIMIT 1`;
  return rows[0] ?? null;
}
```

NOTE for the implementer: `sweepApprovalReleases` joins `action_records` on its `action_id` column (the `act_*` public id). Verify the column name with `grep -n "action_id" schema/schema.js | head` — if the public id column differs, adjust the join. The conditional-NULL filter pattern (`(${x}::text IS NULL OR col = ${x})`) keeps the query a single statement for the sql-mock test conventions (one main query; no dynamic fragment consumption).

- [ ] **Step 4: Run → PASS.** `npx vitest run __tests__/unit/work-orders.repository.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/lib/repositories/work-orders.repository.ts __tests__/unit/work-orders.repository.test.ts
git commit -m "feat(work-orders): repository with lifecycle legality, atomic claim, lazy sweeps"
```

---

### Task 5: API routes (7 files)

**Files:**
- Create: `app/api/work-orders/route.ts` (GET list, POST submit)
- Create: `app/api/work-orders/claim/route.ts` (POST)
- Create: `app/api/work-orders/[workOrderId]/route.ts` (GET, DELETE)
- Create: `app/api/work-orders/[workOrderId]/complete/route.ts` (POST)
- Create: `app/api/work-orders/[workOrderId]/artifacts/route.ts` (GET)
- Create: `app/api/work-orders/types/route.ts` (GET, POST)
- Create: `app/api/work-orders/types/[type]/route.ts` (GET, PUT, DELETE)
- Test: `__tests__/unit/work-orders.route.test.ts`

Every file starts with `export const dynamic = 'force-dynamic';` and uses `getSql` / `getOrgId` / `apiErrorResponse` exactly like `app/api/artifacts/route.ts`. Import depths: `route.ts` under `work-orders/` → `../../lib/...`; one level deeper → `../../../lib/...`; two deeper → `../../../../lib/...`.

- [ ] **Step 1: Failing route tests** (vi.hoisted mock pattern from `__tests__/unit/policy-summary.route.test.ts`; mock the repository module + `evaluateGuard` + `createActionRecord`, not raw sql):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSql: vi.fn(() => vi.fn()),
  getOrgId: vi.fn(() => 'org_1'),
  evaluateGuard: vi.fn(),
  createActionRecord: vi.fn(async () => ({ action_id: 'act_approval' })),
  repo: {
    ensureSeedTypes: vi.fn(async () => {}),
    getWorkOrderType: vi.fn(),
    createWorkOrder: vi.fn(),
    listWorkOrders: vi.fn(async () => ({ work_orders: [], total: 0 })),
    getWorkOrder: vi.fn(),
    getWorkOrderReceipt: vi.fn(async () => null),
    claimNextWorkOrder: vi.fn(async () => null),
    transitionWorkOrder: vi.fn(),
    sweepExpiredLeases: vi.fn(async () => []),
    sweepApprovalReleases: vi.fn(async () => []),
    createWorkOrderReceipt: vi.fn(async () => ({ id: 'wor_1' })),
  },
}));

vi.mock('@/lib/db', () => ({ getSql: mocks.getSql }));
vi.mock('@/lib/org', () => ({ getOrgId: mocks.getOrgId }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mocks.evaluateGuard }));
vi.mock('@/lib/repositories/actions.repository', () => ({ createActionRecord: mocks.createActionRecord }));
vi.mock('@/lib/repositories/work-orders.repository', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, ...mocks.repo }; // keep assertTransition/RESEARCH_BRIEF_SEED real
});

import { GET as listGET, POST as submitPOST } from '@/api/work-orders/route';
import { POST as completePOST } from '@/api/work-orders/[workOrderId]/complete/route';

const TYPE_ROW = {
  type: 'research_brief', version: '1.0', status: 'active',
  input_schema: { type: 'object', required: ['topic'], properties: { topic: { type: 'string', minLength: 3 } } },
  output_schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
  default_max_cost_usd: '0.5', default_timeout_seconds: 600,
};

function req(url: string, init?: RequestInit) {
  return new Request(url, { headers: { 'content-type': 'application/json' }, ...init });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrgId.mockReturnValue('org_1');
  mocks.repo.getWorkOrderType.mockResolvedValue(TYPE_ROW);
  mocks.evaluateGuard.mockResolvedValue({
    decision: 'allow', decision_id: 'act_gd_1', matched_policies: [], risk_score: 10, reason: null,
  });
  mocks.repo.createWorkOrder.mockImplementation(async (_sql: unknown, _org: string, data: { status: string }) => ({
    id: 'wo_new', status: data.status,
  }));
});

describe('POST /api/work-orders', () => {
  it('rejects invalid input with structured per-field 400', async () => {
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'ab' } }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_failed');
    expect(body.details[0].field).toBe('topic');
  });

  it('rejects missing/invalid budget with 422', async () => {
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST',
      body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' }, budget: { max_cost_usd: 0 } }),
    }));
    expect(res.status).toBe(422);
  });

  it('queues on allow and returns 201 with guard info', async () => {
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' } }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.guard.decision).toBe('allow');
  });

  it('persists a blocked order on guard block', async () => {
    mocks.evaluateGuard.mockResolvedValue({ decision: 'block', decision_id: 'act_gd_2', matched_policies: ['p1'], risk_score: 90, reason: 'nope' });
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' } }),
    }));
    const body = await res.json();
    expect(body.status).toBe('blocked');
    expect(mocks.repo.createWorkOrder.mock.calls[0]![2].status).toBe('blocked');
  });

  it('parks pending_approval and creates the approval action record', async () => {
    mocks.evaluateGuard.mockResolvedValue({ decision: 'require_approval', decision_id: 'act_gd_3', matched_policies: ['p2'], risk_score: 70, reason: 'high cost' });
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' } }),
    }));
    const body = await res.json();
    expect(body.status).toBe('pending_approval');
    expect(mocks.createActionRecord).toHaveBeenCalled();
  });
});

describe('GET /api/work-orders', () => {
  it('sweeps lazily then lists', async () => {
    const res = await listGET(req('http://x/api/work-orders?status=queued'));
    expect(res.status).toBe(200);
    expect(mocks.repo.sweepExpiredLeases).toHaveBeenCalled();
    expect(mocks.repo.sweepApprovalReleases).toHaveBeenCalled();
  });
});

describe('POST /api/work-orders/:id/complete', () => {
  const CLAIMED = {
    id: 'wo_1', org_id: 'org_1', type: 'research_brief', type_version: '1.0', status: 'claimed',
    claimed_by: 'worker-1', max_cost_usd: '0.5', timeout_seconds: 600, input_hash: 'sha256:i',
    created_at: '2026-06-11T00:00:00Z', claimed_at: '2026-06-11T00:00:05Z',
  };

  it('rejects non-claim-holder with 403', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'intruder', output: { title: 't' } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('rejects output-contract violations with 422 and leaves the order claimed', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'worker-1', output: { nope: true } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('output_contract_violation');
    expect(mocks.repo.transitionWorkOrder).not.toHaveBeenCalled();
  });

  it('builds receipt + audit record on valid completion', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    mocks.repo.transitionWorkOrder.mockResolvedValue({ ...CLAIMED, status: 'completed', completed_at: '2026-06-11T00:01:00Z' });
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'worker-1', output: { title: 'T' }, cost: { total_usd: 0.12 } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.receipt_hash).toBeTruthy();
    expect(mocks.createActionRecord).toHaveBeenCalled();
    expect(mocks.repo.createWorkOrderReceipt).toHaveBeenCalled();
  });
});
```

(Adjust the `@/api/...` import alias to whatever existing route tests use — check `grep -rn "from '@/api" __tests__/unit | head` or use relative imports like the existing route tests do. Match the repo's exact convention.)

- [ ] **Step 2: Run → FAIL** (routes don't exist).

- [ ] **Step 3: Implement `app/api/work-orders/route.ts`**

```typescript
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { evaluateGuard } from '../../lib/guard';
import { digestJson } from '../../lib/integrity/canonicalize';
import { validateAgainstSchema } from '../../lib/work-orders/schema-validate';
import { buildReceiptBody, computeReceiptHash } from '../../lib/work-orders/receipt';
import { createActionRecord } from '../../lib/repositories/actions.repository';
import {
  ensureSeedTypes, getWorkOrderType, createWorkOrder, listWorkOrders,
  sweepExpiredLeases, sweepApprovalReleases, createWorkOrderReceipt,
} from '../../lib/repositories/work-orders.repository';

// Shared lazy sweep: expire leases (building their timed_out receipts) and
// release approved/denied pending_approval orders. Called from list/get/claim.
export async function runWorkOrderSweeps(sql: ReturnType<typeof getSql>, orgId: string) {
  const swept = await sweepExpiredLeases(sql, orgId);
  for (const order of swept) {
    const body = buildReceiptBody({
      order: order as never,
      cost: null,
      outputHash: null,
      governance: {
        mode: 'governed',
        guard_decision_id: ((order.guard_decision as Record<string, unknown> | null)?.decision_id as string) ?? null,
        audit_record_id: null,
      },
    });
    await createWorkOrderReceipt(sql, orgId, String(order.id), body, computeReceiptHash(body));
  }
  await sweepApprovalReleases(sql, orgId);
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    await runWorkOrderSweeps(sql, orgId);
    const { searchParams } = new URL(request.url);
    const result = await listWorkOrders(sql, orgId, {
      status: searchParams.get('status') || undefined,
      type: searchParams.get('type') || undefined,
      agent: searchParams.get('agent') || undefined,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_LIST');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const type = typeof body.type === 'string' ? body.type : '';
    if (!type) {
      return NextResponse.json(
        { error: 'validation_failed', details: [{ field: 'type', message: 'required field missing', code: 'required' }] },
        { status: 400 },
      );
    }

    await ensureSeedTypes(sql, orgId);
    const typeRow = await getWorkOrderType(sql, orgId, type);
    if (!typeRow || typeRow.status !== 'active') {
      return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type', type }, { status: 404 });
    }

    const input = body.input && typeof body.input === 'object' ? body.input : {};
    const inputErrors = validateAgainstSchema(typeRow.input_schema as Record<string, unknown>, input);
    if (inputErrors.length) {
      return NextResponse.json({ error: 'validation_failed', details: inputErrors }, { status: 400 });
    }

    const budget = (body.budget && typeof body.budget === 'object' ? body.budget : {}) as Record<string, unknown>;
    const maxCostUsd = Number(budget.max_cost_usd ?? typeRow.default_max_cost_usd);
    const timeoutSeconds = parseInt(String(budget.timeout_seconds ?? typeRow.default_timeout_seconds), 10);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      return NextResponse.json({ error: 'budget_invalid', code: 'budget_invalid', message: 'budget.max_cost_usd must be a positive number (or the type must define a default)' }, { status: 422 });
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      return NextResponse.json({ error: 'budget_invalid', code: 'timeout_invalid', message: 'budget.timeout_seconds must be a positive integer' }, { status: 422 });
    }

    const requestedBy = typeof body.requested_by === 'string' ? body.requested_by
      : typeof body.agent_id === 'string' ? body.agent_id : null;
    const inputHash = digestJson(input);
    const declaredGoal = `Work order ${type}: ${JSON.stringify(input).slice(0, 200)}`;

    const guard = await evaluateGuard(orgId, {
      action_type: 'work_order.submit',
      agent_id: requestedBy,
      declared_goal: declaredGoal,
      cost_estimate: maxCostUsd,
      reversible: true,
      systems_touched: ['work_orders'],
    }, sql);

    const guardDecision = {
      decision: guard.decision,
      decision_id: guard.decision_id,
      risk_score: guard.risk_score,
      matched_policies: guard.matched_policies,
      reason: guard.reason,
    };

    let status: 'queued' | 'pending_approval' | 'blocked' = 'queued';
    let approvalActionId: string | null = null;
    let errorCode: string | null = null;

    if (guard.decision === 'block') {
      status = 'blocked';
      errorCode = 'blocked_by_policy';
    } else if (guard.decision === 'require_approval') {
      status = 'pending_approval';
      approvalActionId = `act_${crypto.randomUUID()}`;
      await createActionRecord(sql, {
        orgId,
        action_id: approvalActionId,
        data: {
          agent_id: requestedBy,
          action_type: 'work_order.submit',
          declared_goal: declaredGoal,
          input_summary: `work order ${type} awaiting approval (max $${maxCostUsd})`,
          risk_score: guard.risk_score,
          reversible: true,
          systems_touched: ['work_orders'],
        },
        actionStatus: 'pending_approval',
        costEstimate: maxCostUsd,
        signature: null,
        verified: null,
        timestamp_start: new Date().toISOString(),
        riskScore: guard.risk_score,
      });
    }

    const order = await createWorkOrder(sql, orgId, {
      type,
      typeVersion: String(typeRow.version),
      input,
      inputHash,
      maxCostUsd,
      timeoutSeconds,
      status,
      requestedBy,
      guardDecision,
      approvalActionId,
      errorCode,
    });

    return NextResponse.json(
      { work_order_id: order?.id, status, guard: guardDecision },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_SUBMIT');
  }
}
```

Add `import crypto from 'node:crypto';` at the top with the other imports.

- [ ] **Step 4: Implement `app/api/work-orders/claim/route.ts`**

```typescript
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { claimNextWorkOrder } from '../../../lib/repositories/work-orders.repository';
import { runWorkOrderSweeps } from '../route';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
    if (!agentId) {
      return NextResponse.json({ error: 'validation_failed', details: [{ field: 'agent_id', message: 'required field missing', code: 'required' }] }, { status: 400 });
    }
    const types = Array.isArray(body.types) ? body.types.filter((t): t is string => typeof t === 'string') : null;
    await runWorkOrderSweeps(sql, orgId);
    const order = await claimNextWorkOrder(sql, orgId, agentId, types);
    return NextResponse.json({ work_order: order }); // null when nothing queued
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_CLAIM');
  }
}
```

(If exporting `runWorkOrderSweeps` from a route file trips Next's route-export validation during `next build` — Next 16 only allows HTTP verbs + config exports from route files — move `runWorkOrderSweeps` into `app/lib/work-orders/sweeps.ts` and import it in both routes. Check the build; the lib placement is the safe default, prefer it.)

- [ ] **Step 5: Implement `app/api/work-orders/[workOrderId]/route.ts`**

```typescript
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { runWorkOrderSweeps } from '../../../lib/work-orders/sweeps';
import {
  getWorkOrder, getWorkOrderReceipt, transitionWorkOrder, LEGAL_TRANSITIONS,
} from '../../../lib/repositories/work-orders.repository';

export async function GET(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    await runWorkOrderSweeps(sql, orgId);
    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    const receipt = await getWorkOrderReceipt(sql, orgId, workOrderId);
    return NextResponse.json({ work_order: order, receipt });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_GET');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    const cancellable = LEGAL_TRANSITIONS[String(order.status)]?.includes('cancelled');
    if (!cancellable) {
      return NextResponse.json({ error: 'not_cancellable', code: 'not_cancellable', status: order.status }, { status: 409 });
    }
    const updated = await transitionWorkOrder(sql, orgId, workOrderId, 'cancelled', { errorCode: 'cancelled_by_caller' });
    return NextResponse.json({ work_order: updated });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_CANCEL');
  }
}
```

- [ ] **Step 6: Implement `app/api/work-orders/[workOrderId]/complete/route.ts`**

```typescript
export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { digestJson } from '../../../../lib/integrity/canonicalize';
import { validateAgainstSchema } from '../../../../lib/work-orders/schema-validate';
import { buildReceiptBody, computeReceiptHash } from '../../../../lib/work-orders/receipt';
import { createActionRecord } from '../../../../lib/repositories/actions.repository';
import { createArtifact } from '../../../../lib/repositories/artifacts.repository';
import { upsertSignalSnapshots } from '../../../../lib/repositories/signals.repository';
import {
  getWorkOrder, getWorkOrderType, transitionWorkOrder, createWorkOrderReceipt,
} from '../../../../lib/repositories/work-orders.repository';

export async function POST(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const reportedStatus = body.status === 'failed' ? 'failed' : body.status === 'completed' ? 'completed' : null;
    if (!reportedStatus) {
      return NextResponse.json({ error: 'validation_failed', details: [{ field: 'status', message: "must be 'completed' or 'failed'", code: 'enum' }] }, { status: 400 });
    }

    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    if (order.status !== 'claimed') {
      return NextResponse.json({ error: 'not_claimed', code: 'not_claimed', status: order.status }, { status: 409 });
    }
    const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
    if (!agentId || agentId !== order.claimed_by) {
      return NextResponse.json({ error: 'not_claim_holder', code: 'not_claim_holder' }, { status: 403 });
    }

    // Output contract enforcement (completed only). Rejection leaves the order
    // claimed so the worker can fix and re-report before the lease expires.
    let outputHash: string | null = null;
    if (reportedStatus === 'completed') {
      const typeRow = await getWorkOrderType(sql, orgId, String(order.type));
      const output = body.output && typeof body.output === 'object' ? body.output : null;
      if (!output) {
        return NextResponse.json({ error: 'output_contract_violation', details: [{ field: 'output', message: 'required field missing', code: 'required' }] }, { status: 422 });
      }
      const outputErrors = validateAgainstSchema((typeRow?.output_schema ?? {}) as Record<string, unknown>, output);
      if (outputErrors.length) {
        return NextResponse.json({ error: 'output_contract_violation', details: outputErrors }, { status: 422 });
      }
      outputHash = digestJson(output);
      await createArtifact(sql, orgId, {
        artifact_type: 'work_order_output',
        name: `${order.type} output for ${workOrderId}`,
        agent_id: agentId,
        content: JSON.stringify(output),
        metadata: { work_order_id: workOrderId, content_hash: outputHash },
      } as never);
    }

    const error = (body.error && typeof body.error === 'object' ? body.error : null) as { code?: string; message?: string } | null;
    const updated = await transitionWorkOrder(sql, orgId, workOrderId, reportedStatus, {
      errorCode: reportedStatus === 'failed' ? (error?.code || 'worker_failed') : null,
      errorDetails: reportedStatus === 'failed' ? (error?.message || null) : null,
    });

    // Audit record via the existing record path; its id lands in the receipt.
    const auditId = `act_${crypto.randomUUID()}`;
    const cost = (body.cost && typeof body.cost === 'object' ? body.cost : null) as { input_tokens?: number; output_tokens?: number; total_usd?: number } | null;
    await createActionRecord(sql, {
      orgId,
      action_id: auditId,
      data: {
        agent_id: agentId,
        action_type: 'work_order.complete',
        declared_goal: `Complete work order ${workOrderId} (${order.type})`,
        input_summary: `work order ${order.type}, budget $${Number(order.max_cost_usd)}`,
        output_summary: reportedStatus === 'completed' ? `output ${outputHash}` : `failed: ${error?.code || 'worker_failed'}`,
        systems_touched: ['work_orders'],
        reversible: true,
        timestamp_end: new Date().toISOString(),
      },
      actionStatus: reportedStatus,
      costEstimate: cost?.total_usd ?? null,
      signature: null,
      verified: null,
      timestamp_start: String(order.claimed_at ?? order.created_at ?? new Date().toISOString()),
      riskScore: null,
    });

    const guardDecision = (order.guard_decision ?? {}) as Record<string, unknown>;
    const receiptBody = buildReceiptBody({
      order: { ...updated, claimed_by: agentId } as never,
      cost,
      outputHash,
      governance: {
        mode: 'governed',
        guard_decision_id: (guardDecision.decision_id as string) ?? null,
        audit_record_id: auditId,
        matched_policies: (guardDecision.matched_policies as string[]) ?? [],
      },
    });
    const receiptHash = computeReceiptHash(receiptBody);
    await createWorkOrderReceipt(sql, orgId, workOrderId, receiptBody, receiptHash);

    if (receiptBody.over_budget) {
      const now = new Date().toISOString();
      await upsertSignalSnapshots(sql, orgId, [{
        _hash: digestJson({ kind: 'work_order_over_budget', workOrderId }),
        type: 'work_order_over_budget',
        severity: 'warning',
        agent_id: agentId,
        work_order_id: workOrderId,
      }], now);
    }

    return NextResponse.json({
      work_order: updated,
      receipt: { receipt: receiptBody, receipt_hash: receiptHash },
    });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_COMPLETE');
  }
}
```

NOTE: verify `createArtifact`'s `ArtifactInput` fields against `app/lib/repositories/artifacts.repository.ts` before finalizing the call — match its actual field names (it has `action_id`/`step_id`/`agent_id`/`artifact_type`/`name`; put the work order linkage in whatever metadata/content fields exist; remove the `as never` once the shape matches).

- [ ] **Step 7: Implement `app/api/work-orders/[workOrderId]/artifacts/route.ts`**

```typescript
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { listArtifacts } from '../../../../lib/repositories/artifacts.repository';
import { getWorkOrder } from '../../../../lib/repositories/work-orders.repository';

export async function GET(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    // Artifacts are tagged with work_order_id in metadata at completion; filter
    // by type then narrow. If listArtifacts supports metadata filters, use them.
    const result = await listArtifacts(sql, orgId, { artifact_type: 'work_order_output', limit: 100 });
    const artifacts = (result.artifacts || []).filter((a) => {
      const meta = (a as Record<string, unknown> | null)?.metadata as Record<string, unknown> | null;
      return meta && meta.work_order_id === workOrderId;
    });
    return NextResponse.json({ artifacts, total: artifacts.length });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_ARTIFACTS');
  }
}
```

- [ ] **Step 8: Implement `app/api/work-orders/types/route.ts`**

```typescript
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { validateSchemaDefinition } from '../../../lib/work-orders/schema-validate';
import { ensureSeedTypes, listWorkOrderTypes, createWorkOrderType, getWorkOrderType } from '../../../lib/repositories/work-orders.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    await ensureSeedTypes(sql, orgId);
    const { searchParams } = new URL(request.url);
    const types = await listWorkOrderTypes(sql, orgId, searchParams.get('include_disabled') === 'true');
    return NextResponse.json({ types, total: types.length });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPES_LIST');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const type = typeof body.type === 'string' ? body.type.trim() : '';
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(type)) {
      return NextResponse.json({ error: 'validation_failed', details: [{ field: 'type', message: 'must be a snake_case slug (3-64 chars)', code: 'format' }] }, { status: 400 });
    }
    const details = [
      ...validateSchemaDefinition(body.input_schema).map((e) => ({ ...e, field: `input_schema.${e.field}` })),
      ...validateSchemaDefinition(body.output_schema).map((e) => ({ ...e, field: `output_schema.${e.field}` })),
    ];
    if (details.length) {
      return NextResponse.json({ error: 'validation_failed', details }, { status: 400 });
    }
    const existing = await getWorkOrderType(sql, orgId, type);
    if (existing) {
      return NextResponse.json({ error: 'type_exists', code: 'type_exists' }, { status: 409 });
    }
    const row = await createWorkOrderType(sql, orgId, {
      type,
      version: typeof body.version === 'string' ? body.version : '1.0',
      displayName: typeof body.display_name === 'string' ? body.display_name : null,
      description: typeof body.description === 'string' ? body.description : null,
      inputSchema: body.input_schema,
      outputSchema: body.output_schema,
      defaultMaxCostUsd: Number.isFinite(Number(body.default_max_cost_usd)) ? Number(body.default_max_cost_usd) : null,
      defaultTimeoutSeconds: Number.isFinite(Number(body.default_timeout_seconds)) ? Number(body.default_timeout_seconds) : null,
    });
    return NextResponse.json({ type: row }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPES_CREATE');
  }
}
```

- [ ] **Step 9: Implement `app/api/work-orders/types/[type]/route.ts`**

```typescript
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { validateSchemaDefinition } from '../../../../lib/work-orders/schema-validate';
import { getWorkOrderType, updateWorkOrderType, disableWorkOrderType } from '../../../../lib/repositories/work-orders.repository';

function bumpVersion(version: string): string {
  const [major, minor] = String(version).split('.').map((n) => parseInt(n, 10) || 0);
  return `${major}.${minor + 1}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const row = await getWorkOrderType(sql, orgId, type);
    if (!row) return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type' }, { status: 404 });
    return NextResponse.json({ type: row });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPE_GET');
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const existing = await getWorkOrderType(sql, orgId, type);
    if (!existing) return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type' }, { status: 404 });

    const schemaChanged = body.input_schema !== undefined || body.output_schema !== undefined;
    const details = [
      ...(body.input_schema !== undefined ? validateSchemaDefinition(body.input_schema).map((e) => ({ ...e, field: `input_schema.${e.field}` })) : []),
      ...(body.output_schema !== undefined ? validateSchemaDefinition(body.output_schema).map((e) => ({ ...e, field: `output_schema.${e.field}` })) : []),
    ];
    if (details.length) return NextResponse.json({ error: 'validation_failed', details }, { status: 400 });

    const version = typeof body.version === 'string' ? body.version
      : schemaChanged ? bumpVersion(String(existing.version)) : String(existing.version);

    const row = await updateWorkOrderType(sql, orgId, type, {
      version,
      displayName: typeof body.display_name === 'string' ? body.display_name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      inputSchema: body.input_schema,
      outputSchema: body.output_schema,
      defaultMaxCostUsd: Number.isFinite(Number(body.default_max_cost_usd)) ? Number(body.default_max_cost_usd) : undefined,
      defaultTimeoutSeconds: Number.isFinite(Number(body.default_timeout_seconds)) ? Number(body.default_timeout_seconds) : undefined,
    });
    return NextResponse.json({ type: row });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPE_UPDATE');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const row = await disableWorkOrderType(sql, orgId, type); // soft-disable, history preserved
    if (!row) return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type' }, { status: 404 });
    return NextResponse.json({ type: row });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPE_DISABLE');
  }
}
```

- [ ] **Step 10: Move `runWorkOrderSweeps` to `app/lib/work-orders/sweeps.ts`** (the safe default — route files should only export HTTP verbs). Update both importing routes. The function body is exactly the one shown in Step 3; its file imports from `../repositories/work-orders.repository` and `./receipt`.

- [ ] **Step 11: Run tests + typecheck**

Run: `npx vitest run __tests__/unit/work-orders.route.test.ts` → PASS
Run: `npm run typecheck` → clean
Run: `npm run route-sql:check` → no new direct SQL in routes

- [ ] **Step 12: Commit** (pre-commit regenerates API inventory + OpenAPI — let it stage them)

```bash
git add app/api/work-orders app/lib/work-orders __tests__/unit/work-orders.route.test.ts
git commit -m "feat(work-orders): API surface — submit/claim/complete/cancel + contract registry"
```

---

### Task 6: Demo mode handlers (GET endpoints)

**Files:**
- Modify: `app/lib/demo/demoMiddleware.ts` (add three handlers + small fixture data inline)
- Modify: `middleware.js` (dispatch entries — MUST precede the demo write-block/403 fallback, next to the other GET dispatches)

- [ ] **Step 1: Add handlers to `demoMiddleware.ts`**

```typescript
const DEMO_WORK_ORDER_TYPES = [
  {
    id: 'wot_demo_1', type: 'research_brief', version: '1.0', status: 'active',
    display_name: 'Research Brief', description: 'Structured research synthesis: topic in, sourced findings out.',
    default_max_cost_usd: '0.50', default_timeout_seconds: 600,
    input_schema: { type: 'object', required: ['topic'], properties: { topic: { type: 'string' } } },
    output_schema: { type: 'object', required: ['title', 'summary', 'findings'], properties: { title: { type: 'string' }, summary: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } } } },
    created_at: '2026-06-01T12:00:00.000Z', updated_at: '2026-06-01T12:00:00.000Z',
  },
];

const DEMO_WORK_ORDERS = [
  {
    id: 'wo_demo_completed', type: 'research_brief', type_version: '1.0', status: 'completed',
    input: { topic: 'Agent-to-agent payment protocols' }, input_hash: 'sha256:demo-input',
    max_cost_usd: '0.25', timeout_seconds: 600, requested_by: 'orchestrator-1', claimed_by: 'research-worker-1',
    guard_decision: { decision: 'allow', decision_id: 'act_gd_demo1', risk_score: 12, matched_policies: [] },
    created_at: '2026-06-10T14:00:00.000Z', claimed_at: '2026-06-10T14:00:04.000Z', completed_at: '2026-06-10T14:02:31.000Z',
  },
  {
    id: 'wo_demo_pending', type: 'research_brief', type_version: '1.0', status: 'pending_approval',
    input: { topic: 'Production deploy risk assessment' }, input_hash: 'sha256:demo-input-2',
    max_cost_usd: '5.00', timeout_seconds: 1200, requested_by: 'orchestrator-1', claimed_by: null,
    guard_decision: { decision: 'require_approval', decision_id: 'act_gd_demo2', risk_score: 72, matched_policies: ['spend-ceiling'] },
    created_at: '2026-06-11T09:30:00.000Z', claimed_at: null, completed_at: null,
  },
  {
    id: 'wo_demo_queued', type: 'research_brief', type_version: '1.0', status: 'queued',
    input: { topic: 'Competitor receipt formats' }, input_hash: 'sha256:demo-input-3',
    max_cost_usd: '0.40', timeout_seconds: 600, requested_by: 'orchestrator-2', claimed_by: null,
    guard_decision: { decision: 'allow', decision_id: 'act_gd_demo3', risk_score: 8, matched_policies: [] },
    created_at: '2026-06-11T10:10:00.000Z', claimed_at: null, completed_at: null,
  },
];

const DEMO_WORK_ORDER_RECEIPT = {
  receipt: {
    receipt_version: '1.0', work_order_id: 'wo_demo_completed', type: 'research_brief', type_version: '1.0',
    status: 'completed', input_hash: 'sha256:demo-input', output_hash: 'sha256:demo-output',
    budget: { max_cost_usd: 0.25, timeout_seconds: 600 },
    cost: { input_tokens: 4200, output_tokens: 1800, total_usd: 0.11 },
    over_budget: false, worker: 'research-worker-1', requested_by: 'orchestrator-1',
    lifecycle: { created_at: '2026-06-10T14:00:00.000Z', claimed_at: '2026-06-10T14:00:04.000Z', completed_at: '2026-06-10T14:02:31.000Z' },
    error: null,
    governance: { mode: 'governed', guard_decision_id: 'act_gd_demo1', audit_record_id: 'act_demo_audit', matched_policies: [] },
  },
  receipt_hash: 'sha256:demo-receipt-hash',
};

export function demoListWorkOrders(url: URL) {
  const status = url.searchParams.get('status') || undefined;
  const type = url.searchParams.get('type') || undefined;
  let items = [...DEMO_WORK_ORDERS];
  if (status) items = items.filter((o) => o.status === status);
  if (type) items = items.filter((o) => o.type === type);
  return { work_orders: items, total: items.length };
}

export function demoGetWorkOrder(workOrderId: string) {
  const order = DEMO_WORK_ORDERS.find((o) => o.id === workOrderId) || null;
  if (!order) return { error: 'work_order_not_found', code: 'work_order_not_found' };
  return { work_order: order, receipt: order.status === 'completed' ? DEMO_WORK_ORDER_RECEIPT : null };
}

export function demoListWorkOrderTypes() {
  return { types: DEMO_WORK_ORDER_TYPES, total: DEMO_WORK_ORDER_TYPES.length };
}
```

- [ ] **Step 2: Wire dispatch in `middleware.js`** following the existing `/api/actions` demo dispatch pattern (import the three functions at the top with the other demo imports; add GET cases for `/api/work-orders`, `/api/work-orders/types`, and the `/api/work-orders/{id}` prefix match BEFORE the demo 403 fallback). Match the surrounding code style exactly — look at how `/api/agents/*` demo handlers precede `isDemoAgentDetailPath`.

- [ ] **Step 3: Verify demo mode manually** — `npm run dev`, set the demo cookie via the demo entry point (`/demo`), open `/api/work-orders` in the browser → JSON with 3 demo orders. (If `/demo` flow is heavier, verifying via the page in Task 7 is fine.)

- [ ] **Step 4: Commit**

```bash
git add app/lib/demo/demoMiddleware.ts middleware.js
git commit -m "feat(work-orders): demo-mode fixtures for ledger + contracts"
```

---

### Task 7: Dashboard UI (`/work-orders`) + nav

**Files:**
- Create: `app/work-orders/page.tsx`
- Modify: `app/components/Sidebar.tsx` (add `{ href: '/work-orders', icon: ClipboardList, label: 'Work Orders' }` to the **Govern** group after Approvals; import `ClipboardList` from `lucide-react`)
- Test: `__tests__/unit/work-orders-page.test.tsx`

Design rules: `.impeccable.md` — tokens only (no hex), evidence over decoration, calm under pressure. Status chips reuse the Badge component. Follow the `app/spend/page.tsx` skeleton (client component, `load()` with one retry, error + Retry, PageLayout).

- [ ] **Step 1: Failing page test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/work-orders',
}));
vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1><div>{actions}</div>{children}</div>
  ),
}));

const ORDERS = {
  work_orders: [
    { id: 'wo_1', type: 'research_brief', status: 'completed', max_cost_usd: '0.25', claimed_by: 'worker-1', created_at: '2026-06-10T14:00:00Z', completed_at: '2026-06-10T14:02:31Z' },
    { id: 'wo_2', type: 'research_brief', status: 'queued', max_cost_usd: '0.40', claimed_by: null, created_at: '2026-06-11T10:10:00Z', completed_at: null },
  ],
  total: 2,
};
const TYPES = { types: [{ type: 'research_brief', version: '1.0', status: 'active', display_name: 'Research Brief', default_max_cost_usd: '0.5', default_timeout_seconds: 600, input_schema: {}, output_schema: {} }], total: 1 };

function makeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.includes('/api/work-orders/types') ? TYPES
      : url.includes('/api/work-orders/wo_1') ? { work_order: ORDERS.work_orders[0], receipt: { receipt: { work_order_id: 'wo_1' }, receipt_hash: 'sha256:x' } }
      : ORDERS;
    return { ok: true, json: async () => payload } as Response;
  });
}

import WorkOrdersPage from '@/work-orders/page';

beforeEach(() => {
  vi.stubGlobal('fetch', makeFetch());
});

describe('WorkOrdersPage', () => {
  it('renders the ledger with orders and status chips', async () => {
    render(<WorkOrdersPage />);
    await waitFor(() => expect(screen.getByText('wo_1')).toBeTruthy());
    expect(screen.getByText('queued')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
  });

  it('switches to the Contracts tab and lists registered types', async () => {
    render(<WorkOrdersPage />);
    await waitFor(() => expect(screen.getByText('wo_1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /contracts/i }));
    await waitFor(() => expect(screen.getByText('Research Brief')).toBeTruthy());
  });
});
```

(Import alias for the page: match how other page tests import — check `grep -rn "from '@/" __tests__/unit/posture-page.test.tsx | head` and copy the alias style.)

- [ ] **Step 2: Run → FAIL**, then implement `app/work-orders/page.tsx`. Full component (~260 lines), following the spend-page skeleton:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';

type WorkOrder = {
  id: string; type: string; type_version?: string; status: string;
  max_cost_usd: string | number; timeout_seconds?: number;
  requested_by?: string | null; claimed_by?: string | null;
  created_at?: string | null; completed_at?: string | null;
  guard_decision?: Record<string, unknown> | null;
  error_code?: string | null;
};
type WorkOrderType = {
  type: string; version: string; status: string; display_name?: string | null;
  description?: string | null; default_max_cost_usd?: string | number | null;
  default_timeout_seconds?: number | null;
  input_schema: unknown; output_schema: unknown;
};
type ReceiptEnvelope = { receipt: Record<string, unknown>; receipt_hash: string } | null;

const STATUS_TONE: Record<string, string> = {
  completed: 'text-success', queued: 'text-secondary', claimed: 'text-accent',
  pending_approval: 'text-warning', failed: 'text-error', timed_out: 'text-error',
  cancelled: 'text-tertiary', blocked: 'text-error',
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] || 'text-secondary'}`}>
      {status}
    </span>
  );
}

export default function WorkOrdersPage() {
  const [tab, setTab] = useState<'ledger' | 'contracts'>('ledger');
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [types, setTypes] = useState<WorkOrderType[] | null>(null);
  const [selected, setSelected] = useState<{ order: WorkOrder; receipt: ReceiptEnvelope } | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [verifyResult, setVerifyResult] = useState<null | 'valid' | 'invalid'>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
        const [ordersRes, typesRes] = await Promise.all([
          fetch(`/api/work-orders${qs}`, { cache: 'no-store' }),
          fetch('/api/work-orders/types', { cache: 'no-store' }),
        ]);
        if (!ordersRes.ok || !typesRes.ok) throw new Error(`HTTP ${ordersRes.status}/${typesRes.status}`);
        const ordersJson = await ordersRes.json();
        const typesJson = await typesRes.json();
        setOrders(ordersJson.work_orders || []);
        setTypes(typesJson.types || []);
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    console.error('Failed to load work orders:', lastErr);
    setError(true);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openOrder = useCallback(async (id: string) => {
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/work-orders/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSelected({ order: json.work_order, receipt: json.receipt });
    } catch (err) {
      console.error('Failed to load work order detail:', err);
    }
  }, []);

  // Client-side receipt verification: recompute sha256 over the canonical
  // (sorted-key, no-whitespace) JSON of the receipt body and compare.
  const verifyReceipt = useCallback(async () => {
    if (!selected?.receipt) return;
    const canonical = (value: unknown): string => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    };
    const bytes = new TextEncoder().encode(canonical(selected.receipt.receipt));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const b64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    setVerifyResult(`sha256:${b64url}` === selected.receipt.receipt_hash ? 'valid' : 'invalid');
  }, [selected]);

  return (
    <PageLayout
      title="Work Orders"
      subtitle="Task-grade contracts for agent work — submit against a typed contract, get back a verifiable receipt"
      breadcrumbs={['Work Orders']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('ledger')} className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'ledger' ? 'bg-surface-secondary text-primary' : 'text-secondary'}`}>Ledger</button>
          <button onClick={() => setTab('contracts')} className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'contracts' ? 'bg-surface-secondary text-primary' : 'text-secondary'}`}>Contracts</button>
        </div>
      }
    >
      {loading ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-surface-secondary p-8 text-center">
          <div className="text-sm text-error mb-3">Failed to load work orders.</div>
          <button onClick={load} className="rounded-lg border border-border px-3 py-1.5 text-sm">Retry</button>
        </div>
      ) : tab === 'ledger' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title="Ledger"
                action={
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs">
                    <option value="">All statuses</option>
                    {['queued', 'claimed', 'pending_approval', 'completed', 'failed', 'timed_out', 'cancelled', 'blocked'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                }
              />
              <CardContent>
                {!orders?.length ? (
                  <div className="text-sm text-tertiary py-6 text-center">No work orders yet. Submit one via the API or SDK — see /docs.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-tertiary">
                        <th className="py-2 pr-3">Order</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Budget</th><th className="py-2 pr-3">Worker</th><th className="py-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} className="border-t border-border cursor-pointer hover:bg-surface-secondary" onClick={() => openOrder(o.id)}>
                          <td className="py-2 pr-3 font-mono text-xs">{o.id}</td>
                          <td className="py-2 pr-3">{o.type}</td>
                          <td className="py-2 pr-3"><StatusChip status={o.status} /></td>
                          <td className="py-2 pr-3">${Number(o.max_cost_usd).toFixed(2)}</td>
                          <td className="py-2 pr-3">{o.claimed_by || '—'}</td>
                          <td className="py-2 text-xs text-tertiary">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
          <div>
            <Card>
              <CardHeader title={selected ? selected.order.id : 'Receipt'} />
              <CardContent>
                {!selected ? (
                  <div className="text-sm text-tertiary py-6 text-center">Select an order to inspect its receipt and governance trail.</div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2"><StatusChip status={selected.order.status} /><span className="text-tertiary text-xs">{selected.order.type}@{selected.order.type_version}</span></div>
                    {selected.order.guard_decision ? (
                      <div className="text-xs text-secondary">
                        Guard: {String((selected.order.guard_decision as Record<string, unknown>).decision)} · risk {String((selected.order.guard_decision as Record<string, unknown>).risk_score ?? '—')}
                      </div>
                    ) : null}
                    {selected.order.error_code ? <div className="text-xs text-error">Error: {selected.order.error_code}</div> : null}
                    {selected.receipt ? (
                      <>
                        <div className="flex items-center gap-2">
                          <button onClick={verifyReceipt} className="rounded-lg border border-border px-2 py-1 text-xs">Verify receipt hash</button>
                          {verifyResult === 'valid' ? <span className="text-xs text-success">hash verifies</span> : null}
                          {verifyResult === 'invalid' ? <span className="text-xs text-error">HASH MISMATCH</span> : null}
                        </div>
                        <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface-secondary p-3 text-xs">
                          {JSON.stringify(selected.receipt, null, 2)}
                        </pre>
                      </>
                    ) : (
                      <div className="text-xs text-tertiary">No receipt yet — receipts are written when the order reaches a terminal state.</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader title="Registered contracts" />
          <CardContent>
            {!types?.length ? (
              <div className="text-sm text-tertiary py-6 text-center">No contracts registered.</div>
            ) : (
              <div className="space-y-4">
                {types.map((t) => (
                  <div key={t.type} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">{t.display_name || t.type}</span>
                        <span className="ml-2 font-mono text-xs text-tertiary">{t.type}@{t.version}</span>
                      </div>
                      <StatusChip status={t.status} />
                    </div>
                    {t.description ? <p className="mt-1 text-sm text-secondary">{t.description}</p> : null}
                    <div className="mt-2 text-xs text-tertiary">
                      defaults: ${Number(t.default_max_cost_usd ?? 0).toFixed(2)} ceiling · {t.default_timeout_seconds ?? '—'}s timeout
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-secondary">Input / output schema</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-secondary p-3 text-xs">{JSON.stringify({ input_schema: t.input_schema, output_schema: t.output_schema }, null, 2)}</pre>
                    </details>
                  </div>
                ))}
                <p className="text-xs text-tertiary">Register new contracts via <code>POST /api/work-orders/types</code> or the SDK (<code>registerWorkOrderType</code>). See /docs.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}
```

IMPORTANT: the client-side `canonical()` MUST produce byte-identical output to `canonicalizeJson` on the server, or "Verify" lies. Open `app/lib/canonical-json.*` and mirror its exact behavior (key sort order, undefined handling, unicode normalization). If it does anything beyond sorted-keys-compact (e.g. NFC normalization), import the shared module into the client component instead of reimplementing — it's plain TS with no node deps if it only manipulates strings/objects; only the sha256 step needs `crypto.subtle` on the client. Verify CardHeader's prop name for the right-side slot (`action` vs `actions`) in `app/components/ui/Card.tsx` and match it.

- [ ] **Step 3: Add the Sidebar entry**, run the page test + FULL suite (shared-component render tests are the usual casualty):

Run: `npx vitest run` → all green
Run: `npx next build` → green (page is client-only; no `useSearchParams`, so no Suspense wrapper needed)

- [ ] **Step 4: Commit**

```bash
git add app/work-orders __tests__/unit/work-orders-page.test.tsx app/components/Sidebar.tsx
git commit -m "feat(work-orders): /work-orders ledger + contracts dashboard page"
```

---

### Task 8: Node SDK methods (8)

**Files:**
- Modify: `sdk/dashclaw.js` (add a "Work Orders" method block near the other API method groups)
- Modify: `sdk/README.md` (document the methods; counts updated in Task 12)
- Test: follow how existing SDK methods are tested (check `__tests__/unit/` for sdk tests or `sdk/` test files — `grep -rln "dashclaw.js" __tests__ sdk --include=*.test.*`); add equivalent coverage for the 8 new methods asserting method/path/body.

- [ ] **Step 1: Add methods to `sdk/dashclaw.js`**

```javascript
  // --- Work Orders (task-grade contracts + receipts) ---

  /** Submit a work order against a registered contract. */
  async submitWorkOrder(order) {
    return this._post('/api/work-orders', {
      ...order,
      requested_by: order.requested_by || this.agentId,
    });
  }

  /** Get a work order + its receipt (when terminal). */
  async getWorkOrder(workOrderId) {
    return this._get(`/api/work-orders/${workOrderId}`);
  }

  /** List work orders. Filters: { status, type, agent, limit, offset } */
  async listWorkOrders(filters = {}) {
    return this._get('/api/work-orders', filters);
  }

  /** Cancel a queued/claimed/pending-approval work order. */
  async cancelWorkOrder(workOrderId) {
    return this._request(`/api/work-orders/${workOrderId}`, 'DELETE');
  }

  /** Worker: claim the next queued order of the given types (lease = timeout). */
  async claimWorkOrder({ types = null, agent_id = null } = {}) {
    return this._post('/api/work-orders/claim', {
      types,
      agent_id: agent_id || this.agentId,
    });
  }

  /** Worker: report completion. result = { status, output?, cost?, error?, agent_id? } */
  async completeWorkOrder(workOrderId, result) {
    return this._post(`/api/work-orders/${workOrderId}/complete`, {
      ...result,
      agent_id: result.agent_id || this.agentId,
    });
  }

  /** List registered work order contracts. */
  async listWorkOrderTypes() {
    return this._get('/api/work-orders/types');
  }

  /** Register a new work order contract (input/output JSON Schema). */
  async registerWorkOrderType(definition) {
    return this._post('/api/work-orders/types', definition);
  }
```

- [ ] **Step 2: Tests** (mirror the existing SDK test convention found in Step 0 grep), e.g.:

```javascript
it('submitWorkOrder posts to /api/work-orders with requested_by default', async () => {
  const claw = makeRecordingClient(); // whatever the existing harness is
  await claw.submitWorkOrder({ type: 'research_brief', input: { topic: 'x' } });
  expect(lastCall().path).toBe('/api/work-orders');
  expect(lastCall().body.requested_by).toBe(claw.agentId);
});
```

- [ ] **Step 3: Run** `node scripts/count-sdk-methods.mjs` and note the new Node count (needed in Task 12). Run the SDK tests + `npx vitest run`.

- [ ] **Step 4: Commit**

```bash
git add sdk/dashclaw.js sdk/README.md <test files>
git commit -m "feat(sdk): work orders — submit/claim/complete/cancel/types (8 methods)"
```

---

### Task 9: Python SDK methods (8) + MCP tools (2)

**Files:**
- Modify: `sdk-python/dashclaw/client.py`
- Modify: `sdk-python/tests/test_sdk_v2_surface.py` (RecordingDashClaw assertions)
- Modify: `mcp-server/src/tools.ts` (2 tool definitions), the tool-handlers module (find via `grep -n "createToolHandlers" mcp-server/src/*.ts`), `mcp-server/test/tools.test.ts`
- Modify: `docs/sdk-parity.md` (add the Work Orders surface rows)

- [ ] **Step 1: Python methods** (snake_case mirror):

```python
    # --- Work Orders (task-grade contracts + receipts) ---

    def submit_work_order(self, order):
        """Submit a work order against a registered contract."""
        payload = {**order}
        payload.setdefault("requested_by", self.agent_id)
        return self._request("/api/work-orders", "POST", json_payload=payload)

    def get_work_order(self, work_order_id):
        """Get a work order + its receipt (when terminal)."""
        return self._request(f"/api/work-orders/{work_order_id}", "GET")

    def list_work_orders(self, filters=None):
        """List work orders. Filters: status, type, agent, limit, offset."""
        return self._request("/api/work-orders", "GET", params=filters or {})

    def cancel_work_order(self, work_order_id):
        """Cancel a queued/claimed/pending-approval work order."""
        return self._request(f"/api/work-orders/{work_order_id}", "DELETE")

    def claim_work_order(self, types=None, agent_id=None):
        """Worker: claim the next queued order of the given types."""
        return self._request("/api/work-orders/claim", "POST", json_payload={
            "types": types,
            "agent_id": agent_id or self.agent_id,
        })

    def complete_work_order(self, work_order_id, result):
        """Worker: report completion. result = {status, output?, cost?, error?}."""
        payload = {**result}
        payload.setdefault("agent_id", self.agent_id)
        return self._request(f"/api/work-orders/{work_order_id}/complete", "POST", json_payload=payload)

    def list_work_order_types(self):
        """List registered work order contracts."""
        return self._request("/api/work-orders/types", "GET")

    def register_work_order_type(self, definition):
        """Register a new work order contract (input/output JSON Schema)."""
        return self._request("/api/work-orders/types", "POST", json_payload=definition)
```

Match the file's ACTUAL `_request` keyword names (`json_payload` vs `json` — check a nearby method like `guard()` and copy its call style exactly). Add RecordingDashClaw tests asserting method+path for all 8.

- [ ] **Step 2: MCP tools** in `mcp-server/src/tools.ts` (append to `TOOL_DEFINITIONS`):

```typescript
  {
    name: 'dashclaw_work_order_submit',
    description:
      'Submit a DashClaw work order: a typed, budget-capped unit of agent work governed by ' +
      'policy. The order is validated against the registered contract for its type, guard-gated ' +
      '(may be blocked or parked for human approval), then queued for any worker to claim. ' +
      'Returns work_order_id + status + the guard decision.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: "Registered work order type (e.g. 'research_brief')" },
        input: { type: 'object', description: 'Input payload matching the contract input schema' },
        max_cost_usd: { type: 'number', description: 'Budget ceiling in USD (falls back to the type default)' },
        timeout_seconds: { type: 'integer', description: 'Lease/SLA seconds (falls back to the type default)' },
      },
      required: ['type', 'input'],
    },
  },
  {
    name: 'dashclaw_work_order_status',
    description:
      'Check a DashClaw work order: current lifecycle status, worker, guard decision, and — once ' +
      'terminal — the self-verifying receipt (cost, output hash, governance trail).',
    inputSchema: {
      type: 'object',
      properties: {
        work_order_id: { type: 'string', description: 'The wo_* id returned at submission' },
      },
      required: ['work_order_id'],
    },
  },
```

Handlers (in the tool-handlers module, matching its existing style — handlers return a string):

```typescript
  dashclaw_work_order_submit: async (args) => {
    const { type, input, max_cost_usd, timeout_seconds } = args as { type: string; input: Record<string, unknown>; max_cost_usd?: number; timeout_seconds?: number };
    const budget: Record<string, unknown> = {};
    if (max_cost_usd !== undefined) budget.max_cost_usd = max_cost_usd;
    if (timeout_seconds !== undefined) budget.timeout_seconds = timeout_seconds;
    const result = await client.post('/api/work-orders', { type, input, ...(Object.keys(budget).length ? { budget } : {}) });
    return JSON.stringify(result, null, 2);
  },
  dashclaw_work_order_status: async (args) => {
    const { work_order_id } = args as { work_order_id: string };
    const result = await client.get(`/api/work-orders/${work_order_id}`);
    return JSON.stringify(result, null, 2);
  },
```

(Use the handler module's real client helper names — check how `dashclaw_guard`'s handler calls the API and copy.) Add both tools to the gated/governance registration set the way the other `dashclaw_*` tools are gated. Extend `mcp-server/test/tools.test.ts` the way neighboring tools are covered.

- [ ] **Step 3: Run** the Python tests (`cd sdk-python && python -m pytest tests/ -q` or the repo's documented runner), the mcp-server tests (`cd mcp-server && npm test`), and note the new MCP tool count + Python method count for Task 12.

- [ ] **Step 4: Commit**

```bash
git add sdk-python mcp-server docs/sdk-parity.md
git commit -m "feat(work-orders): Python SDK methods + MCP submit/status tools"
```

---

### Task 10: Reference worker example

**Files:**
- Create: `examples/work-order-worker/index.js`
- Create: `examples/work-order-worker/package.json`
- Create: `examples/work-order-worker/.env.example`
- Create: `examples/work-order-worker/README.md`

- [ ] **Step 1: `index.js`** (~100 lines; SDK-driven claim→execute→complete loop; Claude API only if a key is present, deterministic mock otherwise):

```javascript
// DashClaw reference work-order worker.
// Claims queued work orders, executes research_brief via Claude (or a
// deterministic mock when no ANTHROPIC_API_KEY is set), reports completion.
import { DashClaw } from 'dashclaw';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_URL || 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: process.env.WORKER_AGENT_ID || 'work-order-worker',
});

const POLL_MS = 5000;

async function executeResearchBrief(input) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      output: {
        title: `Research brief: ${input.topic}`,
        summary: `Deterministic mock brief for "${input.topic}" (set ANTHROPIC_API_KEY for a real one).`,
        findings: ['mock finding 1', 'mock finding 2'],
        sources: [],
        confidence: 0.1,
        limitations: ['generated without a live model'],
      },
      cost: { input_tokens: 0, output_tokens: 0, total_usd: 0 },
    };
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic();
  const model = process.env.MODEL || 'claude-sonnet-4-6';
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Write a research brief as pure JSON {"title","summary","findings":[],"sources":[],"confidence":0..1,"limitations":[]} on: ${input.topic}${input.scope ? `\nScope: ${input.scope}` : ''}`,
    }],
  });
  const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
  const output = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  // Pricing here is indicative for the example; receipts record what you report.
  const totalUsd = (msg.usage.input_tokens * 3 + msg.usage.output_tokens * 15) / 1e6;
  return { output, cost: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, total_usd: Number(totalUsd.toFixed(6)) } };
}

const HANDLERS = { research_brief: executeResearchBrief };

async function tick() {
  const { work_order: order } = await claw.claimWorkOrder({ types: Object.keys(HANDLERS) });
  if (!order) return;
  console.log(`claimed ${order.id} (${order.type})`);
  try {
    const { output, cost } = await HANDLERS[order.type](order.input);
    const res = await claw.completeWorkOrder(order.id, { status: 'completed', output, cost });
    console.log(`completed ${order.id} — receipt ${res.receipt.receipt_hash}`);
  } catch (err) {
    console.error(`failed ${order.id}:`, err.message);
    await claw.completeWorkOrder(order.id, { status: 'failed', error: { code: 'worker_error', message: err.message } });
  }
}

console.log(`work-order worker polling ${claw.baseUrl || process.env.DASHCLAW_URL} every ${POLL_MS}ms (types: ${Object.keys(HANDLERS).join(', ')})`);
setInterval(() => tick().catch((err) => console.error('tick error:', err.message)), POLL_MS);
tick().catch((err) => console.error('tick error:', err.message));
```

(Check `sdk/dashclaw.js`'s actual constructor options — `baseUrl`/`apiKey`/`agentId` naming — and the package name to import (`dashclaw`); copy from another examples/*/index.js.)

- [ ] **Step 2: `package.json`** (`"type": "module"`, deps: `dashclaw` (file:../../sdk or published name per other examples), `@anthropic-ai/sdk` as optionalDependency), **`.env.example`** (`DASHCLAW_URL=`, `DASHCLAW_API_KEY=`, `WORKER_AGENT_ID=`, `ANTHROPIC_API_KEY=` placeholder), **README.md** following the examples README pattern (The Goal → Prerequisites → Quick Start → Run → What This Proves → Expected Outcome → Dashboard View; "What This Proves": contract enforcement both directions, lease claim, self-verifying receipt, governance trail).

- [ ] **Step 3: Smoke it end-to-end against local dev** (this is the live success-criteria check):

```bash
npm run dev   # terminal 1
cd examples/work-order-worker && npm install && node index.js   # terminal 2 (mock mode, no key)
# terminal 3: submit + watch
curl -s -X POST http://localhost:3000/api/work-orders -H "x-api-key: <local key>" -H "content-type: application/json" \
  -d '{"type":"research_brief","input":{"topic":"agent payment rails"},"budget":{"max_cost_usd":0.25}}'
# poll GET /api/work-orders/<id> until completed; verify receipt_hash present; open /work-orders in the browser
```

Expected: order goes queued → claimed → completed; receipt with hash; visible in the dashboard; "Verify receipt hash" reports valid.

- [ ] **Step 4: Commit**

```bash
git add examples/work-order-worker
git commit -m "feat(work-orders): reference worker example (claim -> execute -> receipt)"
```

---

### Task 11: Demote the standalone MVP to prototype status

**Files:**
- Modify: `C:\Users\sandm\clawd\projects\task-grade-agent-marketplace-adapter\README.md` (outside this repo — no commit here)

- [ ] **Step 1:** Add a status banner at the very top:

```markdown
> **STATUS: PROTOTYPE (superseded).** This standalone adapter proved the contract
> model. The concept now ships natively in DashClaw as **Work Orders**
> (contracts + receipts ledger + claim/complete worker API) — see the DashClaw
> repo: `app/api/work-orders`, `/work-orders` dashboard, `examples/work-order-worker`.
> This codebase is kept as a reference implementation and is not maintained.
```

---

### Task 12: Docs + marketing accuracy pass

**Files (feature docs):**
- Modify: `app/landingData.js` — add a Work Orders entry to `platformFeatures` (icon + title + one-sentence description: "Work orders — typed task contracts with budget ceilings and self-verifying receipts; any agent can claim, every result is auditable.")
- Modify: `app/page.tsx` — only if the feature grid doesn't render purely from landingData (check first).
- Modify: `app/docs/page.tsx` — add a "Work Orders" section: the 8 SDK methods (Node + Python tabs) with request/response examples (use the real shapes from Task 5), the 2 MCP tools, and the REST endpoints table from the spec.
- Modify: `README.md`, `PROJECT_DETAILS.md`, `QUICK-START.md` — add Work Orders to the capability descriptions (one short paragraph each, consistent: "task-grade contracts + receipts; DashClaw stays control plane — execution is external workers via claim/complete").
- Modify: `sdk/README.md`, `sdk-python/README.md` — Work Orders method group docs.
- Modify: `mcp-server/README.md` — the 2 new tools under the governance tools list.
- Modify: `examples/README.md` (if an index of examples exists — check) — add work-order-worker.

**Counts (use script-reported values, never guessed):**

- [ ] **Step 1:** Run the count sources and capture real numbers:

```bash
node scripts/generate-api-inventory.mjs && node scripts/count-sdk-methods.mjs
node scripts/check-doc-counts.mjs --strict   # this will FAIL and list every stale citation — that's the worklist
```

- [ ] **Step 2:** Update every cited count the checker flags. Known citation map (from research; the checker output is authoritative):
  - `README.md` (routes line ~187; MCP tools/resources line ~110; Node/Python method counts line ~156)
  - `PROJECT_DETAILS.md` (~28)
  - `mcp-server/README.md` (~3, ~87 "## Tools (N)")
  - `sdk/README.md` (~636), `sdk-python/README.md` (~18, ~25, ~1018)
  - `app/docs/page.tsx`, `app/downloads/page.tsx`, `app/landingData.js`, `app/page.tsx`
  - `examples/README.md`, `examples/managed-agent-mcp/README.md`
  - `docs/CLAUDE-DESKTOP-PLUGIN.md`
  - `public/downloads/dashclaw-platform-intelligence/references/*.md` (regenerated by livingcode — run `npm run livingcode:refresh` instead of hand-editing)

- [ ] **Step 3: Marketing accuracy audit** (the user explicitly asked for this): dispatch the `dashclaw-drift-auditor` agent for the count/version sweep, and manually verify on `/`, `/connect`, `/docs`, `/self-host`, `/downloads`, `/guides/*`: every install command, env var name, SDK method name, MCP tool name, and integration path matches the code as of this branch. Fix everything found, in this commit.

- [ ] **Step 4:** `node scripts/check-doc-counts.mjs --strict` → exit 0. Commit:

```bash
git add -A
git commit -m "docs(work-orders): docs + marketing accuracy pass; refresh drift-gated counts"
```

---

### Task 13: Full verification gates

- [ ] **Step 1:** Run, in order, READING output:

```bash
npm run lint
npm run typecheck
npx vitest run
npx next build
npm run route-sql:check
node scripts/check-doc-counts.mjs --strict
npm run db:migrate   # idempotent re-check
```

All must exit 0. Fix anything red before proceeding (fix-on-the-spot rule).

- [ ] **Step 2:** Re-run the Task 10 end-to-end smoke once more on the final code (submit → worker completes → receipt verifies in UI).

---

### Task 14: Ship

- [ ] **Step 1:** Invoke the `dashclaw-ship` skill. It owns: landing on main, unified version bump (`npm run version:set`), regenerating artifacts (API inventory, OpenAPI, livingcode, platform-intelligence skill), final doc realignment, push (Vercel deploys). The one thing it cannot do is the credential-gated `npm run release:sdks` — note it for the owner.
- [ ] **Step 2:** Per memory: SDKs republish only when SDK source changed — **it did** (Tasks 8-9), so flag `npm run release:sdks` as owed.

---

## Plan self-review notes

- **Spec coverage:** every spec section maps to a task (data model→1, validation→2, receipts→3, repository/lifecycle/sweeps→4, API+guard→5, demo→6, UI+nav→7, SDKs→8-9, MCP→9, reference worker→10, MVP demotion→11, marketing/docs/counts→12, gates→13, ship→14). Success criteria 1-7 are exercised by Task 5 tests + Task 10 smoke + Task 13 gates.
- **Known verify-at-execution points (deliberate, marked NOTE/check in place):** `action_records` join column in `sweepApprovalReleases`; `ArtifactInput` exact fields; `CardHeader` action-slot prop; SDK test harness shape; Python `_request` kwarg names; MCP handler client helper names; canonical-JSON client parity; next free migration number. Each has an explicit instruction to check the named file first — none are placeholders for missing design.

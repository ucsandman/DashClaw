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
    WHERE org_id = ${orgId} AND id = ${id} AND status = ${String(current.status)}
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
// Joins on action_records.action_id (the act_* public id) and action_records.status.
export async function sweepApprovalReleases(sql: SqlTag, orgId: string): Promise<Row[]> {
  // The two UPDATE statements below target disjoint sets (ar.status='running' vs ar.status='failed'),
  // so partial failure cannot half-apply to the same row. Any row missed by a failed statement
  // retains its pending_approval status and is retried by the next lazy sweep.
  // Intentionally NOT wrapped in a transaction: the Neon HTTP driver is single-statement only.
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

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
    governance: { ...governance, matched_policies: governance.matched_policies ? [...governance.matched_policies] : undefined },
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

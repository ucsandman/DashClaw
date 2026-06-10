import crypto from 'node:crypto';
import type { SqlTag } from '../types/db';
import type { X402ProviderRow, X402EndpointRow, X402PurchaseRow, X402PurchaseListRow } from '../types/x402';
import type { X402SpendAggregation } from '../types/pricing-finops';

// There is NO shared slugify export in this repo. The house pattern is an inline
// per-repository copy (registered-agents / capabilities / workflow-templates
// repositories each define their own). Mirror it here.
function slugify(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64) || 'provider';
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
function parseJson(v: unknown): unknown {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v as string); } catch { return {}; }
}

interface ProviderInput {
  name?: string;
  slug?: string;
  description?: string;
  category?: string;
  base_url?: string | null;
  status?: string;
  default_currency?: string;
  pricing_model?: string | null;
  metadata?: unknown;
  [k: string]: unknown;
}

interface EndpointInput {
  name?: string;
  slug?: string;
  description?: string;
  endpoint_url?: string | null;
  category?: string;
  sensitivity_level?: string;
  default_price?: number | null;
  price_unit?: string;
  enabled?: boolean;
  metadata?: unknown;
  [k: string]: unknown;
}

interface PurchaseInput {
  provider_id?: string | null;
  endpoint_id?: string | null;
  agent_id?: string | null;
  spend_amount?: number;
  currency?: string;
  payment_method?: string | null;
  wallet_reference?: string | null;
  payment_reference?: string | null;
  purchase_reason?: string | null;
  context_gap?: string | null;
  alternatives_considered?: string | null;
  expected_value?: string | null;
  execution_status?: string;
  confidence_score?: number | null;
  [k: string]: unknown;
}

interface PurchaseOutcomeInput {
  execution_status?: string;
  result_summary?: string | null;
  result_reference?: string | null;
  value_score?: number | null;
  operator_feedback?: string | null;
  failure_reason?: string | null;
  [k: string]: unknown;
}

// --- Providers -------------------------------------------------------------
// CRUD here is create/list/get/update by design: providers are retired by setting
// status: 'disabled' via updateProvider (soft delete), never hard-deleted.

export async function createProvider(sql: SqlTag, orgId: string, data: ProviderInput = {}): Promise<X402ProviderRow | null> {
  const providerId = genId('prov');
  const slug = data.slug ? slugify(data.slug) : slugify(data.name || providerId);
  const rows = await sql`
    INSERT INTO x402_providers
      (provider_id, org_id, name, slug, description, category, base_url, status, default_currency, pricing_model, metadata)
    VALUES
      (${providerId}, ${orgId}, ${data.name || slug}, ${slug}, ${data.description || null}, ${data.category || 'research'},
       ${data.base_url || null}, ${data.status || 'active'}, ${data.default_currency || 'USDC'}, ${data.pricing_model || null},
       ${JSON.stringify(data.metadata || {})}::jsonb)
    RETURNING *`;
  return (rows[0] ?? null) as X402ProviderRow | null;
}

export async function listProviders(sql: SqlTag, orgId: string, { status }: { status?: string } = {}): Promise<X402ProviderRow[]> {
  if (status) {
    return (await sql`SELECT * FROM x402_providers WHERE org_id = ${orgId} AND status = ${status} ORDER BY created_at DESC`) as unknown as X402ProviderRow[];
  }
  return (await sql`SELECT * FROM x402_providers WHERE org_id = ${orgId} ORDER BY created_at DESC`) as unknown as X402ProviderRow[];
}

export async function getProvider(sql: SqlTag, orgId: string, providerId: string): Promise<X402ProviderRow | null> {
  const rows = await sql`SELECT * FROM x402_providers WHERE org_id = ${orgId} AND provider_id = ${providerId} LIMIT 1`;
  return (rows[0] ?? null) as X402ProviderRow | null;
}

const PROVIDER_PATCHABLE = ['name', 'description', 'category', 'base_url', 'status', 'default_currency', 'pricing_model'];

export async function updateProvider(sql: SqlTag, orgId: string, providerId: string, patch: ProviderInput = {}): Promise<X402ProviderRow | null> {
  const existing = await getProvider(sql, orgId, providerId);
  if (!existing) return null;
  const next: Record<string, unknown> = { ...existing };
  for (const k of PROVIDER_PATCHABLE) if (patch[k] !== undefined) next[k] = patch[k];
  const metadata = patch.metadata !== undefined ? patch.metadata : parseJson(existing.metadata);
  const rows = await sql`
    UPDATE x402_providers SET
      name = ${next.name}, description = ${next.description}, category = ${next.category}, base_url = ${next.base_url},
      status = ${next.status}, default_currency = ${next.default_currency}, pricing_model = ${next.pricing_model},
      metadata = ${JSON.stringify(metadata || {})}::jsonb, updated_at = NOW()
    WHERE org_id = ${orgId} AND provider_id = ${providerId}
    RETURNING *`;
  return (rows[0] ?? null) as X402ProviderRow | null;
}

// Resolve a provider row from a free-text provider name/origin, auto-registering
// one when none matches so the spend still groups under a real provider.
export async function resolveProviderByName(sql: SqlTag, orgId: string, providerName: unknown): Promise<X402ProviderRow | null> {
  const name = String(providerName || '').trim();
  if (!name) return null;
  const slug = slugify(name);
  const existing = await sql`
    SELECT * FROM x402_providers
    WHERE org_id = ${orgId} AND (slug = ${slug} OR LOWER(name) = ${name.toLowerCase()})
    ORDER BY created_at ASC
    LIMIT 1`;
  if (existing[0]) return existing[0] as unknown as X402ProviderRow;
  // No match — register a minimal active provider keyed by the name.
  const looksLikeHost = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name);
  return createProvider(sql, orgId, {
    name,
    slug,
    base_url: looksLikeHost ? `https://${name}` : null,
    category: 'x402',
    status: 'active',
  });
}

// --- Endpoints -------------------------------------------------------------

export async function createEndpoint(sql: SqlTag, orgId: string, providerId: string, data: EndpointInput = {}): Promise<X402EndpointRow | null> {
  const endpointId = genId('pep');
  const slug = data.slug ? slugify(data.slug) : slugify(data.name || endpointId);
  const rows = await sql`
    INSERT INTO x402_endpoints
      (endpoint_id, org_id, provider_id, name, slug, description, endpoint_url, category, sensitivity_level, default_price, price_unit, enabled, metadata)
    VALUES
      (${endpointId}, ${orgId}, ${providerId}, ${data.name || slug}, ${slug}, ${data.description || null}, ${data.endpoint_url || null},
       ${data.category || 'research'}, ${data.sensitivity_level || 'low'}, ${data.default_price ?? null}, ${data.price_unit || 'per_call'},
       ${data.enabled === false ? 0 : 1}, ${JSON.stringify(data.metadata || {})}::jsonb)
    RETURNING *`;
  return (rows[0] ?? null) as X402EndpointRow | null;
}

export async function listEndpoints(sql: SqlTag, orgId: string, providerId: string): Promise<X402EndpointRow[]> {
  return (await sql`SELECT * FROM x402_endpoints WHERE org_id = ${orgId} AND provider_id = ${providerId} ORDER BY created_at DESC`) as unknown as X402EndpointRow[];
}

export async function getEndpoint(sql: SqlTag, orgId: string, endpointId: string): Promise<X402EndpointRow | null> {
  const rows = await sql`SELECT * FROM x402_endpoints WHERE org_id = ${orgId} AND endpoint_id = ${endpointId} LIMIT 1`;
  return (rows[0] ?? null) as X402EndpointRow | null;
}

// --- Purchases (1:1 with action_records.action_id) -------------------------

export async function createPurchase(sql: SqlTag, orgId: string, actionId: string, data: PurchaseInput = {}): Promise<X402PurchaseRow | null> {
  const rows = await sql`
    INSERT INTO x402_purchases
      (action_id, org_id, provider_id, endpoint_id, agent_id, spend_amount, currency, payment_method,
       wallet_reference, payment_reference, purchase_reason, context_gap, alternatives_considered, expected_value,
       execution_status, confidence_score)
    VALUES
      (${actionId}, ${orgId}, ${data.provider_id || null}, ${data.endpoint_id || null}, ${data.agent_id || null},
       ${data.spend_amount ?? 0}, ${data.currency || 'USDC'}, ${data.payment_method || null},
       ${data.wallet_reference || null}, ${data.payment_reference || null}, ${data.purchase_reason || null},
       ${data.context_gap || null}, ${data.alternatives_considered || null}, ${data.expected_value || null},
       ${data.execution_status || 'pending'}, ${data.confidence_score ?? null})
    ON CONFLICT (action_id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id, endpoint_id = EXCLUDED.endpoint_id, spend_amount = EXCLUDED.spend_amount
    RETURNING *`;
  return (rows[0] ?? null) as X402PurchaseRow | null;
}

export async function getPurchase(sql: SqlTag, orgId: string, actionId: string): Promise<X402PurchaseRow | null> {
  const rows = await sql`SELECT * FROM x402_purchases WHERE org_id = ${orgId} AND action_id = ${actionId} LIMIT 1`;
  return (rows[0] ?? null) as X402PurchaseRow | null;
}

// Generous safety cap on this unbounded list SELECT (mirrors the connections /
// agent_presence caps from the query-perf phase). A single org's x402 purchases
// stay well under 1000; the literal bound only guards against pathological table
// growth dragging the query — it never truncates normal usage.
// p.* + aliased name only — a bare `*` across the join would collide on
// org_id/created_at/metadata and the driver silently keeps the last column.
// agent_id is nullable: agent-filtered lists exclude unattributed purchases.
export async function listPurchases(sql: SqlTag, orgId: string, { providerId, agentId }: { providerId?: string; agentId?: string | null } = {}): Promise<X402PurchaseListRow[]> {
  const providerFilter = providerId ? sql` AND p.provider_id = ${providerId}` : sql``;
  const agentFilter = agentId ? sql` AND p.agent_id = ${agentId}` : sql``;
  return (await sql`SELECT p.*, pr.name AS provider_name FROM x402_purchases p LEFT JOIN x402_providers pr ON pr.org_id = p.org_id AND pr.provider_id = p.provider_id WHERE p.org_id = ${orgId}${providerFilter}${agentFilter} ORDER BY p.created_at DESC LIMIT 1000`) as unknown as X402PurchaseListRow[];
}

export async function setPurchaseOutcome(sql: SqlTag, orgId: string, actionId: string, data: PurchaseOutcomeInput = {}): Promise<X402PurchaseRow | null> {
  const rows = await sql`
    UPDATE x402_purchases SET
      execution_status = ${data.execution_status || 'succeeded'},
      result_summary = ${data.result_summary || null},
      result_reference = ${data.result_reference || null},
      value_score = ${data.value_score ?? null},
      operator_feedback = ${data.operator_feedback || null},
      failure_reason = ${data.failure_reason || null},
      completed_at = NOW()
    WHERE org_id = ${orgId} AND action_id = ${actionId}
    RETURNING *`;
  return (rows[0] ?? null) as X402PurchaseRow | null;
}

// --- Aggregation (FinOps Fleet lens) ---------------------------------------

const X402_PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function getX402SpendAggregation(sql: SqlTag, orgId: string, { period = '30d', agentId = null }: { period?: string; agentId?: string | null } = {}): Promise<X402SpendAggregation> {
  const days = X402_PERIOD_DAYS[period] ?? 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  // x402_purchases.agent_id is NULLABLE (older purchases recorded without an
  // agent): agent-filtered sums correctly EXCLUDE unattributed rows, so a
  // filtered fleet total can be less than the sum over all agents. The /spend
  // UI states this when a filter is active. Mirrors actions.repository's
  // conditional-fragment pattern.
  const agentFilter = agentId ? sql` AND agent_id = ${agentId}` : sql``;
  // Exclude FAILED purchases from spend: a failed x402 call means no money moved.
  // succeeded/partial/approved/pending are retained. Operator decision 2026-06-05.
  const [totals] = await sql`
    SELECT COALESCE(SUM(spend_amount), 0)::real AS total_spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz AND execution_status <> 'failed'${agentFilter}`;
  const byDay = await sql`
    SELECT DATE(created_at::timestamptz) AS date, COALESCE(SUM(spend_amount), 0)::real AS spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz AND execution_status <> 'failed'${agentFilter}
    GROUP BY DATE(created_at::timestamptz)
    ORDER BY date DESC`;
  const byProvider = await sql`
    SELECT provider_id, COALESCE(SUM(spend_amount), 0)::real AS spend_usd, COUNT(*)::integer AS purchase_count
    FROM x402_purchases
    WHERE org_id = ${orgId} AND created_at::timestamptz >= ${since}::timestamptz AND execution_status <> 'failed'${agentFilter}
    GROUP BY provider_id
    ORDER BY spend_usd DESC`;
  return {
    period,
    // `::real` aggregates come back as STRINGS from the Neon/postgres drivers
    // (no type parser registered in db.js); coerce with Number() so the value
    // is a real number — `as number` would lie and `number + string` in
    // getFleetSpend would concatenate. Mirrors actions.repository getCostAggregation.
    total_spend_usd: Number(totals?.total_spend_usd ?? 0),
    purchase_count: Number(totals?.purchase_count ?? 0),
    by_day: byDay,
    by_provider: byProvider,
  };
}

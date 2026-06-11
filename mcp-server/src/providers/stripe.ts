import { httpJson, formEncode } from "./http.js";

/**
 * Stripe REST adapter. Base: https://api.stripe.com/v1 — auth: Bearer secret key.
 * Mode is determined ENTIRELY by the key prefix (sk_test_ vs sk_live_); there is
 * no per-request mode flag. Bodies are form-encoded (incl. bracketed nesting).
 */
const BASE = "https://api.stripe.com/v1";

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

export interface StripeProduct {
  id: string;
  name: string;
  active: boolean;
  created: number;
}

export async function createProduct(
  key: string,
  params: { name: string; description?: string },
): Promise<StripeProduct> {
  const data = await httpJson<Record<string, any>>(`${BASE}/products`, {
    method: "POST",
    headers: headers(key),
    body: formEncode({ name: params.name, description: params.description }),
  });
  return { id: data.id, name: data.name, active: data.active, created: data.created };
}

export async function listProducts(key: string, limit = 10): Promise<StripeProduct[]> {
  const data = await httpJson<{ data?: any[] }>(`${BASE}/products`, {
    headers: headers(key),
    query: { limit: String(limit) },
  });
  return (data.data ?? []).map((p: Record<string, any>) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    created: p.created,
  }));
}

export interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
}

export async function listCustomers(key: string, limit = 10): Promise<StripeCustomer[]> {
  const data = await httpJson<{ data?: any[] }>(`${BASE}/customers`, {
    headers: headers(key),
    query: { limit: String(limit) },
  });
  return (data.data ?? []).map((c: Record<string, any>) => ({
    id: c.id,
    email: c.email ?? null,
    name: c.name ?? null,
    created: c.created,
  }));
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  currentPeriodEnd?: number;
  created: number;
}

export async function listSubscriptions(
  key: string,
  params: { limit?: number; status?: string } = {},
): Promise<StripeSubscription[]> {
  const data = await httpJson<{ data?: any[] }>(`${BASE}/subscriptions`, {
    headers: headers(key),
    query: { limit: String(params.limit ?? 10), status: params.status },
  });
  return (data.data ?? []).map((s: Record<string, any>) => ({
    id: s.id,
    customer: typeof s.customer === "string" ? s.customer : s.customer?.id,
    status: s.status,
    currentPeriodEnd: s.current_period_end,
    created: s.created,
  }));
}

export interface StripeInvoice {
  id: string;
  customer: string | null;
  status: string | null;
  amountDue: number;
  currency: string;
  hostedInvoiceUrl?: string;
  created: number;
}

export async function listInvoices(
  key: string,
  params: { limit?: number; customer?: string } = {},
): Promise<StripeInvoice[]> {
  const data = await httpJson<{ data?: any[] }>(`${BASE}/invoices`, {
    headers: headers(key),
    query: { limit: String(params.limit ?? 10), customer: params.customer },
  });
  return (data.data ?? []).map((i: Record<string, any>) => ({
    id: i.id,
    customer: typeof i.customer === "string" ? i.customer : i.customer?.id ?? null,
    status: i.status ?? null,
    amountDue: i.amount_due ?? 0,
    currency: i.currency,
    hostedInvoiceUrl: i.hosted_invoice_url,
    created: i.created,
  }));
}

export interface StripeWebhookEndpoint {
  id: string;
  url: string;
  status?: string;
  enabledEvents?: string[];
  created: number;
  /** Signing secret (whsec_...). Returned by Stripe ONLY at creation time. */
  secret?: string;
}

function mapWebhookEndpoint(w: Record<string, any>): StripeWebhookEndpoint {
  return {
    id: w.id,
    url: w.url,
    status: w.status,
    enabledEvents: w.enabled_events,
    created: w.created,
    secret: w.secret,
  };
}

export async function createWebhookEndpoint(
  key: string,
  params: { url: string; enabledEvents: string[]; description?: string },
): Promise<StripeWebhookEndpoint> {
  const data = await httpJson<Record<string, any>>(`${BASE}/webhook_endpoints`, {
    method: "POST",
    headers: headers(key),
    body: formEncode({
      url: params.url,
      enabled_events: params.enabledEvents,
      description: params.description,
    }),
  });
  return mapWebhookEndpoint(data);
}

export async function listWebhookEndpoints(key: string, limit = 10): Promise<StripeWebhookEndpoint[]> {
  const data = await httpJson<{ data?: any[] }>(`${BASE}/webhook_endpoints`, {
    headers: headers(key),
    query: { limit: String(limit) },
  });
  return (data.data ?? []).map(mapWebhookEndpoint);
}

export interface StripePrice {
  id: string;
  product: string;
  unitAmount: number | null;
  currency: string;
  recurring: unknown;
}

export async function createPrice(
  key: string,
  params: {
    product: string;
    currency: string;
    unitAmount: number;
    recurringInterval?: "day" | "week" | "month" | "year";
  },
): Promise<StripePrice> {
  const body: Record<string, unknown> = {
    product: params.product,
    currency: params.currency,
    unit_amount: params.unitAmount,
  };
  if (params.recurringInterval) {
    body.recurring = { interval: params.recurringInterval };
  }
  const data = await httpJson<Record<string, any>>(`${BASE}/prices`, {
    method: "POST",
    headers: headers(key),
    body: formEncode(body),
  });
  return {
    id: data.id,
    product: data.product,
    unitAmount: data.unit_amount ?? null,
    currency: data.currency,
    recurring: data.recurring,
  };
}

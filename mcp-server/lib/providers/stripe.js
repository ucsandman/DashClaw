import { httpJson, formEncode } from "./http.js";
/**
 * Stripe REST adapter. Base: https://api.stripe.com/v1 — auth: Bearer secret key.
 * Mode is determined ENTIRELY by the key prefix (sk_test_ vs sk_live_); there is
 * no per-request mode flag. Bodies are form-encoded (incl. bracketed nesting).
 */
const BASE = "https://api.stripe.com/v1";
function headers(key) {
    return {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
    };
}
export async function createProduct(key, params) {
    const data = await httpJson(`${BASE}/products`, {
        method: "POST",
        headers: headers(key),
        body: formEncode({ name: params.name, description: params.description }),
    });
    return { id: data.id, name: data.name, active: data.active, created: data.created };
}
export async function listProducts(key, limit = 10) {
    const data = await httpJson(`${BASE}/products`, {
        headers: headers(key),
        query: { limit: String(limit) },
    });
    return (data.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active,
        created: p.created,
    }));
}
export async function listCustomers(key, limit = 10) {
    const data = await httpJson(`${BASE}/customers`, {
        headers: headers(key),
        query: { limit: String(limit) },
    });
    return (data.data ?? []).map((c) => ({
        id: c.id,
        email: c.email ?? null,
        name: c.name ?? null,
        created: c.created,
    }));
}
export async function listSubscriptions(key, params = {}) {
    const data = await httpJson(`${BASE}/subscriptions`, {
        headers: headers(key),
        query: { limit: String(params.limit ?? 10), status: params.status },
    });
    return (data.data ?? []).map((s) => ({
        id: s.id,
        customer: typeof s.customer === "string" ? s.customer : s.customer?.id,
        status: s.status,
        currentPeriodEnd: s.current_period_end,
        created: s.created,
    }));
}
export async function listInvoices(key, params = {}) {
    const data = await httpJson(`${BASE}/invoices`, {
        headers: headers(key),
        query: { limit: String(params.limit ?? 10), customer: params.customer },
    });
    return (data.data ?? []).map((i) => ({
        id: i.id,
        customer: typeof i.customer === "string" ? i.customer : i.customer?.id ?? null,
        status: i.status ?? null,
        amountDue: i.amount_due ?? 0,
        currency: i.currency,
        hostedInvoiceUrl: i.hosted_invoice_url,
        created: i.created,
    }));
}
function mapWebhookEndpoint(w) {
    return {
        id: w.id,
        url: w.url,
        status: w.status,
        enabledEvents: w.enabled_events,
        created: w.created,
        secret: w.secret,
    };
}
export async function createWebhookEndpoint(key, params) {
    const data = await httpJson(`${BASE}/webhook_endpoints`, {
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
export async function listWebhookEndpoints(key, limit = 10) {
    const data = await httpJson(`${BASE}/webhook_endpoints`, {
        headers: headers(key),
        query: { limit: String(limit) },
    });
    return (data.data ?? []).map(mapWebhookEndpoint);
}
export async function createPrice(key, params) {
    const body = {
        product: params.product,
        currency: params.currency,
        unit_amount: params.unitAmount,
    };
    if (params.recurringInterval) {
        body.recurring = { interval: params.recurringInterval };
    }
    const data = await httpJson(`${BASE}/prices`, {
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
//# sourceMappingURL=stripe.js.map
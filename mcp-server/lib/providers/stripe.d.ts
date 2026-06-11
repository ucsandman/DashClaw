export interface StripeProduct {
    id: string;
    name: string;
    active: boolean;
    created: number;
}
export declare function createProduct(key: string, params: {
    name: string;
    description?: string;
}): Promise<StripeProduct>;
export declare function listProducts(key: string, limit?: number): Promise<StripeProduct[]>;
export interface StripeCustomer {
    id: string;
    email: string | null;
    name: string | null;
    created: number;
}
export declare function listCustomers(key: string, limit?: number): Promise<StripeCustomer[]>;
export interface StripeSubscription {
    id: string;
    customer: string;
    status: string;
    currentPeriodEnd?: number;
    created: number;
}
export declare function listSubscriptions(key: string, params?: {
    limit?: number;
    status?: string;
}): Promise<StripeSubscription[]>;
export interface StripeInvoice {
    id: string;
    customer: string | null;
    status: string | null;
    amountDue: number;
    currency: string;
    hostedInvoiceUrl?: string;
    created: number;
}
export declare function listInvoices(key: string, params?: {
    limit?: number;
    customer?: string;
}): Promise<StripeInvoice[]>;
export interface StripeWebhookEndpoint {
    id: string;
    url: string;
    status?: string;
    enabledEvents?: string[];
    created: number;
    /** Signing secret (whsec_...). Returned by Stripe ONLY at creation time. */
    secret?: string;
}
export declare function createWebhookEndpoint(key: string, params: {
    url: string;
    enabledEvents: string[];
    description?: string;
}): Promise<StripeWebhookEndpoint>;
export declare function listWebhookEndpoints(key: string, limit?: number): Promise<StripeWebhookEndpoint[]>;
export interface StripePrice {
    id: string;
    product: string;
    unitAmount: number | null;
    currency: string;
    recurring: unknown;
}
export declare function createPrice(key: string, params: {
    product: string;
    currency: string;
    unitAmount: number;
    recurringInterval?: "day" | "week" | "month" | "year";
}): Promise<StripePrice>;
export declare function listPrices(key: string, limit?: number): Promise<StripePrice[]>;

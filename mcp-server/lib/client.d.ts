/**
 * HTTP client for DashClaw REST API.
 * Used by MCP tool and resource handlers.
 */
export interface DashClawClientOptions {
    /** DashClaw instance URL */
    url?: string;
    /** API key (oc_live_ prefix) */
    apiKey?: string;
    /** Default agent ID for tool calls */
    agentId?: string;
    /** Full Authorization header value (e.g. "Bearer oat_..."); when set, takes precedence over apiKey */
    authHeader?: string;
}
export interface DashClawFetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
}
/** Raw Response-like shape returned by DashClawClient.fetch. */
export interface DashClawHttpResponse {
    ok: boolean;
    status: number;
    json(): Promise<any>;
}
export declare class DashClawClient {
    baseUrl: string;
    apiKey: string;
    agentId: string;
    authHeader: string;
    constructor({ url, apiKey, agentId, authHeader }?: DashClawClientOptions);
    _authHeaders(): Record<string, string>;
    post(path: string, body: unknown, { timeout }?: {
        timeout?: number;
    }): Promise<any>;
    get(path: string, params?: Record<string, unknown>, { timeout }?: {
        timeout?: number;
    }): Promise<any>;
    patch(path: string, body: unknown, { timeout }?: {
        timeout?: number;
    }): Promise<any>;
    /**
     * Low-level fetch passthrough used by toolkit MCP handlers that need
     * direct access to status codes (e.g., 404-as-null) and per-call methods.
     * Returns the raw Response-like object: { ok, status, json() }.
     */
    fetch(path: string, opts?: DashClawFetchOptions): Promise<DashClawHttpResponse>;
}

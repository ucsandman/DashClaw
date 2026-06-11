export interface HttpOptions {
    method?: string;
    headers?: Record<string, string>;
    /** Raw body (string) — already encoded by the caller. */
    body?: string;
    query?: Record<string, string | undefined>;
    timeoutMs?: number;
}
/**
 * Minimal JSON HTTP client built on global fetch (Node 18+). Centralizes error
 * handling so adapters surface clean, agent-readable messages. Never logs
 * secrets; the caller is responsible for not putting tokens in `query`.
 */
export declare function httpJson<T = unknown>(url: string, opts?: HttpOptions): Promise<T>;
/** Encode an object as application/x-www-form-urlencoded, incl. bracketed nesting and indexed arrays. */
export declare function formEncode(obj: Record<string, unknown>, prefix?: string): string;

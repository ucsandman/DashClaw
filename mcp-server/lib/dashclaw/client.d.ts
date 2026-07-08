import type { DashclawConfig } from "./types.js";
type QueryValue = string | number | boolean | null | undefined;
export interface DashclawRequestConfig extends DashclawConfig {
    authHeader?: string;
}
export interface DashclawRequestOptions {
    method?: string;
    body?: unknown;
    query?: Record<string, QueryValue>;
    headers?: Record<string, string>;
    timeoutMs?: number;
}
export declare function redactDashclawMessage(text: string, configOrApiKey?: DashclawRequestConfig | string): string;
export declare function __resetInsecureUrlWarning(): void;
export declare function dashclawConfigFromEnv(): DashclawConfig;
export declare function dashclawRequest(path: string, opts?: DashclawRequestOptions, config?: DashclawRequestConfig): Promise<Response>;
export declare function dashclawFetch<T = unknown>(path: string, opts?: DashclawRequestOptions): Promise<T>;
export declare function parseDashclawResponseBody(response: Response): Promise<unknown>;
export {};

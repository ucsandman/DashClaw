import type { DashclawConfig } from "./types.js";
export declare function __resetInsecureUrlWarning(): void;
export declare function dashclawConfigFromEnv(): DashclawConfig;
export declare function dashclawFetch<T = unknown>(path: string, opts?: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | undefined>;
}): Promise<T>;

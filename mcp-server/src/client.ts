/**
 * HTTP client for DashClaw REST API.
 * Used by MCP tool and resource handlers.
 */

import { dashclawRequest, parseDashclawResponseBody, type DashclawRequestConfig } from "./dashclaw/client.js";

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

export class DashClawClient {
  baseUrl: string;
  apiKey: string;
  agentId: string;
  authHeader: string;

  constructor({ url, apiKey, agentId, authHeader }: DashClawClientOptions = {}) {
    this.baseUrl = (url || "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = apiKey || "";
    this.agentId = agentId || "";
    this.authHeader = authHeader || "";
  }

  // Build auth headers: prefer an explicit Authorization (OAuth) over x-api-key.
  _authHeaders(): Record<string, string> {
    return this.authHeader ? { Authorization: this.authHeader } : { "x-api-key": this.apiKey };
  }

  _requestConfig(timeout: number): DashclawRequestConfig {
    return {
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      authHeader: this.authHeader,
      timeoutMs: timeout,
      mode: "authoritative",
    };
  }

  _failureBody(data: unknown, status: number): any {
    const body = data && typeof data === "object" && !Array.isArray(data)
      ? data
      : { error: typeof data === "string" ? data : `HTTP ${status}` };
    return { ...body, _status: status };
  }

  async post(path: string, body: unknown, { timeout = 10000 }: { timeout?: number } = {}): Promise<any> {
    try {
      const res = await dashclawRequest(path, {
        method: "POST",
        body,
      }, this._requestConfig(timeout));
      const data: any = await parseDashclawResponseBody(res);
      if (!res.ok) return this._failureBody(data, res.status);
      return data;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), _status: 0 };
    }
  }

  async get(path: string, params: Record<string, unknown> = {}, { timeout = 10000 }: { timeout?: number } = {}): Promise<any> {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    ) as Record<string, string>;
    const qs = new URLSearchParams(filtered).toString();
    const url = qs ? `${this.baseUrl}${path}?${qs}` : `${this.baseUrl}${path}`;
    try {
      const res = await dashclawRequest(url, {
        method: "GET",
      }, this._requestConfig(timeout));
      const data: any = await parseDashclawResponseBody(res);
      if (!res.ok) return this._failureBody(data, res.status);
      return data;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), _status: 0 };
    }
  }

  async patch(path: string, body: unknown, { timeout = 10000 }: { timeout?: number } = {}): Promise<any> {
    try {
      const res = await dashclawRequest(path, {
        method: "PATCH",
        body,
      }, this._requestConfig(timeout));
      const data: any = await parseDashclawResponseBody(res);
      if (!res.ok) return this._failureBody(data, res.status);
      return data;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), _status: 0 };
    }
  }

  /**
   * Low-level fetch passthrough used by toolkit MCP handlers that need
   * direct access to status codes (e.g., 404-as-null) and per-call methods.
   * Returns the raw Response-like object: { ok, status, json() }.
   */
  async fetch(path: string, opts: DashClawFetchOptions = {}): Promise<DashClawHttpResponse> {
    const method = (opts.method || "GET").toUpperCase();
    const headers: Record<string, string> = { ...this._authHeaders(), ...(opts.headers || {}) };
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const timeout = opts.timeout ?? 10000;
    try {
      const res = await dashclawRequest(path, {
        method,
        headers,
        body: opts.body,
      }, this._requestConfig(timeout));
      return res;
    } catch (err) {
      return {
        ok: false,
        status: 0,
        json: async () => ({ error: err instanceof Error ? err.message : String(err), _status: 0 }),
      };
    }
  }
}

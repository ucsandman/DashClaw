/**
 * HTTP client for DashClaw REST API.
 * Used by MCP tool and resource handlers.
 */
export class DashClawClient {
    baseUrl;
    apiKey;
    agentId;
    authHeader;
    constructor({ url, apiKey, agentId, authHeader } = {}) {
        this.baseUrl = (url || "http://localhost:3000").replace(/\/$/, "");
        this.apiKey = apiKey || "";
        this.agentId = agentId || "";
        this.authHeader = authHeader || "";
    }
    // Build auth headers: prefer an explicit Authorization (OAuth) over x-api-key.
    _authHeaders() {
        return this.authHeader ? { Authorization: this.authHeader } : { "x-api-key": this.apiKey };
    }
    async post(path, body, { timeout = 10000 } = {}) {
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...this._authHeaders(),
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeout),
            });
            const data = await res.json();
            if (!res.ok)
                return { ...data, _status: res.status };
            return data;
        }
        catch (err) {
            return { error: err instanceof Error ? err.message : String(err), _status: 0 };
        }
    }
    async get(path, params = {}, { timeout = 10000 } = {}) {
        const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
        const qs = new URLSearchParams(filtered).toString();
        const url = qs ? `${this.baseUrl}${path}?${qs}` : `${this.baseUrl}${path}`;
        try {
            const res = await fetch(url, {
                method: "GET",
                headers: { ...this._authHeaders() },
                signal: AbortSignal.timeout(timeout),
            });
            const data = await res.json();
            if (!res.ok)
                return { ...data, _status: res.status };
            return data;
        }
        catch (err) {
            return { error: err instanceof Error ? err.message : String(err), _status: 0 };
        }
    }
    async patch(path, body, { timeout = 10000 } = {}) {
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...this._authHeaders(),
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeout),
            });
            const data = await res.json();
            if (!res.ok)
                return { ...data, _status: res.status };
            return data;
        }
        catch (err) {
            return { error: err instanceof Error ? err.message : String(err), _status: 0 };
        }
    }
    /**
     * Low-level fetch passthrough used by toolkit MCP handlers that need
     * direct access to status codes (e.g., 404-as-null) and per-call methods.
     * Returns the raw Response-like object: { ok, status, json() }.
     */
    async fetch(path, opts = {}) {
        const method = (opts.method || "GET").toUpperCase();
        const headers = { ...this._authHeaders(), ...(opts.headers || {}) };
        if (opts.body && !headers["Content-Type"])
            headers["Content-Type"] = "application/json";
        const timeout = opts.timeout ?? 10000;
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: opts.body,
                signal: AbortSignal.timeout(timeout),
            });
            return res;
        }
        catch (err) {
            return {
                ok: false,
                status: 0,
                json: async () => ({ error: err instanceof Error ? err.message : String(err), _status: 0 }),
            };
        }
    }
}
//# sourceMappingURL=client.js.map
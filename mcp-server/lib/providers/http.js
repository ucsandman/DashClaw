import { DashclawError } from "../util.js";
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_HTTP_RETRIES = 2;
function withQuery(url, query) {
    if (!query)
        return url;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "")
            params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}
export function redactSecrets(text) {
    return text
        .replace(/([?&](?=[^=&]*(?:token|secret|password|api_?key|access_token))[^=&]+=)[^&\s"]+/gi, "$1***REDACTED***")
        .replace(/("(?=[^"]*(?:token|secret|password|api_?key|access_token))([^"]+)"\s*:\s*")([^"]*)(")/gi, "$1***REDACTED***$4")
        .replace(/\b((?=[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_TOKEN))[A-Z0-9_]+)\s*[=:]\s*("?)[^\s",}]+\2/gi, "$1=***REDACTED***");
}
function readTimeoutMs(timeoutMs) {
    const raw = timeoutMs ?? process.env.DASHCLAW_HTTP_TIMEOUT_MS ?? DEFAULT_HTTP_TIMEOUT_MS;
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new DashclawError("DASHCLAW_HTTP_TIMEOUT_MS must be a positive integer number of milliseconds.");
    }
    return parsed;
}
function readRetries(method) {
    if (method !== "GET" && method !== "HEAD")
        return 0;
    const raw = process.env.DASHCLAW_HTTP_RETRIES ?? String(DEFAULT_HTTP_RETRIES);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new DashclawError("DASHCLAW_HTTP_RETRIES must be a non-negative integer.");
    }
    return parsed;
}
function shouldRetry(status) {
    return status === 429 || status >= 500;
}
function retryDelayMs(attempt) {
    const raw = process.env.DASHCLAW_HTTP_RETRY_BASE_MS ?? "25";
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new DashclawError("DASHCLAW_HTTP_RETRY_BASE_MS must be a non-negative integer number of milliseconds.");
    }
    return parsed * attempt;
}
function sleep(ms) {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Minimal JSON HTTP client built on global fetch (Node 18+). Centralizes error
 * handling so adapters surface clean, agent-readable messages. Never logs
 * secrets; the caller is responsible for not putting tokens in `query`.
 */
export async function httpJson(url, opts = {}) {
    const finalUrl = withQuery(url, opts.query);
    const timeoutMs = readTimeoutMs(opts.timeoutMs);
    const method = opts.method ?? "GET";
    const maxRetries = readRetries(method);
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await fetch(finalUrl, {
                method,
                headers: opts.headers,
                body: opts.body,
                signal: controller.signal,
            });
        }
        catch (err) {
            clearTimeout(timeout);
            const message = controller.signal.aborted
                ? `Timed out after ${timeoutMs}ms calling ${redactSecrets(finalUrl)}.`
                : `Network error calling ${redactSecrets(finalUrl)}: ${err instanceof Error ? err.message : String(err)}`;
            lastError = new DashclawError(message);
            if (attempt < maxRetries) {
                await sleep(retryDelayMs(attempt + 1));
                continue;
            }
            throw lastError;
        }
        clearTimeout(timeout);
        const text = await res.text();
        let parsed = undefined;
        if (text.length > 0) {
            try {
                parsed = JSON.parse(text);
            }
            catch {
                parsed = text;
            }
        }
        if (res.ok)
            return parsed;
        const detail = typeof parsed === "object" && parsed !== null
            ? JSON.stringify(parsed)
            : String(parsed ?? "");
        lastError = new DashclawError(`${res.status} ${res.statusText} from ${redactSecrets(url)}${detail ? `: ${redactSecrets(detail).slice(0, 500)}` : ""}`);
        if (attempt < maxRetries && shouldRetry(res.status)) {
            await sleep(retryDelayMs(attempt + 1));
            continue;
        }
        throw lastError;
    }
    throw lastError ?? new DashclawError(`Failed calling ${redactSecrets(finalUrl)}.`);
}
/** Encode an object as application/x-www-form-urlencoded, incl. bracketed nesting and indexed arrays. */
export function formEncode(obj, prefix) {
    const parts = [];
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null)
            continue;
        const field = prefix ? `${prefix}[${key}]` : key;
        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                const itemField = `${field}[${index}]`;
                if (typeof item === "object" && item !== null) {
                    const nested = formEncode(item, itemField);
                    if (nested)
                        parts.push(nested);
                }
                else {
                    parts.push(`${encodeURIComponent(itemField)}=${encodeURIComponent(String(item))}`);
                }
            });
        }
        else if (typeof value === "object") {
            const nested = formEncode(value, field);
            if (nested)
                parts.push(nested);
        }
        else {
            parts.push(`${encodeURIComponent(field)}=${encodeURIComponent(String(value))}`);
        }
    }
    return parts.join("&");
}
//# sourceMappingURL=http.js.map
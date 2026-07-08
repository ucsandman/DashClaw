import { DashclawError } from "../util.js";
const DEFAULT_DASHCLAW_TIMEOUT_MS = 30_000;
export function redactDashclawMessage(text, configOrApiKey) {
    let out = text.replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_TOKEN)[A-Z0-9_]*)\s*[=:]\s*("?)[^\s",}]+\2/gi, "$1=***REDACTED***");
    const secrets = typeof configOrApiKey === "string"
        ? [configOrApiKey]
        : [configOrApiKey?.apiKey, configOrApiKey?.authHeader];
    for (const secret of secrets) {
        if (secret)
            out = out.split(secret).join("***REDACTED***");
    }
    return out;
}
function readTimeout() {
    const raw = process.env.DASHCLAW_TIMEOUT_MS ?? process.env.DASHCLAW_HTTP_TIMEOUT_MS ?? String(DEFAULT_DASHCLAW_TIMEOUT_MS);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new DashclawError("DASHCLAW_TIMEOUT_MS must be a positive integer number of milliseconds.");
    }
    return parsed;
}
// Requests send x-api-key over whatever scheme DASHCLAW_URL has. Plaintext
// http to a non-local host exposes the key to the network path — warn once
// per process (don't refuse: LAN self-hosting over http is a supported setup).
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
let warnedInsecureUrl = false;
export function __resetInsecureUrlWarning() {
    warnedInsecureUrl = false;
}
function warnIfInsecureBaseUrl(baseUrl) {
    if (warnedInsecureUrl)
        return;
    try {
        const url = new URL(baseUrl);
        if (url.protocol === "http:" && !LOCAL_HOSTNAMES.has(url.hostname)) {
            warnedInsecureUrl = true;
            console.error(`[dashclaw-mcp] Warning: DASHCLAW_URL ${url.origin} uses plaintext http — your API key is sent unencrypted. Use https for non-local instances.`);
        }
    }
    catch {
        // Unparseable URL — the fetch itself will surface the real error.
    }
}
export function dashclawConfigFromEnv() {
    const baseUrl = process.env.DASHCLAW_URL?.trim();
    if (!baseUrl)
        throw new DashclawError("DASHCLAW_URL is required for DashClaw authoritative mode.");
    const apiKey = process.env.DASHCLAW_API_KEY?.trim();
    if (!apiKey)
        throw new DashclawError("DASHCLAW_API_KEY is required for DashClaw authoritative mode.");
    const mode = process.env.DASHCLAW_MODE ?? "authoritative";
    if (mode !== "authoritative") {
        throw new DashclawError('DASHCLAW_MODE must be "authoritative" for this version.');
    }
    warnIfInsecureBaseUrl(baseUrl);
    return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, timeoutMs: readTimeout(), mode };
}
function authHeaders(config) {
    return config.authHeader ? { Authorization: config.authHeader } : { "x-api-key": config.apiKey };
}
export async function dashclawRequest(path, opts = {}, config = dashclawConfigFromEnv()) {
    const url = new URL(path, `${config.baseUrl}/`);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
        if (value !== undefined && value !== null && value !== "")
            url.searchParams.set(key, String(value));
    }
    const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url.toString(), {
            method: opts.method ?? "GET",
            headers: {
                ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
                ...authHeaders(config),
                ...(opts.headers ?? {}),
            },
            body: opts.body === undefined
                ? undefined
                : (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)),
            signal: controller.signal,
        });
    }
    catch (err) {
        const message = controller.signal.aborted
            ? `Timed out after ${timeoutMs}ms calling DashClaw.`
            : `Network error calling DashClaw: ${err instanceof Error ? err.message : String(err)}`;
        throw new DashclawError(redactDashclawMessage(message, config));
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function dashclawFetch(path, opts = {}) {
    const config = dashclawConfigFromEnv();
    const response = await dashclawRequest(path, opts, config);
    const parsed = await parseDashclawResponseBody(response);
    if (!response.ok) {
        const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed ?? {});
        throw new DashclawError(redactDashclawMessage(`${response.status} ${response.statusText} from DashClaw: ${detail}`, config));
    }
    return parsed;
}
export async function parseDashclawResponseBody(response) {
    const text = await response.text();
    return text ? safeJson(text) : undefined;
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
//# sourceMappingURL=client.js.map
import { DashclawError } from "../util.js";
import type { DashclawConfig } from "./types.js";

const DEFAULT_DASHCLAW_TIMEOUT_MS = 30_000;

function redact(text: string, apiKey?: string): string {
  let out = text.replace(
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|ACCESS_TOKEN)[A-Z0-9_]*)\s*[=:]\s*("?)[^\s",}]+\2/gi,
    "$1=***REDACTED***",
  );
  if (apiKey) out = out.split(apiKey).join("***REDACTED***");
  return out;
}

function readTimeout(): number {
  const raw = process.env.DASHCLAW_TIMEOUT_MS ?? process.env.DASHCLAW_HTTP_TIMEOUT_MS ?? String(DEFAULT_DASHCLAW_TIMEOUT_MS);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new DashclawError("DASHCLAW_TIMEOUT_MS must be a positive integer number of milliseconds.");
  }
  return parsed;
}

export function dashclawConfigFromEnv(): DashclawConfig {
  const baseUrl = process.env.DASHCLAW_URL?.trim();
  if (!baseUrl) throw new DashclawError("DASHCLAW_URL is required for DashClaw authoritative mode.");
  const apiKey = process.env.DASHCLAW_API_KEY?.trim();
  if (!apiKey) throw new DashclawError("DASHCLAW_API_KEY is required for DashClaw authoritative mode.");
  const mode = process.env.DASHCLAW_MODE ?? "authoritative";
  if (mode !== "authoritative") {
    throw new DashclawError('DASHCLAW_MODE must be "authoritative" for this version.');
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, timeoutMs: readTimeout(), mode };
}

export async function dashclawFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const config = dashclawConfigFromEnv();
  const url = new URL(path, `${config.baseUrl}/`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const message = controller.signal.aborted
      ? `Timed out after ${config.timeoutMs}ms calling DashClaw.`
      : `Network error calling DashClaw: ${err instanceof Error ? err.message : String(err)}`;
    throw new DashclawError(redact(message, config.apiKey));
  }
  clearTimeout(timeout);

  const text = await response.text();
  const parsed = text ? safeJson(text) : undefined;
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed ?? {});
    throw new DashclawError(redact(`${response.status} ${response.statusText} from DashClaw: ${detail}`, config.apiKey));
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

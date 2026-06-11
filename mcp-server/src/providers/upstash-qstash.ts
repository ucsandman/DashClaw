import type { UpstashResource } from "../types.js";
import { httpJson } from "./http.js";

const DEFAULT_QSTASH_URL = "https://qstash.upstash.io";
const DEFAULT_QSTASH_TOKEN_ENV_VAR = "QSTASH_TOKEN";
const DEFAULT_QSTASH_CURRENT_SIGNING_KEY_ENV_VAR = "QSTASH_CURRENT_SIGNING_KEY";
const DEFAULT_QSTASH_NEXT_SIGNING_KEY_ENV_VAR = "QSTASH_NEXT_SIGNING_KEY";

function cleanUrl(value: string | undefined): string {
  return (value ?? DEFAULT_QSTASH_URL).trim().replace(/\/+$/, "") || DEFAULT_QSTASH_URL;
}

function headers(token: string, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const result: Record<string, string> = { Authorization: `Bearer ${token}` };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") result[key] = value;
  }
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface QstashSigningKeys {
  current: string;
  next: string;
}

export interface QstashAppEnv {
  url: string;
  credentialEnv: {
    tokenEnvVar: string;
    currentSigningKeyEnvVar: string;
    nextSigningKeyEnvVar: string;
  };
  env: {
    QSTASH_URL: string;
    QSTASH_TOKEN: string;
    QSTASH_CURRENT_SIGNING_KEY: string;
    QSTASH_NEXT_SIGNING_KEY: string;
  };
}

export function appEnv(resource: UpstashResource, token: string, signingKeys: QstashSigningKeys): QstashAppEnv {
  const url = cleanUrl(resource.qstashUrl);
  return {
    url,
    credentialEnv: {
      tokenEnvVar: resource.qstashTokenEnvVar ?? DEFAULT_QSTASH_TOKEN_ENV_VAR,
      currentSigningKeyEnvVar: resource.qstashCurrentSigningKeyEnvVar ?? DEFAULT_QSTASH_CURRENT_SIGNING_KEY_ENV_VAR,
      nextSigningKeyEnvVar: resource.qstashNextSigningKeyEnvVar ?? DEFAULT_QSTASH_NEXT_SIGNING_KEY_ENV_VAR,
    },
    env: {
      QSTASH_URL: url,
      QSTASH_TOKEN: token,
      QSTASH_CURRENT_SIGNING_KEY: signingKeys.current,
      QSTASH_NEXT_SIGNING_KEY: signingKeys.next,
    },
  };
}

export async function getSigningKeys(token: string, qstashUrl?: string): Promise<QstashSigningKeys> {
  const data = await httpJson<Record<string, any>>(`${cleanUrl(qstashUrl)}/v2/keys`, {
    headers: headers(token),
  });
  return {
    current: String(data.current),
    next: String(data.next),
  };
}

export interface QstashScheduleSummary {
  scheduleId: string;
  cron: string;
  destination: string;
  createdAt?: number;
  method?: string;
  isPaused?: boolean;
  retries?: number;
  nextScheduleTime?: number;
  lastScheduleTime?: number;
}

function mapSchedule(value: Record<string, any>): QstashScheduleSummary {
  return {
    scheduleId: String(value.scheduleId),
    cron: String(value.cron),
    destination: String(value.destination),
    createdAt: optionalNumber(value.createdAt),
    method: optionalString(value.method),
    isPaused: typeof value.isPaused === "boolean" ? value.isPaused : undefined,
    retries: optionalNumber(value.retries),
    nextScheduleTime: optionalNumber(value.nextScheduleTime),
    lastScheduleTime: optionalNumber(value.lastScheduleTime),
  };
}

export async function listSchedules(token: string, qstashUrl?: string): Promise<QstashScheduleSummary[]> {
  const data = await httpJson<unknown>(`${cleanUrl(qstashUrl)}/v2/schedules`, {
    headers: headers(token),
  });
  return Array.isArray(data) ? data.map((item) => mapSchedule(item as Record<string, any>)) : [];
}

export async function createSchedule(
  token: string,
  params: {
    qstashUrl?: string;
    destination: string;
    cron: string;
    scheduleId?: string;
    body?: string;
    contentType?: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    retries?: number;
  },
): Promise<{ scheduleId: string }> {
  const data = await httpJson<Record<string, any>>(
    `${cleanUrl(params.qstashUrl)}/v2/schedules/${encodeURIComponent(params.destination)}`,
    {
      method: "POST",
      headers: headers(token, {
        "Content-Type": params.contentType ?? "application/json",
        "Upstash-Cron": params.cron,
        "Upstash-Method": params.method,
        "Upstash-Retries": params.retries === undefined ? undefined : String(params.retries),
        "Upstash-Schedule-Id": params.scheduleId,
        "Upstash-Redact-Fields": "body, headers",
      }),
      body: params.body,
    },
  );
  return { scheduleId: String(data.scheduleId) };
}

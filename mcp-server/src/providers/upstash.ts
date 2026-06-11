import { stripTrailingSlashes } from "../util.js";
import { httpJson } from "./http.js";

const DEFAULT_API_HOST = "https://api.upstash.com";

function cleanHost(value: string | undefined): string {
  return stripTrailingSlashes((value ?? DEFAULT_API_HOST).trim()) || DEFAULT_API_HOST;
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function headers(email: string, apiKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${email}:${apiKey}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function restUrl(value: Record<string, any>): string | undefined {
  const explicit = value.rest_url ?? value.restUrl;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim().replace(/\/+$/, "");
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
  if (!endpoint) return undefined;
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) return endpoint.replace(/\/+$/, "");
  return `https://${endpoint.includes(".") ? endpoint : `${endpoint}.upstash.io`}`;
}

export interface UpstashRedisDatabase {
  id: string;
  name: string;
  endpoint?: string;
  restUrl?: string;
  region?: string;
  primaryRegion?: string;
  readRegions?: string[];
  state?: string;
  type?: string;
  port?: number;
  tls?: boolean;
  creationTime?: number;
  eviction?: boolean;
  budget?: number;
}

function mapDatabase(value: Record<string, any>): UpstashRedisDatabase {
  return {
    id: String(value.database_id ?? value.id),
    name: value.database_name ?? value.name,
    endpoint: value.endpoint,
    restUrl: restUrl(value),
    region: value.region,
    primaryRegion: value.primary_region,
    readRegions: stringArray(value.read_regions),
    state: value.state,
    type: value.type,
    port: typeof value.port === "number" ? value.port : undefined,
    tls: value.tls,
    creationTime: value.creation_time,
    eviction: value.eviction ?? value.db_eviction,
    budget: value.budget,
  };
}

export interface UpstashRedisEnv {
  databaseId: string;
  databaseName: string;
  env: {
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;
    UPSTASH_REDIS_READ_ONLY_REST_TOKEN?: string;
  };
}

export function redisEnv(value: Record<string, any>): UpstashRedisEnv {
  return {
    databaseId: String(value.database_id ?? value.id),
    databaseName: value.database_name ?? value.name,
    env: {
      UPSTASH_REDIS_REST_URL: restUrl(value),
      UPSTASH_REDIS_REST_TOKEN: value.rest_token ?? value.restToken,
      UPSTASH_REDIS_READ_ONLY_REST_TOKEN: value.read_only_rest_token ?? value.readOnlyRestToken,
    },
  };
}

export async function listRedisDatabases(
  email: string,
  apiKey: string,
  apiHost?: string,
): Promise<UpstashRedisDatabase[]> {
  const data = await httpJson<Record<string, any>[]>(`${cleanHost(apiHost)}/v2/redis/databases`, {
    headers: headers(email, apiKey),
  });
  return data.map(mapDatabase);
}

export async function getRedisDatabase(
  email: string,
  apiKey: string,
  databaseId: string,
  apiHost?: string,
): Promise<Record<string, any>> {
  return httpJson<Record<string, any>>(`${cleanHost(apiHost)}/v2/redis/database/${enc(databaseId)}`, {
    headers: headers(email, apiKey),
  });
}

export async function createRedisDatabase(
  email: string,
  apiKey: string,
  params: {
    apiHost?: string;
    databaseName: string;
    platform: "aws" | "gcp";
    primaryRegion: string;
    readRegions?: string[];
    plan?: string;
    budget?: number;
    eviction?: boolean;
    tls?: boolean;
  },
): Promise<Record<string, any>> {
  return httpJson<Record<string, any>>(`${cleanHost(params.apiHost)}/v2/redis/database`, {
    method: "POST",
    headers: headers(email, apiKey),
    body: JSON.stringify({
      database_name: params.databaseName,
      platform: params.platform,
      primary_region: params.primaryRegion,
      read_regions: params.readRegions,
      plan: params.plan,
      budget: params.budget,
      eviction: params.eviction,
      tls: params.tls,
    }),
  });
}

export function databaseSummary(value: Record<string, any>): UpstashRedisDatabase {
  return mapDatabase(value);
}

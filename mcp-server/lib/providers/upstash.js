import { stripTrailingSlashes } from "../util.js";
import { httpJson } from "./http.js";
const DEFAULT_API_HOST = "https://api.upstash.com";
function cleanHost(value) {
    return stripTrailingSlashes((value ?? DEFAULT_API_HOST).trim()) || DEFAULT_API_HOST;
}
function enc(value) {
    return encodeURIComponent(value);
}
function headers(email, apiKey) {
    return {
        Authorization: `Basic ${Buffer.from(`${email}:${apiKey}`).toString("base64")}`,
        "Content-Type": "application/json",
    };
}
function stringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.filter((item) => typeof item === "string");
}
function restUrl(value) {
    const explicit = value.rest_url ?? value.restUrl;
    if (typeof explicit === "string" && explicit.trim())
        return explicit.trim().replace(/\/+$/, "");
    const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
    if (!endpoint)
        return undefined;
    if (endpoint.startsWith("http://") || endpoint.startsWith("https://"))
        return endpoint.replace(/\/+$/, "");
    return `https://${endpoint.includes(".") ? endpoint : `${endpoint}.upstash.io`}`;
}
function mapDatabase(value) {
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
export function redisEnv(value) {
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
export async function listRedisDatabases(email, apiKey, apiHost) {
    const data = await httpJson(`${cleanHost(apiHost)}/v2/redis/databases`, {
        headers: headers(email, apiKey),
    });
    return data.map(mapDatabase);
}
export async function getRedisDatabase(email, apiKey, databaseId, apiHost) {
    return httpJson(`${cleanHost(apiHost)}/v2/redis/database/${enc(databaseId)}`, {
        headers: headers(email, apiKey),
    });
}
export async function createRedisDatabase(email, apiKey, params) {
    return httpJson(`${cleanHost(params.apiHost)}/v2/redis/database`, {
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
export function databaseSummary(value) {
    return mapDatabase(value);
}
//# sourceMappingURL=upstash.js.map
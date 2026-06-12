import { stripTrailingSlashes } from "../util.js";
import { httpJson } from "./http.js";
const DEFAULT_QSTASH_URL = "https://qstash.upstash.io";
const DEFAULT_QSTASH_TOKEN_ENV_VAR = "QSTASH_TOKEN";
const DEFAULT_QSTASH_CURRENT_SIGNING_KEY_ENV_VAR = "QSTASH_CURRENT_SIGNING_KEY";
const DEFAULT_QSTASH_NEXT_SIGNING_KEY_ENV_VAR = "QSTASH_NEXT_SIGNING_KEY";
function cleanUrl(value) {
    return stripTrailingSlashes((value ?? DEFAULT_QSTASH_URL).trim()) || DEFAULT_QSTASH_URL;
}
function headers(token, extra = {}) {
    const result = { Authorization: `Bearer ${token}` };
    for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined && value !== "")
            result[key] = value;
    }
    return result;
}
function optionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function optionalNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function appEnv(resource, token, signingKeys) {
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
export async function getSigningKeys(token, qstashUrl) {
    const data = await httpJson(`${cleanUrl(qstashUrl)}/v2/keys`, {
        headers: headers(token),
    });
    return {
        current: String(data.current),
        next: String(data.next),
    };
}
function mapSchedule(value) {
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
export async function listSchedules(token, qstashUrl) {
    const data = await httpJson(`${cleanUrl(qstashUrl)}/v2/schedules`, {
        headers: headers(token),
    });
    return Array.isArray(data) ? data.map((item) => mapSchedule(item)) : [];
}
export async function createSchedule(token, params) {
    const data = await httpJson(`${cleanUrl(params.qstashUrl)}/v2/schedules/${encodeURIComponent(params.destination)}`, {
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
    });
    return { scheduleId: String(data.scheduleId) };
}
//# sourceMappingURL=upstash-qstash.js.map
import { DashclawError, stripTrailingSlashes } from "../util.js";
import { httpJson } from "./http.js";
const DEFAULT_API_HOST = "https://api.cloudflare.com/client/v4";
const DEFAULT_ACCESS_KEY_ID_ENV_VAR = "R2_ACCESS_KEY_ID";
const DEFAULT_SECRET_ACCESS_KEY_ENV_VAR = "R2_SECRET_ACCESS_KEY";
function cleanHost(value) {
    return stripTrailingSlashes((value ?? DEFAULT_API_HOST).trim()) || DEFAULT_API_HOST;
}
function enc(value) {
    return encodeURIComponent(value);
}
function headers(apiToken, jurisdiction) {
    const result = {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
    };
    if (jurisdiction)
        result["cf-r2-jurisdiction"] = jurisdiction;
    return result;
}
function optionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function optionalNumber(value) {
    return typeof value === "number" ? value : undefined;
}
function asRecord(value) {
    return typeof value === "object" && value !== null ? value : {};
}
function cloudflareResult(value) {
    const wrapper = asRecord(value);
    if (wrapper.success === false) {
        const errors = Array.isArray(wrapper.errors) ? JSON.stringify(wrapper.errors) : "unknown error";
        throw new DashclawError(`Cloudflare R2 API returned an error: ${errors}`);
    }
    return asRecord(wrapper.result ?? wrapper);
}
function cloudflareResultInfo(value) {
    const wrapper = asRecord(value);
    return asRecord(wrapper.result_info);
}
function mapBucket(value) {
    return {
        name: String(value.name),
        createdAt: optionalString(value.creation_date ?? value.created_at),
        jurisdiction: optionalString(value.jurisdiction),
        location: optionalString(value.location),
        storageClass: optionalString(value.storage_class ?? value.storageClass),
    };
}
function mapObject(value) {
    return {
        key: String(value.key),
        size: optionalNumber(value.size),
        etag: optionalString(value.etag),
        uploadedAt: optionalString(value.uploaded ?? value.uploaded_at ?? value.last_modified),
        storageClass: optionalString(value.storage_class ?? value.storageClass),
    };
}
function endpointFor(accountId, jurisdiction) {
    const label = jurisdiction === "eu" || jurisdiction === "fedramp" ? `${jurisdiction}.` : "";
    return `https://${accountId}.${label}r2.cloudflarestorage.com`;
}
export function appEnv(resource, bucketName, credentials) {
    const accessKeyIdEnvVar = resource.accessKeyIdEnvVar ?? DEFAULT_ACCESS_KEY_ID_ENV_VAR;
    const secretAccessKeyEnvVar = resource.secretAccessKeyEnvVar ?? DEFAULT_SECRET_ACCESS_KEY_ENV_VAR;
    const endpoint = endpointFor(resource.accountId, resource.jurisdiction);
    return {
        bucketName,
        endpoint,
        credentialEnv: {
            accessKeyIdEnvVar,
            secretAccessKeyEnvVar,
        },
        env: {
            R2_ACCOUNT_ID: resource.accountId,
            R2_BUCKET_NAME: bucketName,
            R2_ENDPOINT: endpoint,
            R2_REGION: "auto",
            R2_PUBLIC_URL: resource.publicUrl,
            R2_ACCESS_KEY_ID: credentials?.accessKeyId,
            R2_SECRET_ACCESS_KEY: credentials?.secretAccessKey,
        },
    };
}
export async function listBuckets(apiToken, params) {
    const data = await httpJson(`${cleanHost(params.apiHost)}/accounts/${enc(params.accountId)}/r2/buckets`, {
        headers: headers(apiToken),
        query: {
            cursor: params.cursor,
            per_page: params.limit === undefined ? undefined : String(params.limit),
        },
    });
    const result = cloudflareResult(data);
    const info = cloudflareResultInfo(data);
    const buckets = Array.isArray(result.buckets) ? result.buckets.map((bucket) => mapBucket(asRecord(bucket))) : [];
    return {
        buckets,
        cursor: optionalString(info.cursor),
        perPage: optionalNumber(info.per_page ?? info.perPage),
    };
}
export async function createBucket(apiToken, params) {
    const data = await httpJson(`${cleanHost(params.apiHost)}/accounts/${enc(params.accountId)}/r2/buckets`, {
        method: "POST",
        headers: headers(apiToken, params.jurisdiction),
        body: JSON.stringify({
            name: params.name,
            locationHint: params.locationHint,
            storageClass: params.storageClass,
        }),
    });
    return mapBucket(cloudflareResult(data));
}
export async function listObjects(apiToken, params) {
    const data = await httpJson(`${cleanHost(params.apiHost)}/accounts/${enc(params.accountId)}/r2/buckets/${enc(params.bucketName)}/objects`, {
        headers: headers(apiToken, params.jurisdiction),
        query: {
            prefix: params.prefix,
            cursor: params.cursor,
            per_page: params.limit === undefined ? undefined : String(params.limit),
        },
    });
    const wrapper = asRecord(data);
    if (wrapper.success === false)
        cloudflareResult(data);
    const rawResult = wrapper.result ?? data;
    const result = asRecord(rawResult);
    const info = cloudflareResultInfo(data);
    const rawObjects = Array.isArray(rawResult) ? rawResult : result.objects;
    const objects = Array.isArray(rawObjects) ? rawObjects.map((object) => mapObject(asRecord(object))) : [];
    return {
        objects,
        cursor: optionalString(info.cursor),
        perPage: optionalNumber(info.per_page ?? info.perPage),
    };
}
//# sourceMappingURL=cloudflare-r2.js.map
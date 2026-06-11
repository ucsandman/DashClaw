import type { CloudflareR2Resource } from "../types.js";
import { DashclawError } from "../util.js";
import { httpJson } from "./http.js";

const DEFAULT_API_HOST = "https://api.cloudflare.com/client/v4";
const DEFAULT_ACCESS_KEY_ID_ENV_VAR = "R2_ACCESS_KEY_ID";
const DEFAULT_SECRET_ACCESS_KEY_ENV_VAR = "R2_SECRET_ACCESS_KEY";

function cleanHost(value: string | undefined): string {
  return (value ?? DEFAULT_API_HOST).trim().replace(/\/+$/, "") || DEFAULT_API_HOST;
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function headers(apiToken: string, jurisdiction?: CloudflareR2Resource["jurisdiction"]): Record<string, string> {
  const result: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
  if (jurisdiction) result["cf-r2-jurisdiction"] = jurisdiction;
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asRecord(value: unknown): Record<string, any> {
  return typeof value === "object" && value !== null ? (value as Record<string, any>) : {};
}

function cloudflareResult(value: unknown): Record<string, any> {
  const wrapper = asRecord(value);
  if (wrapper.success === false) {
    const errors = Array.isArray(wrapper.errors) ? JSON.stringify(wrapper.errors) : "unknown error";
    throw new DashclawError(`Cloudflare R2 API returned an error: ${errors}`);
  }
  return asRecord(wrapper.result ?? wrapper);
}

function cloudflareResultInfo(value: unknown): Record<string, any> {
  const wrapper = asRecord(value);
  return asRecord(wrapper.result_info);
}

export interface CloudflareR2Bucket {
  name: string;
  createdAt?: string;
  jurisdiction?: string;
  location?: string;
  storageClass?: string;
}

function mapBucket(value: Record<string, any>): CloudflareR2Bucket {
  return {
    name: String(value.name),
    createdAt: optionalString(value.creation_date ?? value.created_at),
    jurisdiction: optionalString(value.jurisdiction),
    location: optionalString(value.location),
    storageClass: optionalString(value.storage_class ?? value.storageClass),
  };
}

export interface CloudflareR2BucketList {
  buckets: CloudflareR2Bucket[];
  cursor?: string;
  perPage?: number;
}

export interface CloudflareR2ObjectSummary {
  key: string;
  size?: number;
  etag?: string;
  uploadedAt?: string;
  storageClass?: string;
}

function mapObject(value: Record<string, any>): CloudflareR2ObjectSummary {
  return {
    key: String(value.key),
    size: optionalNumber(value.size),
    etag: optionalString(value.etag),
    uploadedAt: optionalString(value.uploaded ?? value.uploaded_at ?? value.last_modified),
    storageClass: optionalString(value.storage_class ?? value.storageClass),
  };
}

export interface CloudflareR2ObjectList {
  objects: CloudflareR2ObjectSummary[];
  cursor?: string;
  perPage?: number;
}

export interface CloudflareR2AppEnv {
  bucketName: string;
  endpoint: string;
  credentialEnv: {
    accessKeyIdEnvVar: string;
    secretAccessKeyEnvVar: string;
  };
  env: {
    R2_ACCOUNT_ID: string;
    R2_BUCKET_NAME: string;
    R2_ENDPOINT: string;
    R2_REGION: "auto";
    R2_PUBLIC_URL?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
  };
}

function endpointFor(accountId: string, jurisdiction?: CloudflareR2Resource["jurisdiction"]): string {
  const label = jurisdiction === "eu" || jurisdiction === "fedramp" ? `${jurisdiction}.` : "";
  return `https://${accountId}.${label}r2.cloudflarestorage.com`;
}

export function appEnv(
  resource: CloudflareR2Resource,
  bucketName: string,
  credentials?: { accessKeyId?: string; secretAccessKey?: string },
): CloudflareR2AppEnv {
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

export async function listBuckets(
  apiToken: string,
  params: { accountId: string; apiHost?: string; cursor?: string; limit?: number },
): Promise<CloudflareR2BucketList> {
  const data = await httpJson<unknown>(`${cleanHost(params.apiHost)}/accounts/${enc(params.accountId)}/r2/buckets`, {
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

export async function createBucket(
  apiToken: string,
  params: {
    accountId: string;
    apiHost?: string;
    name: string;
    jurisdiction?: CloudflareR2Resource["jurisdiction"];
    locationHint?: string;
    storageClass?: string;
  },
): Promise<CloudflareR2Bucket> {
  const data = await httpJson<unknown>(`${cleanHost(params.apiHost)}/accounts/${enc(params.accountId)}/r2/buckets`, {
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

export async function listObjects(
  apiToken: string,
  params: {
    accountId: string;
    bucketName: string;
    apiHost?: string;
    jurisdiction?: CloudflareR2Resource["jurisdiction"];
    prefix?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<CloudflareR2ObjectList> {
  const data = await httpJson<unknown>(
    `${cleanHost(params.apiHost)}/accounts/${enc(params.accountId)}/r2/buckets/${enc(params.bucketName)}/objects`,
    {
      headers: headers(apiToken, params.jurisdiction),
      query: {
        prefix: params.prefix,
        cursor: params.cursor,
        per_page: params.limit === undefined ? undefined : String(params.limit),
      },
    },
  );
  const wrapper = asRecord(data);
  if (wrapper.success === false) cloudflareResult(data);
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

import type { CloudflareR2Resource } from "../types.js";
export interface CloudflareR2Bucket {
    name: string;
    createdAt?: string;
    jurisdiction?: string;
    location?: string;
    storageClass?: string;
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
export declare function appEnv(resource: CloudflareR2Resource, bucketName: string, credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
}): CloudflareR2AppEnv;
export declare function listBuckets(apiToken: string, params: {
    accountId: string;
    apiHost?: string;
    cursor?: string;
    limit?: number;
}): Promise<CloudflareR2BucketList>;
export declare function createBucket(apiToken: string, params: {
    accountId: string;
    apiHost?: string;
    name: string;
    jurisdiction?: CloudflareR2Resource["jurisdiction"];
    locationHint?: string;
    storageClass?: string;
}): Promise<CloudflareR2Bucket>;
export declare function listObjects(apiToken: string, params: {
    accountId: string;
    bucketName: string;
    apiHost?: string;
    jurisdiction?: CloudflareR2Resource["jurisdiction"];
    prefix?: string;
    cursor?: string;
    limit?: number;
}): Promise<CloudflareR2ObjectList>;

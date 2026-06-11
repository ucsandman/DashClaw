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
export interface UpstashRedisEnv {
    databaseId: string;
    databaseName: string;
    env: {
        UPSTASH_REDIS_REST_URL?: string;
        UPSTASH_REDIS_REST_TOKEN?: string;
        UPSTASH_REDIS_READ_ONLY_REST_TOKEN?: string;
    };
}
export declare function redisEnv(value: Record<string, any>): UpstashRedisEnv;
export declare function listRedisDatabases(email: string, apiKey: string, apiHost?: string): Promise<UpstashRedisDatabase[]>;
export declare function getRedisDatabase(email: string, apiKey: string, databaseId: string, apiHost?: string): Promise<Record<string, any>>;
export declare function createRedisDatabase(email: string, apiKey: string, params: {
    apiHost?: string;
    databaseName: string;
    platform: "aws" | "gcp";
    primaryRegion: string;
    readRegions?: string[];
    plan?: string;
    budget?: number;
    eviction?: boolean;
    tls?: boolean;
}): Promise<Record<string, any>>;
export declare function databaseSummary(value: Record<string, any>): UpstashRedisDatabase;

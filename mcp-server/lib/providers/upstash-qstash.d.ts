import type { UpstashResource } from "../types.js";
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
export declare function appEnv(resource: UpstashResource, token: string, signingKeys: QstashSigningKeys): QstashAppEnv;
export declare function getSigningKeys(token: string, qstashUrl?: string): Promise<QstashSigningKeys>;
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
export declare function listSchedules(token: string, qstashUrl?: string): Promise<QstashScheduleSummary[]>;
export declare function createSchedule(token: string, params: {
    qstashUrl?: string;
    destination: string;
    cron: string;
    scheduleId?: string;
    body?: string;
    contentType?: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    retries?: number;
}): Promise<{
    scheduleId: string;
}>;

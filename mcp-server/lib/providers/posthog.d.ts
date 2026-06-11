export declare function resolveHosts(apiHost?: string, ingestHost?: string): {
    apiHost: string;
    ingestHost: string;
};
export interface PostHogProject {
    id: string;
    uuid?: string;
    organizationId?: string;
    name: string;
    projectToken?: string;
    productDescription?: string | null;
    timezone?: string;
    appUrls?: string[];
    createdAt?: string;
    updatedAt?: string;
    ingestedEvent?: boolean;
    isDemo?: boolean;
    accessControl?: boolean;
}
export interface PostHogProjectEnv {
    projectId: string;
    projectName: string;
    env: {
        POSTHOG_PROJECT_ID: string;
        NEXT_PUBLIC_POSTHOG_KEY?: string;
        NEXT_PUBLIC_POSTHOG_HOST: string;
    };
}
export declare function projectEnv(project: PostHogProject, ingestHost: string): PostHogProjectEnv;
export declare function listProjects(personalApiKey: string, organizationId: string, params?: {
    apiHost?: string;
    ingestHost?: string;
    limit?: number;
    search?: string;
}): Promise<PostHogProject[]>;
export declare function getProject(personalApiKey: string, organizationId: string, projectId: string, params?: {
    apiHost?: string;
    ingestHost?: string;
}): Promise<PostHogProject>;
export declare function createProject(personalApiKey: string, organizationId: string, params: {
    apiHost?: string;
    ingestHost?: string;
    name: string;
    productDescription?: string;
    appUrls?: string[];
    timezone?: string;
    sessionRecording?: boolean;
}): Promise<PostHogProject>;
export interface PostHogFeatureFlag {
    id: string;
    key: string;
    name?: string;
    active?: boolean;
    deleted?: boolean;
    filters?: unknown;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
    status?: string;
    evaluationRuntime?: string;
    isRemoteConfiguration?: boolean;
}
export declare function listFeatureFlags(personalApiKey: string, projectId: string, params?: {
    apiHost?: string;
    ingestHost?: string;
    limit?: number;
    search?: string;
    active?: "STALE" | "false" | "true";
    type?: "boolean" | "experiment" | "multivariant" | "remote_config";
}): Promise<PostHogFeatureFlag[]>;
export declare function createFeatureFlag(personalApiKey: string, projectId: string, params: {
    apiHost?: string;
    ingestHost?: string;
    key: string;
    name?: string;
    active?: boolean;
    filters?: Record<string, unknown>;
    tags?: string[];
    isRemoteConfiguration?: boolean;
}): Promise<PostHogFeatureFlag>;

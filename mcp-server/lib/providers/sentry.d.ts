export interface SentryProject {
    id: string;
    slug: string;
    name: string;
    platform?: string;
    teamSlug?: string;
    dateCreated?: string;
}
export declare function listProjects(authToken: string, organizationSlug: string, limit?: number, query?: string): Promise<SentryProject[]>;
export declare function createProject(authToken: string, organizationSlug: string, params: {
    name: string;
    slug?: string;
    platform?: string;
    defaultRules?: boolean;
    teamSlug?: string;
}): Promise<SentryProject>;
export interface SentryClientKey {
    id: string;
    name?: string;
    label?: string;
    publicKey?: string;
    projectId?: string | number;
    isActive?: boolean;
    publicDsn?: string;
    cspDsn?: string;
    rateLimit?: unknown;
}
export declare function listClientKeys(authToken: string, organizationSlug: string, projectSlug: string, status?: "active" | "inactive"): Promise<SentryClientKey[]>;
export declare function createClientKey(authToken: string, organizationSlug: string, projectSlug: string, params: {
    name?: string;
    useCase?: string;
    rateLimit?: {
        window: number;
        count: number;
    };
}): Promise<SentryClientKey>;
export interface SentryRelease {
    id: string;
    version: string;
    shortVersion?: string;
    ref?: string | null;
    url?: string | null;
    dateCreated?: string;
    dateReleased?: string | null;
    deployCount?: number;
    projectSlugs: string[];
}
export declare function listReleases(authToken: string, organizationSlug: string, query?: string): Promise<SentryRelease[]>;
export declare function createRelease(authToken: string, organizationSlug: string, params: {
    version: string;
    projects: string[];
    ref?: string;
    url?: string;
    dateReleased?: string;
}): Promise<SentryRelease>;
export interface SentryDeploy {
    id: string;
    environment: string;
    name?: string;
    url?: string;
    dateStarted?: string;
    dateFinished?: string;
}
export declare function listDeploys(authToken: string, organizationSlug: string, version: string): Promise<SentryDeploy[]>;
export declare function createDeploy(authToken: string, organizationSlug: string, version: string, params: {
    environment: string;
    name?: string;
    url?: string;
    dateStarted?: string;
    dateFinished?: string;
    projects?: string[];
}): Promise<SentryDeploy>;

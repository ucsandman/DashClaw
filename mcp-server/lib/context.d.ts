import type { Store } from "./storage.js";
import type { Project } from "./types.js";
interface VercelSnapshot {
    vercelProject: string;
    latest: {
        state: string;
        url?: string;
        createdAt?: number;
        errorMessage?: string;
    } | null;
    liveDataError?: string;
}
export interface EnvironmentContext {
    environment: string;
    kind: string;
    isProduction: boolean;
    source: {
        githubRepo?: string;
    };
    deployment: {
        vercelProject?: string;
        latest: VercelSnapshot["latest"];
        lastKnownIssue?: string;
        liveDataError?: string;
    };
    railway?: {
        projectId: string;
        environmentId?: string;
        serviceId?: string;
    };
    database: {
        supabaseProjectRef?: string;
        writes: string;
    };
    payments: {
        stripeMode?: string;
        testWrites: string;
        liveWrites: string;
    };
    allowed: string[];
    blocked: string[];
    approvalRequired: string[];
    memory: Array<{
        note: string;
        tags?: string[];
        createdAt: string;
    }>;
    suggestedNextActions: string[];
    summary: string;
}
export interface ProjectContext {
    project: {
        id: string;
        slug: string;
        name: string;
        description?: string;
    };
    focusedEnvironment?: string;
    environments: EnvironmentContext[];
    projectMemory: Array<{
        note: string;
        tags?: string[];
        createdAt: string;
    }>;
    recentAudit: Array<Record<string, unknown>>;
    policyDefaults: string[];
    summary: string;
    notes: string;
}
export declare function buildProjectContext(store: Store, project: Project, envRef?: string): Promise<ProjectContext>;
export {};

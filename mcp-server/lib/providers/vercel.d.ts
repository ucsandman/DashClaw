export interface VercelProjectContext {
    id: string;
    name: string;
    framework: string | null;
    latestDeployments?: number;
    createdAt?: number;
}
export declare function getProjectContext(token: string, idOrName: string, teamId?: string): Promise<VercelProjectContext>;
export interface VercelDeployment {
    uid: string;
    name: string;
    url: string;
    state: string;
    readyState: string;
    target: string | null;
    createdAt: number;
}
export declare function listDeployments(token: string, projectId: string, teamId?: string, limit?: number): Promise<VercelDeployment[]>;
export declare function getDeploymentStatus(token: string, idOrUrl: string, teamId?: string): Promise<Record<string, unknown>>;
export interface VercelLogEvent {
    type: string;
    created: number;
    text?: string;
}
export declare function getDeploymentLogs(token: string, idOrUrl: string, teamId?: string, limit?: number, since?: number): Promise<VercelLogEvent[]>;
export declare function setEnvVar(token: string, projectId: string, params: {
    key: string;
    value: string;
    target: string[];
    type?: string;
}, teamId?: string): Promise<Record<string, unknown>>;
export interface VercelCreatedProject {
    id: string;
    name: string;
    framework: string | null;
    createdAt?: number;
}
export declare function createProject(token: string, params: {
    name: string;
    framework?: string;
}, teamId?: string): Promise<VercelCreatedProject>;
export interface VercelDnsTarget {
    type: "A" | "CNAME";
    /** Host record name to set at the registrar, e.g. "@" or "www". */
    host: string;
    value: string;
}
export interface VercelProjectDomain {
    name: string;
    apexName: string;
    projectId: string;
    verified: boolean;
    verification?: Array<{
        type: string;
        domain: string;
        value: string;
        reason?: string;
    }>;
    /** The DNS record to create at the registrar so the domain points at Vercel. */
    dnsTarget: VercelDnsTarget;
}
export declare function addProjectDomain(token: string, projectIdOrName: string, domain: string, teamId?: string): Promise<VercelProjectDomain>;
export declare function createDeployment(token: string, params: {
    name: string;
    project: string;
    target?: string;
    deploymentId?: string;
    gitSource?: {
        type: "github";
        repoId: string;
        ref?: string;
        sha?: string;
    };
}, teamId?: string): Promise<Record<string, unknown>>;

export interface RailwayProject {
    id: string;
    name: string;
    environments: Array<{
        id: string;
        name: string;
    }>;
    services: Array<{
        id: string;
        name: string;
    }>;
}
export declare function listProjects(token: string): Promise<RailwayProject[]>;
export declare function getProject(token: string, projectId: string): Promise<RailwayProject>;
export interface RailwayDeployment {
    id: string;
    status: string;
    url?: string;
    staticUrl?: string;
    createdAt?: string;
}
export interface DeploymentScope {
    projectId: string;
    environmentId?: string;
    serviceId?: string;
}
export declare function listDeployments(token: string, scope: DeploymentScope, first?: number): Promise<RailwayDeployment[]>;
export interface RailwayLog {
    timestamp?: string;
    message?: string;
    severity?: string;
}
export declare function getDeploymentLogs(token: string, deploymentId: string, limit?: number, startDate?: string): Promise<RailwayLog[]>;
export interface TriggerDeployScope {
    projectId: string;
    environmentId: string;
    serviceId: string;
}
/** Trigger a fresh deployment of a service in an environment. Returns its id. */
export declare function triggerDeploy(token: string, scope: TriggerDeployScope): Promise<{
    deploymentId: string;
}>;
/** Redeploy an existing deployment by id. */
export declare function redeploy(token: string, deploymentId: string): Promise<{
    id: string;
    status: string;
}>;
export interface VariableUpsertInput {
    projectId: string;
    environmentId: string;
    serviceId?: string;
    name: string;
    value: string;
    /** Railway redeploys affected services on change unless this is true. */
    skipDeploys?: boolean;
}
/** Create or update a variable. Railway triggers a redeploy unless skipDeploys. */
export declare function upsertVariable(token: string, input: VariableUpsertInput): Promise<boolean>;

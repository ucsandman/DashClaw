export interface NeonProject {
    id: string;
    name: string;
    regionId?: string;
    pgVersion?: number;
    createdAt?: string;
}
export declare function listProjects(token: string): Promise<NeonProject[]>;
export interface NeonCreatedProject {
    project: NeonProject;
    branchId?: string;
    /** Connection URI for the default branch/database/role. Contains credentials. */
    connectionUri?: string;
}
export declare function createProject(token: string, params?: {
    name?: string;
    regionId?: string;
    pgVersion?: number;
    orgId?: string;
}): Promise<NeonCreatedProject>;
export declare function getConnectionUri(token: string, params: {
    projectId: string;
    databaseName: string;
    roleName: string;
    branchId?: string;
    pooled?: boolean;
}): Promise<{
    connectionUri: string;
}>;

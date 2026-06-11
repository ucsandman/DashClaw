export interface SupabaseProject {
    id: string;
    ref?: string;
    name: string;
    region?: string;
    status?: string;
    organizationId?: string;
}
export declare function listProjects(token: string): Promise<SupabaseProject[]>;
export declare function getProject(token: string, ref: string): Promise<SupabaseProject>;
/**
 * Run SQL against a project. `readOnly` is passed through to the backend.
 * Returns the result rows (shape depends on the query).
 */
export declare function runQuery(token: string, ref: string, query: string, readOnly: boolean): Promise<unknown>;
export interface SupabaseLogEntry {
    timestamp?: string;
    level?: string;
    message?: string;
    service?: string;
}
export declare function getProjectLogs(token: string, ref: string, params?: {
    service?: string;
    since?: string;
    limit?: number;
}): Promise<SupabaseLogEntry[]>;
export declare function applyMigration(token: string, ref: string, params: {
    name: string;
    query: string;
}): Promise<unknown>;

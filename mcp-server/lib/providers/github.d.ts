export interface GithubRepoContext {
    fullName: string;
    description: string | null;
    defaultBranch: string;
    private: boolean;
    pushedAt: string;
    language: string | null;
    openIssues: number;
    topics?: string[];
    htmlUrl: string;
}
export declare function getRepoContext(token: string, owner: string, repo: string): Promise<GithubRepoContext>;
export declare function getReadme(token: string, owner: string, repo: string): Promise<{
    path: string;
    content: string;
}>;
export interface GithubFileEntry {
    name: string;
    path: string;
    type: string;
    size: number;
}
export declare function listFiles(token: string, owner: string, repo: string, path?: string): Promise<GithubFileEntry[]>;
export interface GithubPullRequest {
    number: number;
    title: string;
    state: string;
    draft: boolean;
    headRef: string;
    baseRef: string;
    htmlUrl: string;
    updatedAt: string;
}
export declare function listPullRequests(token: string, owner: string, repo: string, opts?: {
    state?: "open" | "closed" | "all";
    limit?: number;
}): Promise<GithubPullRequest[]>;
export interface GithubBranch {
    name: string;
    protected: boolean;
    sha?: string;
}
export declare function listBranches(token: string, owner: string, repo: string, limit?: number): Promise<GithubBranch[]>;
export interface GithubCombinedStatus {
    state: string;
    totalCount: number;
    statuses: Array<{
        context: string;
        state: string;
        targetUrl?: string;
        description?: string;
    }>;
    sha?: string;
}
export declare function getCombinedStatus(token: string, owner: string, repo: string, ref: string): Promise<GithubCombinedStatus>;
export interface GithubWorkflowRun {
    id: number;
    name?: string;
    title?: string;
    status: string;
    conclusion?: string;
    event?: string;
    headBranch?: string;
    headSha?: string;
    runAttempt?: number;
    createdAt?: string;
    updatedAt?: string;
    htmlUrl?: string;
    workflowId?: number;
}
export interface GithubWorkflowRunList {
    totalCount: number;
    workflowRuns: GithubWorkflowRun[];
}
export declare function listWorkflowRuns(token: string, owner: string, repo: string, opts?: {
    branch?: string;
    event?: string;
    status?: string;
    limit?: number;
}): Promise<GithubWorkflowRunList>;
export interface GithubWorkflowJobStep {
    name: string;
    status?: string;
    conclusion?: string;
    number?: number;
    startedAt?: string;
    completedAt?: string;
}
export interface GithubWorkflowJob {
    id: number;
    runId?: number;
    name: string;
    status: string;
    conclusion?: string;
    startedAt?: string;
    completedAt?: string;
    htmlUrl?: string;
    steps?: GithubWorkflowJobStep[];
}
export interface GithubWorkflowJobList {
    totalCount: number;
    jobs: GithubWorkflowJob[];
}
export declare function listWorkflowJobs(token: string, owner: string, repo: string, runId: number, opts?: {
    filter?: "latest" | "all";
    limit?: number;
}): Promise<GithubWorkflowJobList>;
export declare function rerunWorkflowRun(token: string, owner: string, repo: string, runId: number): Promise<{
    runId: number;
    rerun: true;
}>;
export declare function cancelWorkflowRun(token: string, owner: string, repo: string, runId: number): Promise<{
    runId: number;
    canceled: true;
}>;

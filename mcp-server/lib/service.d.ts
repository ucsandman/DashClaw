import type { Store } from "./storage.js";
import { type ProjectContext } from "./context.js";
import type { AuditLogEntry, Capability, Environment, EnvironmentKind, PolicyEffect, PendingApproval, PolicyRule, Project, ProviderConnection, ProviderId, ProviderResource, Workspace } from "./types.js";
/**
 * Service layer: all business logic lives here as plain functions over a Store.
 * The MCP server (src/tools) and the CLI (src/cli.ts) are thin wrappers around
 * these — so everything is unit-testable without a transport.
 */
export declare function ensureDefaultWorkspace(store: Store): Workspace;
export declare function createProject(store: Store, input: {
    name: string;
    slug?: string;
    description?: string;
}): Project;
export declare function listProjects(store: Store): Array<Project & {
    selected: boolean;
}>;
export declare function selectProject(store: Store, projectRef: string): Project;
export declare function addEnvironment(store: Store, input: {
    project?: string;
    name: string;
    kind?: EnvironmentKind;
}): Environment;
export declare function listEnvironments(store: Store, projectRef?: string): Environment[];
export declare function getProjectContext(store: Store, projectRef?: string, environment?: string): Promise<ProjectContext>;
export declare function ensureConnection(store: Store, provider: ProviderId, opts?: {
    label?: string;
    envVar?: string;
    vercelTeamId?: string;
}): string;
export declare function createConnection(store: Store, input: {
    provider: ProviderId;
    label: string;
    envVar: string;
    vercelTeamId?: string;
}): ProviderConnection;
export declare function listConnections(store: Store, input?: {
    provider?: ProviderId;
}): ProviderConnection[];
export declare function mapProviderResource(store: Store, input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    resource: ProviderResource;
    connectionId?: string;
}): {
    project: Project;
    environment: Environment;
    mappingId: string;
};
export declare function listProviderMappings(store: Store, projectRef?: string): {
    id: string;
    environment: string;
    provider: ProviderId;
    connectionId: string | undefined;
    resource: ProviderResource;
}[];
export declare function getProviderMapping(store: Store, input: {
    project?: string;
    environment: string;
    provider: ProviderId;
}): {
    id: string;
    project: string;
    environment: string;
    provider: ProviderId;
    connectionId: string | undefined;
    resource: ProviderResource;
};
export declare function checkPolicy(store: Store, input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    live?: boolean;
}): {
    project: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    effect: PolicyEffect;
    reason: string;
    source: string;
};
export declare function simulateAction(store: Store, input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    live?: boolean;
    resourceLabel?: string;
}): {
    project: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    live: boolean;
    resourceLabel: string | undefined;
    effect: PolicyEffect;
    reason: string;
    source: string;
    wouldExecute: boolean;
};
export declare function listPolicyRules(store: Store): PolicyRule[];
export declare function setPolicyRule(store: Store, input: {
    effect: PolicyEffect;
    description?: string;
    priority?: number;
    match: PolicyRule["match"];
}): PolicyRule;
export declare function listPendingApprovals(store: Store, input?: {
    project?: string;
    status?: PendingApproval["status"];
}): PendingApproval[];
export declare function approveAction(store: Store, input: {
    approvalId: string;
    note?: string;
}): {
    approval: PendingApproval;
};
export declare function rejectAction(store: Store, input: {
    approvalId: string;
    note?: string;
}): {
    approval: PendingApproval;
};
export declare function writeProjectMemory(store: Store, input: {
    project?: string;
    environment?: string;
    note: string;
    tags?: string[];
}): {
    id: string;
    projectId: string;
    environmentId: string | undefined;
    note: string;
    tags: string[] | undefined;
    createdAt: string;
};
export declare function readProjectMemory(store: Store, input: {
    project?: string;
    environment?: string;
}): import("./types.js").ProjectMemory[];
export declare function listAuditLog(store: Store, input?: {
    project?: string;
    environment?: string;
    provider?: ProviderId;
    limit?: number;
}): AuditLogEntry[];
type DoctorStatus = "pass" | "warn" | "fail";
export interface DoctorCheck {
    id: string;
    status: DoctorStatus;
    message: string;
    details?: Record<string, unknown>;
}
export interface DoctorReport {
    status: DoctorStatus;
    summary: {
        pass: number;
        warn: number;
        fail: number;
        total: number;
    };
    checks: DoctorCheck[];
}
/** A single check item returned by the platform /api/doctor endpoint, with all fix metadata stripped. */
export interface PlatformDoctorCheck {
    id: string;
    category: string;
    status: string;
    title: string;
    message: string;
}
export type PlatformSection = {
    available: true;
    status: string;
    summary: Record<string, unknown>;
    checks: PlatformDoctorCheck[];
} | {
    available: false;
    reason: string;
};
/**
 * Fetch the platform's own doctor report from GET {DASHCLAW_URL}/api/doctor.
 * Returns null when DASHCLAW_URL or DASHCLAW_API_KEY are not configured.
 * On success (200 or 503 with a parseable doctor body) returns available:true
 * with fix metadata stripped from each check. On any other failure returns
 * available:false with a short reason that never contains the API key value.
 */
export declare function platformDoctor(): Promise<PlatformSection | null>;
export declare function doctor(store: Store, input?: {
    project?: string;
    environment?: string;
}): DoctorReport;
export declare function dashclawStatus(): Promise<import("./dashclaw/types.js").DashclawStatusReport>;
export declare function exportDashclawEvidence(store: Store, input?: {
    project?: string;
    environment?: string;
    provider?: ProviderId;
    limit?: number;
}): {
    schema: string;
    exportedAt: string;
    entries: AuditLogEntry[];
};
export declare function dashclawRecentDecisions(store: Store, input?: {
    project?: string;
    environment?: string;
    limit?: number;
}): Promise<unknown>;
export declare function explainActionRisk(store: Store, input: {
    project?: string;
    environment: string;
    provider: ProviderId;
    capability: Capability;
    tool: string;
    summary: string;
    resourceLabel?: string;
    live?: boolean;
}): Promise<{
    risky: boolean;
    localPolicy: import("./types.js").PolicyDecision;
    dashclawPayload: import("./dashclaw/types.js").DashclawGuardPayload;
    dashclaw: unknown;
}>;
export declare function governedActionSummary(store: Store, input?: {
    project?: string;
    environment?: string;
    provider?: ProviderId;
    limit?: number;
}): {
    project: string | undefined;
    environment: string | undefined;
    provider: ProviderId | undefined;
    entries: {
        timestamp: string;
        tool: string;
        result: import("./types.js").AuditResult;
        policyDecision: PolicyEffect | "n/a";
        dashclawDecisionId: string | undefined;
        dashclawActionId: string | undefined;
        dashclawOutcomeRecorded: boolean | undefined;
        dashclawError: string | undefined;
    }[];
};
export declare function exportAuditLog(store: Store, input: {
    project?: string;
    environment?: string;
    provider?: ProviderId;
    limit?: number;
    format: "jsonl" | "csv" | "markdown";
}): string;
export declare function exportContextSnapshot(store: Store, input: {
    project?: string;
    environment?: string;
    format: "json" | "markdown";
}): Promise<string>;
export {};

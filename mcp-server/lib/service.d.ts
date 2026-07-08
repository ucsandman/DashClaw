import type { Store } from "./storage.js";
import type { ProviderId, Workspace } from "./types.js";
/**
 * Service layer for the DashClaw-gated stdio tools. The MCP server (src/tools)
 * is a thin wrapper around these plain functions over a Store — so everything
 * is unit-testable without a transport.
 *
 * The absorbed provider-execution fork (providers, launch plans, local
 * scaffolding, and the duplicate local governance store) was removed in the v5
 * cull; what remains is the local-state bootstrap plus the DashClaw
 * evidence/status reads that back dashclaw_status / export_dashclaw_evidence.
 */
export declare function ensureDefaultWorkspace(store: Store): Workspace;
export declare function listAuditLog(store: Store, input?: {
    project?: string;
    environment?: string;
    provider?: ProviderId;
    limit?: number;
}): import("./types.js").AuditLogEntry[];
export declare function dashclawStatus(): Promise<import("./dashclaw/types.js").DashclawStatusReport>;
export declare function exportDashclawEvidence(store: Store, input?: {
    project?: string;
    environment?: string;
    provider?: ProviderId;
    limit?: number;
}): {
    schema: string;
    exportedAt: string;
    entries: import("./types.js").AuditLogEntry[];
};

import { dashclawRecentDecisionsFetch, dashclawStatusReport } from "./dashclaw/evidence.js";
import { resolveProject } from "./resolve.js";
import { PROVIDER_IDS } from "./types.js";
import { newId, nowIso, DashclawError } from "./util.js";
/**
 * Service layer for the DashClaw-gated stdio tools. The MCP server (src/tools)
 * is a thin wrapper around these plain functions over a Store — so everything
 * is unit-testable without a transport.
 *
 * The absorbed provider-execution fork (providers, launch plans, local
 * scaffolding, and the duplicate local governance store) was removed in the v5
 * cull; what remains is the local-state bootstrap plus the three DashClaw
 * evidence/status reads that back dashclaw_status / dashclaw_recent_decisions /
 * export_dashclaw_evidence.
 */
export function ensureDefaultWorkspace(store) {
    const existing = store.data.workspaces.find((w) => w.id === store.data.defaultWorkspaceId)
        ?? store.data.workspaces[0];
    if (existing) {
        if (!store.data.defaultWorkspaceId) {
            store.update((s) => {
                s.defaultWorkspaceId = existing.id;
            });
        }
        return existing;
    }
    const ws = { id: newId("ws"), name: "default", createdAt: nowIso() };
    store.update((s) => {
        s.workspaces.push(ws);
        s.defaultWorkspaceId = ws.id;
    });
    return ws;
}
function assertProviderId(provider) {
    if (typeof provider !== "string" || !PROVIDER_IDS.includes(provider)) {
        throw new DashclawError(`Unknown provider "${String(provider)}". Expected one of: ${PROVIDER_IDS.join(", ")}.`);
    }
}
function assertPositiveInteger(value, label) {
    if (value === undefined)
        return;
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new DashclawError(`${label} must be a positive integer.`);
    }
}
export function listAuditLog(store, input = {}) {
    assertPositiveInteger(input.limit, "limit");
    if (input.provider !== undefined)
        assertProviderId(input.provider);
    let projectSlug;
    if (input.project)
        projectSlug = resolveProject(store, input.project).slug;
    return store.readAudit(input.limit ?? 50, {
        projectSlug,
        environment: input.environment,
        provider: input.provider,
    });
}
export function dashclawStatus() {
    return dashclawStatusReport();
}
export function exportDashclawEvidence(store, input = {}) {
    const entries = listAuditLog(store, input).filter((entry) => entry.dashclawDecisionId || entry.dashclawActionId || entry.dashclawError);
    return {
        schema: "dashclaw.evidence.v1",
        exportedAt: nowIso(),
        entries,
    };
}
export async function dashclawRecentDecisions(store, input = {}) {
    assertPositiveInteger(input.limit, "limit");
    const project = input.project ? resolveProject(store, input.project).slug : undefined;
    return dashclawRecentDecisionsFetch({
        project,
        environment: input.environment,
        limit: input.limit ?? 20,
    });
}
//# sourceMappingURL=service.js.map
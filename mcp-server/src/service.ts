import type { Store } from "./storage.js";
import { dashclawStatusReport } from "./dashclaw/evidence.js";
import { resolveProject } from "./resolve.js";
import type { ProviderId, Workspace } from "./types.js";
import { PROVIDER_IDS } from "./types.js";
import { newId, nowIso, DashclawError } from "./util.js";

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

export function ensureDefaultWorkspace(store: Store): Workspace {
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
  const ws: Workspace = { id: newId("ws"), name: "default", createdAt: nowIso() };
  store.update((s) => {
    s.workspaces.push(ws);
    s.defaultWorkspaceId = ws.id;
  });
  return ws;
}

function assertProviderId(provider: unknown): asserts provider is ProviderId {
  if (typeof provider !== "string" || !PROVIDER_IDS.includes(provider as ProviderId)) {
    throw new DashclawError(`Unknown provider "${String(provider)}". Expected one of: ${PROVIDER_IDS.join(", ")}.`);
  }
}

function assertPositiveInteger(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DashclawError(`${label} must be a positive integer.`);
  }
}

export function listAuditLog(
  store: Store,
  input: { project?: string; environment?: string; provider?: ProviderId; limit?: number } = {},
) {
  assertPositiveInteger(input.limit, "limit");
  if (input.provider !== undefined) assertProviderId(input.provider);
  let projectSlug: string | undefined;
  if (input.project) projectSlug = resolveProject(store, input.project).slug;
  return store.readAudit(input.limit ?? 50, {
    projectSlug,
    environment: input.environment,
    provider: input.provider,
  });
}

export function dashclawStatus() {
  return dashclawStatusReport();
}

export function exportDashclawEvidence(
  store: Store,
  input: { project?: string; environment?: string; provider?: ProviderId; limit?: number } = {},
) {
  const entries = listAuditLog(store, input).filter(
    (entry) => entry.dashclawDecisionId || entry.dashclawActionId || entry.dashclawError,
  );
  return {
    schema: "dashclaw.evidence.v1",
    exportedAt: nowIso(),
    entries,
  };
}

import { httpJson } from "./http.js";
/**
 * Neon API adapter.
 * Base: https://console.neon.tech/api/v2 — auth: Bearer API key (NEON_API_KEY).
 *
 * Connection URIs contain database credentials. They are returned to the caller
 * (that is the feature) but must never be embedded in action summaries,
 * resource labels, or anything else that reaches the audit log or DashClaw.
 */
const BASE = "https://console.neon.tech/api/v2";
function headers(token) {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
function mapProject(p) {
    return {
        id: p.id,
        name: p.name,
        regionId: p.region_id,
        pgVersion: p.pg_version,
        createdAt: p.created_at,
    };
}
export async function listProjects(token) {
    const data = await httpJson(`${BASE}/projects`, { headers: headers(token) });
    return (data?.projects ?? []).map(mapProject);
}
export async function createProject(token, params = {}) {
    const data = await httpJson(`${BASE}/projects`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
            project: {
                name: params.name,
                region_id: params.regionId,
                pg_version: params.pgVersion,
            },
        }),
    });
    return {
        project: mapProject(data?.project ?? {}),
        branchId: data?.branch?.id,
        connectionUri: data?.connection_uris?.[0]?.connection_uri,
    };
}
export async function getConnectionUri(token, params) {
    const data = await httpJson(`${BASE}/projects/${params.projectId}/connection_uri`, {
        headers: headers(token),
        query: {
            database_name: params.databaseName,
            role_name: params.roleName,
            branch_id: params.branchId,
            pooled: params.pooled === undefined ? undefined : String(params.pooled),
        },
    });
    return { connectionUri: data?.connection_uri };
}
//# sourceMappingURL=neon.js.map
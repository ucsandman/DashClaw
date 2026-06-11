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

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export interface NeonProject {
  id: string;
  name: string;
  regionId?: string;
  pgVersion?: number;
  createdAt?: string;
}

function mapProject(p: Record<string, any>): NeonProject {
  return {
    id: p.id,
    name: p.name,
    regionId: p.region_id,
    pgVersion: p.pg_version,
    createdAt: p.created_at,
  };
}

export async function listProjects(token: string): Promise<NeonProject[]> {
  const data = await httpJson<any>(`${BASE}/projects`, { headers: headers(token) });
  return (data?.projects ?? []).map(mapProject);
}

export interface NeonCreatedProject {
  project: NeonProject;
  branchId?: string;
  /** Connection URI for the default branch/database/role. Contains credentials. */
  connectionUri?: string;
}

export async function createProject(
  token: string,
  params: { name?: string; regionId?: string; pgVersion?: number } = {},
): Promise<NeonCreatedProject> {
  const data = await httpJson<any>(`${BASE}/projects`, {
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

export async function getConnectionUri(
  token: string,
  params: {
    projectId: string;
    databaseName: string;
    roleName: string;
    branchId?: string;
    pooled?: boolean;
  },
): Promise<{ connectionUri: string }> {
  const data = await httpJson<any>(`${BASE}/projects/${params.projectId}/connection_uri`, {
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

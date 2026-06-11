import { httpJson } from "./http.js";

/**
 * Supabase Management API adapter.
 * Base: https://api.supabase.com/v1 — auth: Bearer PAT (SUPABASE_ACCESS_TOKEN).
 *
 * SQL runs via POST /v1/projects/{ref}/database/query with { query, read_only }.
 * `read_only: true` is the REAL enforcement for reads (backend runs as a
 * read-only Postgres user); our local SQL classification is defense-in-depth.
 */
const BASE = "https://api.supabase.com/v1";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export interface SupabaseProject {
  id: string;
  ref?: string;
  name: string;
  region?: string;
  status?: string;
  organizationId?: string;
}

export async function listProjects(token: string): Promise<SupabaseProject[]> {
  const data = await httpJson<any[]>(`${BASE}/projects`, { headers: headers(token) });
  return (data ?? []).map((p: Record<string, any>) => ({
    id: p.id,
    ref: p.ref ?? p.id,
    name: p.name,
    region: p.region,
    status: p.status,
    organizationId: p.organization_id,
  }));
}

export async function getProject(token: string, ref: string): Promise<SupabaseProject> {
  const p = await httpJson<Record<string, any>>(`${BASE}/projects/${ref}`, {
    headers: headers(token),
  });
  return {
    id: p.id,
    ref: p.ref ?? ref,
    name: p.name,
    region: p.region,
    status: p.status,
    organizationId: p.organization_id,
  };
}

/**
 * Run SQL against a project. `readOnly` is passed through to the backend.
 * Returns the result rows (shape depends on the query).
 */
export async function runQuery(
  token: string,
  ref: string,
  query: string,
  readOnly: boolean,
): Promise<unknown> {
  return httpJson<unknown>(`${BASE}/projects/${ref}/database/query`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ query, read_only: readOnly }),
  });
}

export interface SupabaseLogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  service?: string;
}

export async function getProjectLogs(
  token: string,
  ref: string,
  params: { service?: string; since?: string; limit?: number } = {},
): Promise<SupabaseLogEntry[]> {
  const data = await httpJson<any>(`${BASE}/projects/${ref}/logs`, {
    headers: headers(token),
    query: {
      service: params.service,
      since: params.since,
      limit: String(params.limit ?? 100),
    },
  });
  const rows = Array.isArray(data) ? data : data?.logs ?? data?.data ?? [];
  return rows.map((entry: Record<string, any>) => ({
    timestamp: entry.timestamp ?? entry.inserted_at ?? entry.created_at,
    level: entry.level ?? entry.severity,
    message: entry.message ?? entry.event_message ?? entry.body,
    service: entry.service ?? params.service,
  }));
}

export async function applyMigration(
  token: string,
  ref: string,
  params: { name: string; query: string },
): Promise<unknown> {
  return httpJson<unknown>(`${BASE}/projects/${ref}/database/migrations`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ name: params.name, query: params.query }),
  });
}

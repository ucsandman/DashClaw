import { httpJson } from "./http.js";

/**
 * Vercel REST adapter. Base: https://api.vercel.com — auth: Bearer VERCEL_TOKEN.
 * Note the mixed API versions per endpoint (v3/v7/v9/v10/v13) — see research note.
 * `teamId` must be threaded onto every request for team-owned resources.
 */
const BASE = "https://api.vercel.com";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function teamQuery(teamId?: string): Record<string, string | undefined> {
  return { teamId };
}

export interface VercelProjectContext {
  id: string;
  name: string;
  framework: string | null;
  latestDeployments?: number;
  createdAt?: number;
}

export async function getProjectContext(
  token: string,
  idOrName: string,
  teamId?: string,
): Promise<VercelProjectContext> {
  const data = await httpJson<Record<string, any>>(`${BASE}/v9/projects/${idOrName}`, {
    headers: headers(token),
    query: teamQuery(teamId),
  });
  return {
    id: data.id,
    name: data.name,
    framework: data.framework ?? null,
    latestDeployments: Array.isArray(data.latestDeployments)
      ? data.latestDeployments.length
      : undefined,
    createdAt: data.createdAt,
  };
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  readyState: string;
  target: string | null;
  createdAt: number;
}

export async function listDeployments(
  token: string,
  projectId: string,
  teamId?: string,
  limit = 10,
): Promise<VercelDeployment[]> {
  const data = await httpJson<{ deployments?: any[] }>(`${BASE}/v7/deployments`, {
    headers: headers(token),
    query: { ...teamQuery(teamId), projectId, limit: String(limit) },
  });
  return (data.deployments ?? []).map((d: Record<string, any>) => ({
    uid: d.uid,
    name: d.name,
    url: d.url,
    state: d.state ?? d.readyState,
    readyState: d.readyState ?? d.state,
    target: d.target ?? null,
    createdAt: d.created ?? d.createdAt,
  }));
}

export async function getDeploymentStatus(
  token: string,
  idOrUrl: string,
  teamId?: string,
): Promise<Record<string, unknown>> {
  const d = await httpJson<Record<string, any>>(`${BASE}/v13/deployments/${idOrUrl}`, {
    headers: headers(token),
    query: teamQuery(teamId),
  });
  return {
    uid: d.id ?? d.uid,
    url: d.url,
    readyState: d.readyState ?? d.status,
    readySubstate: d.readySubstate,
    target: d.target ?? null,
    errorCode: d.errorCode,
    errorMessage: d.errorMessage,
    createdAt: d.createdAt ?? d.created,
  };
}

export interface VercelLogEvent {
  type: string;
  created: number;
  text?: string;
}

export async function getDeploymentLogs(
  token: string,
  idOrUrl: string,
  teamId?: string,
  limit = 100,
  since?: number,
): Promise<VercelLogEvent[]> {
  const data = await httpJson<any>(`${BASE}/v3/deployments/${idOrUrl}/events`, {
    headers: headers(token),
    query: {
      ...teamQuery(teamId),
      limit: String(limit),
      builds: "1",
      since: since !== undefined ? String(since) : undefined,
    },
  });
  const arr = Array.isArray(data) ? data : (data?.events ?? []);
  return arr.map((e: Record<string, any>) => ({
    type: e.type,
    created: e.created ?? e.date,
    text: e.text ?? e.payload?.text,
  }));
}

export async function setEnvVar(
  token: string,
  projectId: string,
  params: { key: string; value: string; target: string[]; type?: string },
  teamId?: string,
): Promise<Record<string, unknown>> {
  return httpJson<Record<string, unknown>>(`${BASE}/v10/projects/${projectId}/env`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    query: { ...teamQuery(teamId), upsert: "true" },
    body: JSON.stringify({
      key: params.key,
      value: params.value,
      type: params.type ?? "encrypted",
      target: params.target,
    }),
  });
}

/**
 * Env var NAMES configured on a project. Values are intentionally never
 * fetched (Vercel returns encrypted/redacted values here, but we drop them
 * entirely so nothing secret-shaped transits audit or DashClaw context).
 */
export async function listEnvVarNames(
  token: string,
  projectId: string,
  teamId?: string,
): Promise<string[]> {
  const data = await httpJson<{ envs?: any[] }>(`${BASE}/v9/projects/${projectId}/env`, {
    headers: headers(token),
    query: teamQuery(teamId),
  });
  return (data.envs ?? []).map((e: Record<string, any>) => String(e.key));
}

export interface VercelCreatedProject {
  id: string;
  name: string;
  framework: string | null;
  createdAt?: number;
}

export async function createProject(
  token: string,
  params: { name: string; framework?: string },
  teamId?: string,
): Promise<VercelCreatedProject> {
  const data = await httpJson<Record<string, any>>(`${BASE}/v11/projects`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    query: teamQuery(teamId),
    body: JSON.stringify({ name: params.name, framework: params.framework }),
  });
  return {
    id: data.id,
    name: data.name,
    framework: data.framework ?? null,
    createdAt: data.createdAt,
  };
}

export interface VercelDnsTarget {
  type: "A" | "CNAME";
  /** Host record name to set at the registrar, e.g. "@" or "www". */
  host: string;
  value: string;
}

export interface VercelProjectDomain {
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
  verification?: Array<{ type: string; domain: string; value: string; reason?: string }>;
  /** The DNS record to create at the registrar so the domain points at Vercel. */
  dnsTarget: VercelDnsTarget;
}

/** Vercel's documented targets: apex → A 76.76.21.21, subdomain → CNAME cname.vercel-dns.com. */
function dnsTargetFor(name: string, apexName: string): VercelDnsTarget {
  if (name === apexName) return { type: "A", host: "@", value: "76.76.21.21" };
  const host = name.endsWith(`.${apexName}`) ? name.slice(0, -(apexName.length + 1)) : name;
  return { type: "CNAME", host, value: "cname.vercel-dns.com" };
}

export async function addProjectDomain(
  token: string,
  projectIdOrName: string,
  domain: string,
  teamId?: string,
): Promise<VercelProjectDomain> {
  const data = await httpJson<Record<string, any>>(
    `${BASE}/v10/projects/${projectIdOrName}/domains`,
    {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      query: teamQuery(teamId),
      body: JSON.stringify({ name: domain }),
    },
  );
  const name = String(data.name ?? domain);
  const apexName = String(data.apexName ?? domain);
  return {
    name,
    apexName,
    projectId: data.projectId,
    verified: data.verified === true,
    verification: data.verification,
    dnsTarget: dnsTargetFor(name, apexName),
  };
}

export async function createDeployment(
  token: string,
  params: {
    name: string;
    project: string;
    target?: string;
    deploymentId?: string;
    gitSource?: { type: "github"; repoId: string; ref?: string; sha?: string };
  },
  teamId?: string,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    name: params.name,
    project: params.project,
    target: params.target ?? "preview",
  };
  if (params.deploymentId) body.deploymentId = params.deploymentId;
  if (params.gitSource) {
    body.gitSource = {
      type: params.gitSource.type,
      repoId: params.gitSource.repoId,
      ref: params.gitSource.ref,
      sha: params.gitSource.sha,
    };
  }
  return httpJson<Record<string, unknown>>(`${BASE}/v13/deployments`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    query: teamQuery(teamId),
    body: JSON.stringify(body),
  });
}

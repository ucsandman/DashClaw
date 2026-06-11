import { httpJson } from "./http.js";
/**
 * Vercel REST adapter. Base: https://api.vercel.com — auth: Bearer VERCEL_TOKEN.
 * Note the mixed API versions per endpoint (v3/v7/v9/v10/v13) — see research note.
 * `teamId` must be threaded onto every request for team-owned resources.
 */
const BASE = "https://api.vercel.com";
function headers(token) {
    return { Authorization: `Bearer ${token}` };
}
function teamQuery(teamId) {
    return { teamId };
}
export async function getProjectContext(token, idOrName, teamId) {
    const data = await httpJson(`${BASE}/v9/projects/${idOrName}`, {
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
export async function listDeployments(token, projectId, teamId, limit = 10) {
    const data = await httpJson(`${BASE}/v7/deployments`, {
        headers: headers(token),
        query: { ...teamQuery(teamId), projectId, limit: String(limit) },
    });
    return (data.deployments ?? []).map((d) => ({
        uid: d.uid,
        name: d.name,
        url: d.url,
        state: d.state ?? d.readyState,
        readyState: d.readyState ?? d.state,
        target: d.target ?? null,
        createdAt: d.created ?? d.createdAt,
    }));
}
export async function getDeploymentStatus(token, idOrUrl, teamId) {
    const d = await httpJson(`${BASE}/v13/deployments/${idOrUrl}`, {
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
export async function getDeploymentLogs(token, idOrUrl, teamId, limit = 100, since) {
    const data = await httpJson(`${BASE}/v3/deployments/${idOrUrl}/events`, {
        headers: headers(token),
        query: {
            ...teamQuery(teamId),
            limit: String(limit),
            builds: "1",
            since: since !== undefined ? String(since) : undefined,
        },
    });
    const arr = Array.isArray(data) ? data : (data?.events ?? []);
    return arr.map((e) => ({
        type: e.type,
        created: e.created ?? e.date,
        text: e.text ?? e.payload?.text,
    }));
}
export async function setEnvVar(token, projectId, params, teamId) {
    return httpJson(`${BASE}/v10/projects/${projectId}/env`, {
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
export async function listEnvVarNames(token, projectId, teamId) {
    const data = await httpJson(`${BASE}/v9/projects/${projectId}/env`, {
        headers: headers(token),
        query: teamQuery(teamId),
    });
    return (data.envs ?? []).map((e) => String(e.key));
}
export async function createProject(token, params, teamId) {
    const data = await httpJson(`${BASE}/v11/projects`, {
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
/** Vercel's documented targets: apex → A 76.76.21.21, subdomain → CNAME cname.vercel-dns.com. */
function dnsTargetFor(name, apexName) {
    if (name === apexName)
        return { type: "A", host: "@", value: "76.76.21.21" };
    const host = name.endsWith(`.${apexName}`) ? name.slice(0, -(apexName.length + 1)) : name;
    return { type: "CNAME", host, value: "cname.vercel-dns.com" };
}
export async function addProjectDomain(token, projectIdOrName, domain, teamId) {
    const data = await httpJson(`${BASE}/v10/projects/${projectIdOrName}/domains`, {
        method: "POST",
        headers: { ...headers(token), "Content-Type": "application/json" },
        query: teamQuery(teamId),
        body: JSON.stringify({ name: domain }),
    });
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
export async function createDeployment(token, params, teamId) {
    const body = {
        name: params.name,
        project: params.project,
        target: params.target ?? "preview",
    };
    if (params.deploymentId)
        body.deploymentId = params.deploymentId;
    if (params.gitSource) {
        body.gitSource = {
            type: params.gitSource.type,
            repoId: params.gitSource.repoId,
            ref: params.gitSource.ref,
            sha: params.gitSource.sha,
        };
    }
    return httpJson(`${BASE}/v13/deployments`, {
        method: "POST",
        headers: { ...headers(token), "Content-Type": "application/json" },
        query: teamQuery(teamId),
        body: JSON.stringify(body),
    });
}
//# sourceMappingURL=vercel.js.map
import { httpJson } from "./http.js";
const BASE = "https://sentry.io/api/0";
function headers(authToken) {
    return {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
    };
}
function enc(value) {
    return encodeURIComponent(value);
}
function mapProject(value) {
    return {
        id: String(value.id),
        slug: value.slug,
        name: value.name,
        platform: value.platform,
        teamSlug: value.team?.slug,
        dateCreated: value.dateCreated,
    };
}
export async function listProjects(authToken, organizationSlug, limit = 20, query) {
    const data = await httpJson(`${BASE}/organizations/${enc(organizationSlug)}/projects/`, {
        headers: headers(authToken),
        query: { per_page: String(limit), query },
    });
    return data.map(mapProject);
}
export async function createProject(authToken, organizationSlug, params) {
    const url = params.teamSlug
        ? `${BASE}/teams/${enc(organizationSlug)}/${enc(params.teamSlug)}/projects/`
        : `${BASE}/organizations/${enc(organizationSlug)}/projects/`;
    const data = await httpJson(url, {
        method: "POST",
        headers: headers(authToken),
        body: JSON.stringify({
            name: params.name,
            slug: params.slug,
            platform: params.platform,
            default_rules: params.defaultRules,
        }),
    });
    return mapProject(data);
}
function mapClientKey(value) {
    return {
        id: value.id,
        name: value.name,
        label: value.label,
        publicKey: value.public,
        projectId: value.projectId,
        isActive: value.isActive,
        publicDsn: value.dsn?.public,
        cspDsn: value.dsn?.csp,
        rateLimit: value.rateLimit,
    };
}
export async function listClientKeys(authToken, organizationSlug, projectSlug, status) {
    const data = await httpJson(`${BASE}/projects/${enc(organizationSlug)}/${enc(projectSlug)}/keys/`, {
        headers: headers(authToken),
        query: { status },
    });
    return data.map(mapClientKey);
}
export async function createClientKey(authToken, organizationSlug, projectSlug, params) {
    const data = await httpJson(`${BASE}/projects/${enc(organizationSlug)}/${enc(projectSlug)}/keys/`, {
        method: "POST",
        headers: headers(authToken),
        body: JSON.stringify({
            name: params.name,
            useCase: params.useCase,
            rateLimit: params.rateLimit,
        }),
    });
    return mapClientKey(data);
}
function mapRelease(value) {
    return {
        id: String(value.id),
        version: value.version,
        shortVersion: value.shortVersion,
        ref: value.ref,
        url: value.url,
        dateCreated: value.dateCreated,
        dateReleased: value.dateReleased,
        deployCount: value.deployCount,
        projectSlugs: Array.isArray(value.projects)
            ? value.projects.map((project) => project.slug).filter((slug) => typeof slug === "string")
            : [],
    };
}
export async function listReleases(authToken, organizationSlug, query) {
    const data = await httpJson(`${BASE}/organizations/${enc(organizationSlug)}/releases/`, {
        headers: headers(authToken),
        query: { query },
    });
    return data.map(mapRelease);
}
export async function createRelease(authToken, organizationSlug, params) {
    const data = await httpJson(`${BASE}/organizations/${enc(organizationSlug)}/releases/`, {
        method: "POST",
        headers: headers(authToken),
        body: JSON.stringify({
            version: params.version,
            projects: params.projects,
            ref: params.ref,
            url: params.url,
            dateReleased: params.dateReleased,
        }),
    });
    return mapRelease(data);
}
function mapDeploy(value) {
    return {
        id: String(value.id),
        environment: value.environment,
        name: value.name,
        url: value.url,
        dateStarted: value.dateStarted,
        dateFinished: value.dateFinished,
    };
}
export async function listDeploys(authToken, organizationSlug, version) {
    const data = await httpJson(`${BASE}/organizations/${enc(organizationSlug)}/releases/${enc(version)}/deploys/`, { headers: headers(authToken) });
    return data.map(mapDeploy);
}
export async function createDeploy(authToken, organizationSlug, version, params) {
    const data = await httpJson(`${BASE}/organizations/${enc(organizationSlug)}/releases/${enc(version)}/deploys/`, {
        method: "POST",
        headers: headers(authToken),
        body: JSON.stringify({
            environment: params.environment,
            name: params.name,
            url: params.url,
            dateStarted: params.dateStarted,
            dateFinished: params.dateFinished,
            projects: params.projects,
        }),
    });
    return mapDeploy(data);
}
//# sourceMappingURL=sentry.js.map
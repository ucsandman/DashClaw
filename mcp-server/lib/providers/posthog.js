import { stripTrailingSlashes } from "../util.js";
import { httpJson } from "./http.js";
const DEFAULT_API_HOST = "https://us.posthog.com";
const DEFAULT_INGEST_HOST = "https://us.i.posthog.com";
function enc(value) {
    return encodeURIComponent(value);
}
function cleanHost(value, fallback) {
    const host = (value ?? fallback).trim();
    return stripTrailingSlashes(host || fallback);
}
export function resolveHosts(apiHost, ingestHost) {
    const api = cleanHost(apiHost, DEFAULT_API_HOST);
    if (ingestHost !== undefined) {
        return { apiHost: api, ingestHost: cleanHost(ingestHost, DEFAULT_INGEST_HOST) };
    }
    if (api === "https://us.posthog.com")
        return { apiHost: api, ingestHost: "https://us.i.posthog.com" };
    if (api === "https://eu.posthog.com")
        return { apiHost: api, ingestHost: "https://eu.i.posthog.com" };
    return { apiHost: api, ingestHost: api };
}
function headers(personalApiKey) {
    return {
        Authorization: `Bearer ${personalApiKey}`,
        "Content-Type": "application/json",
    };
}
function results(value) {
    if (Array.isArray(value))
        return value;
    if (typeof value === "object" && value !== null && Array.isArray(value.results)) {
        return value.results;
    }
    return [];
}
function stringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.filter((item) => typeof item === "string");
}
function mapProject(value) {
    return {
        id: String(value.id),
        uuid: value.uuid,
        organizationId: typeof value.organization === "string" ? value.organization : undefined,
        name: value.name,
        projectToken: value.api_token,
        productDescription: value.product_description,
        timezone: value.timezone,
        appUrls: stringArray(value.app_urls),
        createdAt: value.created_at,
        updatedAt: value.updated_at,
        ingestedEvent: value.ingested_event,
        isDemo: value.is_demo,
        accessControl: value.access_control,
    };
}
export function projectEnv(project, ingestHost) {
    return {
        projectId: project.id,
        projectName: project.name,
        env: {
            POSTHOG_PROJECT_ID: project.id,
            NEXT_PUBLIC_POSTHOG_KEY: project.projectToken,
            NEXT_PUBLIC_POSTHOG_HOST: ingestHost,
        },
    };
}
export async function listProjects(personalApiKey, organizationId, params = {}) {
    const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
    const data = await httpJson(`${apiHost}/api/organizations/${enc(organizationId)}/projects/`, {
        headers: headers(personalApiKey),
        query: {
            limit: params.limit === undefined ? undefined : String(params.limit),
            search: params.search,
        },
    });
    return results(data).map(mapProject);
}
export async function getProject(personalApiKey, organizationId, projectId, params = {}) {
    const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
    const data = await httpJson(`${apiHost}/api/organizations/${enc(organizationId)}/projects/${enc(projectId)}/`, { headers: headers(personalApiKey) });
    return mapProject(data);
}
export async function createProject(personalApiKey, organizationId, params) {
    const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
    const data = await httpJson(`${apiHost}/api/organizations/${enc(organizationId)}/projects/`, {
        method: "POST",
        headers: headers(personalApiKey),
        body: JSON.stringify({
            name: params.name,
            product_description: params.productDescription,
            app_urls: params.appUrls,
            timezone: params.timezone,
            session_recording_opt_in: params.sessionRecording,
        }),
    });
    return mapProject(data);
}
function mapFeatureFlag(value) {
    return {
        id: String(value.id),
        key: value.key,
        name: value.name,
        active: value.active,
        deleted: value.deleted,
        filters: value.filters,
        tags: stringArray(value.tags),
        createdAt: value.created_at,
        updatedAt: value.updated_at,
        status: value.status,
        evaluationRuntime: value.evaluation_runtime,
        isRemoteConfiguration: value.is_remote_configuration,
    };
}
export async function listFeatureFlags(personalApiKey, projectId, params = {}) {
    const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
    const data = await httpJson(`${apiHost}/api/projects/${enc(projectId)}/feature_flags/`, {
        headers: headers(personalApiKey),
        query: {
            limit: params.limit === undefined ? undefined : String(params.limit),
            search: params.search,
            active: params.active,
            type: params.type,
        },
    });
    return results(data).map(mapFeatureFlag);
}
export async function createFeatureFlag(personalApiKey, projectId, params) {
    const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
    const data = await httpJson(`${apiHost}/api/projects/${enc(projectId)}/feature_flags/`, {
        method: "POST",
        headers: headers(personalApiKey),
        body: JSON.stringify({
            key: params.key,
            name: params.name,
            active: params.active,
            filters: params.filters,
            tags: params.tags,
            is_remote_configuration: params.isRemoteConfiguration,
        }),
    });
    return mapFeatureFlag(data);
}
//# sourceMappingURL=posthog.js.map
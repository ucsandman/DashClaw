import { stripTrailingSlashes } from "../util.js";
import { httpJson } from "./http.js";

const DEFAULT_API_HOST = "https://us.posthog.com";
const DEFAULT_INGEST_HOST = "https://us.i.posthog.com";

function enc(value: string): string {
  return encodeURIComponent(value);
}

function cleanHost(value: string | undefined, fallback: string): string {
  const host = (value ?? fallback).trim();
  return stripTrailingSlashes(host || fallback);
}

export function resolveHosts(apiHost?: string, ingestHost?: string): { apiHost: string; ingestHost: string } {
  const api = cleanHost(apiHost, DEFAULT_API_HOST);
  if (ingestHost !== undefined) {
    return { apiHost: api, ingestHost: cleanHost(ingestHost, DEFAULT_INGEST_HOST) };
  }
  if (api === "https://us.posthog.com") return { apiHost: api, ingestHost: "https://us.i.posthog.com" };
  if (api === "https://eu.posthog.com") return { apiHost: api, ingestHost: "https://eu.i.posthog.com" };
  return { apiHost: api, ingestHost: api };
}

function headers(personalApiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${personalApiKey}`,
    "Content-Type": "application/json",
  };
}

function results(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value as Record<string, any>[];
  if (typeof value === "object" && value !== null && Array.isArray((value as { results?: unknown }).results)) {
    return (value as { results: Record<string, any>[] }).results;
  }
  return [];
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export interface PostHogProject {
  id: string;
  uuid?: string;
  organizationId?: string;
  name: string;
  projectToken?: string;
  productDescription?: string | null;
  timezone?: string;
  appUrls?: string[];
  createdAt?: string;
  updatedAt?: string;
  ingestedEvent?: boolean;
  isDemo?: boolean;
  accessControl?: boolean;
}

function mapProject(value: Record<string, any>): PostHogProject {
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

export interface PostHogProjectEnv {
  projectId: string;
  projectName: string;
  env: {
    POSTHOG_PROJECT_ID: string;
    NEXT_PUBLIC_POSTHOG_KEY?: string;
    NEXT_PUBLIC_POSTHOG_HOST: string;
  };
}

export function projectEnv(project: PostHogProject, ingestHost: string): PostHogProjectEnv {
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

export async function listProjects(
  personalApiKey: string,
  organizationId: string,
  params: { apiHost?: string; ingestHost?: string; limit?: number; search?: string } = {},
): Promise<PostHogProject[]> {
  const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
  const data = await httpJson<unknown>(`${apiHost}/api/organizations/${enc(organizationId)}/projects/`, {
    headers: headers(personalApiKey),
    query: {
      limit: params.limit === undefined ? undefined : String(params.limit),
      search: params.search,
    },
  });
  return results(data).map(mapProject);
}

export async function getProject(
  personalApiKey: string,
  organizationId: string,
  projectId: string,
  params: { apiHost?: string; ingestHost?: string } = {},
): Promise<PostHogProject> {
  const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
  const data = await httpJson<Record<string, any>>(
    `${apiHost}/api/organizations/${enc(organizationId)}/projects/${enc(projectId)}/`,
    { headers: headers(personalApiKey) },
  );
  return mapProject(data);
}

export async function createProject(
  personalApiKey: string,
  organizationId: string,
  params: {
    apiHost?: string;
    ingestHost?: string;
    name: string;
    productDescription?: string;
    appUrls?: string[];
    timezone?: string;
    sessionRecording?: boolean;
  },
): Promise<PostHogProject> {
  const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
  const data = await httpJson<Record<string, any>>(`${apiHost}/api/organizations/${enc(organizationId)}/projects/`, {
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

export interface PostHogFeatureFlag {
  id: string;
  key: string;
  name?: string;
  active?: boolean;
  deleted?: boolean;
  filters?: unknown;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  evaluationRuntime?: string;
  isRemoteConfiguration?: boolean;
}

function mapFeatureFlag(value: Record<string, any>): PostHogFeatureFlag {
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

export async function listFeatureFlags(
  personalApiKey: string,
  projectId: string,
  params: {
    apiHost?: string;
    ingestHost?: string;
    limit?: number;
    search?: string;
    active?: "STALE" | "false" | "true";
    type?: "boolean" | "experiment" | "multivariant" | "remote_config";
  } = {},
): Promise<PostHogFeatureFlag[]> {
  const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
  const data = await httpJson<unknown>(`${apiHost}/api/projects/${enc(projectId)}/feature_flags/`, {
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

export async function createFeatureFlag(
  personalApiKey: string,
  projectId: string,
  params: {
    apiHost?: string;
    ingestHost?: string;
    key: string;
    name?: string;
    active?: boolean;
    filters?: Record<string, unknown>;
    tags?: string[];
    isRemoteConfiguration?: boolean;
  },
): Promise<PostHogFeatureFlag> {
  const { apiHost } = resolveHosts(params.apiHost, params.ingestHost);
  const data = await httpJson<Record<string, any>>(`${apiHost}/api/projects/${enc(projectId)}/feature_flags/`, {
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

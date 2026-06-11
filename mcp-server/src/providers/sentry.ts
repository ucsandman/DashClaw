import { httpJson } from "./http.js";

const BASE = "https://sentry.io/api/0";

function headers(authToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform?: string;
  teamSlug?: string;
  dateCreated?: string;
}

function mapProject(value: Record<string, any>): SentryProject {
  return {
    id: String(value.id),
    slug: value.slug,
    name: value.name,
    platform: value.platform,
    teamSlug: value.team?.slug,
    dateCreated: value.dateCreated,
  };
}

export async function listProjects(
  authToken: string,
  organizationSlug: string,
  limit = 20,
  query?: string,
): Promise<SentryProject[]> {
  const data = await httpJson<Record<string, any>[]>(`${BASE}/organizations/${enc(organizationSlug)}/projects/`, {
    headers: headers(authToken),
    query: { per_page: String(limit), query },
  });
  return data.map(mapProject);
}

export async function createProject(
  authToken: string,
  organizationSlug: string,
  params: { name: string; slug?: string; platform?: string; defaultRules?: boolean; teamSlug?: string },
): Promise<SentryProject> {
  const url = params.teamSlug
    ? `${BASE}/teams/${enc(organizationSlug)}/${enc(params.teamSlug)}/projects/`
    : `${BASE}/organizations/${enc(organizationSlug)}/projects/`;
  const data = await httpJson<Record<string, any>>(url, {
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

export interface SentryClientKey {
  id: string;
  name?: string;
  label?: string;
  publicKey?: string;
  projectId?: string | number;
  isActive?: boolean;
  publicDsn?: string;
  cspDsn?: string;
  rateLimit?: unknown;
}

function mapClientKey(value: Record<string, any>): SentryClientKey {
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

export async function listClientKeys(
  authToken: string,
  organizationSlug: string,
  projectSlug: string,
  status?: "active" | "inactive",
): Promise<SentryClientKey[]> {
  const data = await httpJson<Record<string, any>[]>(
    `${BASE}/projects/${enc(organizationSlug)}/${enc(projectSlug)}/keys/`,
    {
      headers: headers(authToken),
      query: { status },
    },
  );
  return data.map(mapClientKey);
}

export async function createClientKey(
  authToken: string,
  organizationSlug: string,
  projectSlug: string,
  params: { name?: string; useCase?: string; rateLimit?: { window: number; count: number } },
): Promise<SentryClientKey> {
  const data = await httpJson<Record<string, any>>(`${BASE}/projects/${enc(organizationSlug)}/${enc(projectSlug)}/keys/`, {
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

export interface SentryRelease {
  id: string;
  version: string;
  shortVersion?: string;
  ref?: string | null;
  url?: string | null;
  dateCreated?: string;
  dateReleased?: string | null;
  deployCount?: number;
  projectSlugs: string[];
}

function mapRelease(value: Record<string, any>): SentryRelease {
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
      ? value.projects.map((project: Record<string, any>) => project.slug).filter((slug: unknown): slug is string => typeof slug === "string")
      : [],
  };
}

export async function listReleases(
  authToken: string,
  organizationSlug: string,
  query?: string,
): Promise<SentryRelease[]> {
  const data = await httpJson<Record<string, any>[]>(`${BASE}/organizations/${enc(organizationSlug)}/releases/`, {
    headers: headers(authToken),
    query: { query },
  });
  return data.map(mapRelease);
}

export async function createRelease(
  authToken: string,
  organizationSlug: string,
  params: { version: string; projects: string[]; ref?: string; url?: string; dateReleased?: string },
): Promise<SentryRelease> {
  const data = await httpJson<Record<string, any>>(`${BASE}/organizations/${enc(organizationSlug)}/releases/`, {
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

export interface SentryDeploy {
  id: string;
  environment: string;
  name?: string;
  url?: string;
  dateStarted?: string;
  dateFinished?: string;
}

function mapDeploy(value: Record<string, any>): SentryDeploy {
  return {
    id: String(value.id),
    environment: value.environment,
    name: value.name,
    url: value.url,
    dateStarted: value.dateStarted,
    dateFinished: value.dateFinished,
  };
}

export async function listDeploys(
  authToken: string,
  organizationSlug: string,
  version: string,
): Promise<SentryDeploy[]> {
  const data = await httpJson<Record<string, any>[]>(
    `${BASE}/organizations/${enc(organizationSlug)}/releases/${enc(version)}/deploys/`,
    { headers: headers(authToken) },
  );
  return data.map(mapDeploy);
}

export async function createDeploy(
  authToken: string,
  organizationSlug: string,
  version: string,
  params: {
    environment: string;
    name?: string;
    url?: string;
    dateStarted?: string;
    dateFinished?: string;
    projects?: string[];
  },
): Promise<SentryDeploy> {
  const data = await httpJson<Record<string, any>>(
    `${BASE}/organizations/${enc(organizationSlug)}/releases/${enc(version)}/deploys/`,
    {
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
    },
  );
  return mapDeploy(data);
}

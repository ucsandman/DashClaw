import type { ClerkResource } from "../types.js";
import { httpJson } from "./http.js";

const DEFAULT_API_HOST = "https://api.clerk.com/v1";

function cleanBase(value: string | undefined): string {
  const host = (value ?? DEFAULT_API_HOST).trim().replace(/\/+$/, "") || DEFAULT_API_HOST;
  return host.endsWith("/v1") ? host : `${host}/v1`;
}

function headers(secretKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
}

function asRecordArray(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value as Record<string, any>[];
  if (typeof value === "object" && value !== null && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: Record<string, any>[] }).data;
  }
  return [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export interface ClerkUserSummary {
  id: string;
  primaryEmail?: string;
  firstName?: string;
  lastName?: string;
  createdAt?: number;
  updatedAt?: number;
  lastSignInAt?: number;
  banned?: boolean;
  locked?: boolean;
}

function primaryEmail(value: Record<string, any>): string | undefined {
  const emails = Array.isArray(value.email_addresses) ? value.email_addresses : [];
  const primaryId = optionalString(value.primary_email_address_id);
  const matched = primaryId
    ? emails.find((item: any) => item && item.id === primaryId)
    : emails[0];
  return optionalString(matched?.email_address);
}

function mapUser(value: Record<string, any>): ClerkUserSummary {
  return {
    id: String(value.id),
    primaryEmail: primaryEmail(value),
    firstName: optionalString(value.first_name),
    lastName: optionalString(value.last_name),
    createdAt: optionalNumber(value.created_at),
    updatedAt: optionalNumber(value.updated_at),
    lastSignInAt: optionalNumber(value.last_sign_in_at),
    banned: typeof value.banned === "boolean" ? value.banned : undefined,
    locked: typeof value.locked === "boolean" ? value.locked : undefined,
  };
}

export interface ClerkDomain {
  id: string;
  name: string;
  isSatellite?: boolean;
  frontendApiUrl?: string;
  accountsPortalUrl?: string;
  proxyUrl?: string;
  developmentOrigin?: string;
}

function mapDomain(value: Record<string, any>): ClerkDomain {
  return {
    id: String(value.id),
    name: String(value.name),
    isSatellite: typeof value.is_satellite === "boolean" ? value.is_satellite : undefined,
    frontendApiUrl: optionalString(value.frontend_api_url),
    accountsPortalUrl: optionalString(value.accounts_portal_url),
    proxyUrl: optionalString(value.proxy_url),
    developmentOrigin: optionalString(value.development_origin),
  };
}

export interface ClerkRedirectUrl {
  id: string;
  url: string;
  createdAt?: number;
  updatedAt?: number;
}

function mapRedirectUrl(value: Record<string, any>): ClerkRedirectUrl {
  return {
    id: String(value.id),
    url: String(value.url),
    createdAt: optionalNumber(value.created_at),
    updatedAt: optionalNumber(value.updated_at),
  };
}

export interface ClerkAppEnv {
  domain?: string;
  frontendApiUrl?: string;
  secretEnvVar: "CLERK_SECRET_KEY";
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
    NEXT_PUBLIC_CLERK_SIGN_IN_URL?: string;
    NEXT_PUBLIC_CLERK_SIGN_UP_URL?: string;
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL?: string;
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL?: string;
    NEXT_PUBLIC_CLERK_FAPI?: string;
  };
}

export function appEnv(resource: ClerkResource, domains: ClerkDomain[]): ClerkAppEnv {
  const primary = domains.find((domain) => domain.isSatellite === false) ?? domains[0];
  const frontendApiUrl = resource.frontendApiUrl ?? primary?.frontendApiUrl;
  return {
    domain: primary?.name,
    frontendApiUrl,
    secretEnvVar: "CLERK_SECRET_KEY",
    env: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: resource.publishableKey,
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: resource.signInUrl,
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: resource.signUpUrl,
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: resource.signInFallbackRedirectUrl,
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: resource.signUpFallbackRedirectUrl,
      NEXT_PUBLIC_CLERK_FAPI: frontendApiUrl,
    },
  };
}

export async function listUsers(
  secretKey: string,
  params: { apiHost?: string; limit?: number; offset?: number; query?: string } = {},
): Promise<ClerkUserSummary[]> {
  const data = await httpJson<unknown>(`${cleanBase(params.apiHost)}/users`, {
    headers: headers(secretKey),
    query: {
      limit: params.limit === undefined ? undefined : String(params.limit),
      offset: params.offset === undefined ? undefined : String(params.offset),
      query: params.query,
    },
  });
  return asRecordArray(data).map(mapUser);
}

export async function listDomains(secretKey: string, apiHost?: string): Promise<ClerkDomain[]> {
  const data = await httpJson<unknown>(`${cleanBase(apiHost)}/domains`, {
    headers: headers(secretKey),
  });
  return asRecordArray(data).map(mapDomain);
}

export async function listRedirectUrls(
  secretKey: string,
  params: { apiHost?: string; limit?: number; offset?: number } = {},
): Promise<ClerkRedirectUrl[]> {
  const data = await httpJson<unknown>(`${cleanBase(params.apiHost)}/redirect_urls`, {
    headers: headers(secretKey),
    query: {
      limit: params.limit === undefined ? undefined : String(params.limit),
      offset: params.offset === undefined ? undefined : String(params.offset),
    },
  });
  return asRecordArray(data).map(mapRedirectUrl);
}

export async function createRedirectUrl(
  secretKey: string,
  params: { apiHost?: string; url: string },
): Promise<ClerkRedirectUrl> {
  const data = await httpJson<Record<string, any>>(`${cleanBase(params.apiHost)}/redirect_urls`, {
    method: "POST",
    headers: headers(secretKey),
    body: JSON.stringify({ url: params.url }),
  });
  return mapRedirectUrl(data);
}

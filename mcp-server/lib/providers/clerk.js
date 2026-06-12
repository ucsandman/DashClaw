import { stripTrailingSlashes } from "../util.js";
import { httpJson } from "./http.js";
const DEFAULT_API_HOST = "https://api.clerk.com/v1";
function cleanBase(value) {
    const host = stripTrailingSlashes((value ?? DEFAULT_API_HOST).trim()) || DEFAULT_API_HOST;
    return host.endsWith("/v1") ? host : `${host}/v1`;
}
function headers(secretKey) {
    return {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
    };
}
function asRecordArray(value) {
    if (Array.isArray(value))
        return value;
    if (typeof value === "object" && value !== null && Array.isArray(value.data)) {
        return value.data;
    }
    return [];
}
function optionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function optionalNumber(value) {
    return typeof value === "number" ? value : undefined;
}
function primaryEmail(value) {
    const emails = Array.isArray(value.email_addresses) ? value.email_addresses : [];
    const primaryId = optionalString(value.primary_email_address_id);
    const matched = primaryId
        ? emails.find((item) => item && item.id === primaryId)
        : emails[0];
    return optionalString(matched?.email_address);
}
function mapUser(value) {
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
function mapDomain(value) {
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
function mapRedirectUrl(value) {
    return {
        id: String(value.id),
        url: String(value.url),
        createdAt: optionalNumber(value.created_at),
        updatedAt: optionalNumber(value.updated_at),
    };
}
export function appEnv(resource, domains) {
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
export async function listUsers(secretKey, params = {}) {
    const data = await httpJson(`${cleanBase(params.apiHost)}/users`, {
        headers: headers(secretKey),
        query: {
            limit: params.limit === undefined ? undefined : String(params.limit),
            offset: params.offset === undefined ? undefined : String(params.offset),
            query: params.query,
        },
    });
    return asRecordArray(data).map(mapUser);
}
export async function listDomains(secretKey, apiHost) {
    const data = await httpJson(`${cleanBase(apiHost)}/domains`, {
        headers: headers(secretKey),
    });
    return asRecordArray(data).map(mapDomain);
}
export async function listRedirectUrls(secretKey, params = {}) {
    const data = await httpJson(`${cleanBase(params.apiHost)}/redirect_urls`, {
        headers: headers(secretKey),
        query: {
            limit: params.limit === undefined ? undefined : String(params.limit),
            offset: params.offset === undefined ? undefined : String(params.offset),
        },
    });
    return asRecordArray(data).map(mapRedirectUrl);
}
export async function createRedirectUrl(secretKey, params) {
    const data = await httpJson(`${cleanBase(params.apiHost)}/redirect_urls`, {
        method: "POST",
        headers: headers(secretKey),
        body: JSON.stringify({ url: params.url }),
    });
    return mapRedirectUrl(data);
}
//# sourceMappingURL=clerk.js.map
import type { ClerkResource } from "../types.js";
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
export interface ClerkDomain {
    id: string;
    name: string;
    isSatellite?: boolean;
    frontendApiUrl?: string;
    accountsPortalUrl?: string;
    proxyUrl?: string;
    developmentOrigin?: string;
}
export interface ClerkRedirectUrl {
    id: string;
    url: string;
    createdAt?: number;
    updatedAt?: number;
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
export declare function appEnv(resource: ClerkResource, domains: ClerkDomain[]): ClerkAppEnv;
export declare function listUsers(secretKey: string, params?: {
    apiHost?: string;
    limit?: number;
    offset?: number;
    query?: string;
}): Promise<ClerkUserSummary[]>;
export declare function listDomains(secretKey: string, apiHost?: string): Promise<ClerkDomain[]>;
export declare function listRedirectUrls(secretKey: string, params?: {
    apiHost?: string;
    limit?: number;
    offset?: number;
}): Promise<ClerkRedirectUrl[]>;
export declare function createRedirectUrl(secretKey: string, params: {
    apiHost?: string;
    url: string;
}): Promise<ClerkRedirectUrl>;

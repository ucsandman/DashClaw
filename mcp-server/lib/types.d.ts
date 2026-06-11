/**
 * Core domain types for DashClaw V0.
 *
 * These types are intentionally explicit about project + environment + provider
 * scoping. The whole point of DashClaw is that an AI agent must always know
 * *which* project and environment and provider account it is operating against
 * before it touches a real provider API.
 *
 * Provider credentials are read from environment variables at call time and are
 * never persisted to disk (see ProviderConnection.auth).
 */
export type ProviderId = "github" | "vercel" | "supabase" | "stripe" | "railway" | "namecheap" | "neon" | "upstash" | "cloudflare_r2" | "sentry" | "posthog" | "resend" | "twilio" | "clerk";
export declare const PROVIDER_IDS: ProviderId[];
/** How "production-like" an environment is. Drives default policy. */
export type EnvironmentKind = "development" | "staging" | "production";
export interface Workspace {
    id: string;
    name: string;
    createdAt: string;
}
export interface Project {
    id: string;
    workspaceId: string;
    /** Human display name, e.g. "Your Project". */
    name: string;
    /** URL/identifier-safe slug, e.g. "your-project". Unique within a workspace. */
    slug: string;
    description?: string;
    createdAt: string;
}
export interface Environment {
    id: string;
    projectId: string;
    /** e.g. "staging", "production", "dev". Unique within a project. */
    name: string;
    kind: EnvironmentKind;
    /** Convenience flag derived from kind === "production". */
    isProduction: boolean;
    createdAt: string;
}
/**
 * Auth reference for a provider connection. The token is read from a named
 * environment variable at runtime and is NEVER persisted to disk.
 */
export interface ProviderAuth {
    kind: "env";
    /** Name of the env var holding the secret, e.g. "GITHUB_TOKEN". */
    envVar: string;
}
/**
 * A configured way to talk to a provider. Connections are workspace-scoped so
 * multiple projects can share one account, but mappings (below) bind a specific
 * environment to a specific resource.
 */
export interface ProviderConnection {
    id: string;
    workspaceId: string;
    provider: ProviderId;
    /** Friendly label, e.g. "github-org". */
    label: string;
    auth: ProviderAuth;
    /** Optional provider-level scoping, e.g. Vercel team id. */
    scope?: {
        vercelTeamId?: string;
        githubOwner?: string;
    };
    createdAt: string;
}
export interface GithubResource {
    owner: string;
    repo: string;
}
export interface VercelResource {
    /** Vercel project id or name. */
    projectId: string;
    projectName?: string;
    /** Overrides connection-level team id if set. */
    teamId?: string;
}
export interface SupabaseResource {
    /** Supabase project ref, e.g. "abcdefghijklmnop". */
    projectRef: string;
}
export interface StripeResource {
    /** Which key/mode this environment uses. */
    mode: "test" | "live";
}
export interface RailwayResource {
    /** Railway project id (opaque UUID). */
    projectId: string;
    /** Railway environment id within the project (e.g. its "production" env). */
    environmentId?: string;
    /** Railway service id to scope deployments/logs to a single service. */
    serviceId?: string;
    /** Friendly Railway project name, for display only. */
    projectName?: string;
}
export interface TwilioResource {
    /** Twilio Account SID, e.g. ACxxxxxxxx. Not secret; paired with TWILIO_AUTH_TOKEN at call time. */
    accountSid: string;
    /** Default sender for SMS/calls when a tool call does not pass an explicit sender. */
    fromNumber?: string;
    /** Optional Messaging Service SID for outbound SMS. */
    messagingServiceSid?: string;
}
export interface ResendResource {
    /** Primary sending domain, e.g. example.com. Not secret. */
    domain: string;
    /** Default From header, e.g. "Acme <onboarding@example.com>". */
    defaultFrom?: string;
}
export interface SentryResource {
    /** Sentry organization slug, e.g. acme. Not secret. */
    organizationSlug: string;
    /** Optional mapped project slug used for SENTRY_DSN/client-key actions. */
    projectSlug?: string;
    /** Optional team slug used when creating projects through the team endpoint. */
    teamSlug?: string;
}
export interface UpstashResource {
    /** Upstash Redis database id. Not secret; credentials are read from the Developer API at call time. */
    databaseId: string;
    /** Optional Upstash Developer API host override for tests/self-hosting proxies. */
    apiHost?: string;
    /** Optional QStash API URL. Defaults to https://qstash.upstash.io. */
    qstashUrl?: string;
    /** Env var name that holds the QStash API token for background jobs/schedules. */
    qstashTokenEnvVar?: string;
    /** Env var name that holds the current QStash signing key for app verification. */
    qstashCurrentSigningKeyEnvVar?: string;
    /** Env var name that holds the next QStash signing key for app verification. */
    qstashNextSigningKeyEnvVar?: string;
}
export interface CloudflareR2Resource {
    /** Cloudflare account id. Not secret; paired with CLOUDFLARE_API_TOKEN at call time. */
    accountId: string;
    /** Optional default R2 bucket for app env wiring and object listing. */
    bucketName?: string;
    /** Optional Cloudflare API host override for tests/proxies. */
    apiHost?: string;
    /** R2 jurisdiction for bucket operations. Defaults to Cloudflare's default jurisdiction. */
    jurisdiction?: "default" | "eu" | "fedramp";
    /** Env var name that holds the S3-compatible R2 access key id for app code. */
    accessKeyIdEnvVar?: string;
    /** Env var name that holds the S3-compatible R2 secret access key for app code. */
    secretAccessKeyEnvVar?: string;
    /** Optional public/custom asset URL for app code. */
    publicUrl?: string;
}
export interface PostHogResource {
    /** PostHog organization id used by private project APIs. Not secret. */
    organizationId: string;
    /** Optional PostHog project id used for feature flags and client env wiring. */
    projectId?: string;
    /** Private PostHog app/API host, e.g. https://us.posthog.com. */
    apiHost?: string;
    /** Public capture/SDK host, e.g. https://us.i.posthog.com. */
    ingestHost?: string;
}
export interface ClerkResource {
    /** Clerk Publishable Key, e.g. pk_test_... or pk_live_.... Safe for client env wiring. */
    publishableKey: string;
    /** Optional Backend API host override for tests/proxies. Defaults to https://api.clerk.com. */
    apiHost?: string;
    /** Optional Frontend API URL override. Usually inferred from the primary Clerk domain. */
    frontendApiUrl?: string;
    /** Optional sign-in/sign-up routes exposed to frontend frameworks. */
    signInUrl?: string;
    signUpUrl?: string;
    signInFallbackRedirectUrl?: string;
    signUpFallbackRedirectUrl?: string;
}
export type ProviderResource = ({
    provider: "github";
} & GithubResource) | ({
    provider: "vercel";
} & VercelResource) | ({
    provider: "supabase";
} & SupabaseResource) | ({
    provider: "stripe";
} & StripeResource) | ({
    provider: "railway";
} & RailwayResource) | ({
    provider: "upstash";
} & UpstashResource) | ({
    provider: "cloudflare_r2";
} & CloudflareR2Resource) | ({
    provider: "sentry";
} & SentryResource) | ({
    provider: "posthog";
} & PostHogResource) | ({
    provider: "resend";
} & ResendResource) | ({
    provider: "twilio";
} & TwilioResource) | ({
    provider: "clerk";
} & ClerkResource);
export interface ProviderMapping {
    id: string;
    projectId: string;
    environmentId: string;
    provider: ProviderId;
    /** Optional link to the connection that supplies credentials. */
    connectionId?: string;
    resource: ProviderResource;
    createdAt: string;
}
/**
 * The capability a tool exercises. The policy engine reasons about capability +
 * environment kind + provider, NOT about individual tool names, so new tools
 * inherit safe defaults automatically.
 */
export type Capability = "read" | "write" | "deploy" | "env_change" | "delete" | "destructive_sql" | "purchase";
export type PolicyEffect = "allow" | "block" | "approval_required";
/**
 * An explicit, user-authored rule that overrides the built-in defaults.
 * Higher `priority` wins. A rule matches when every set scope field matches the
 * action context (unset fields are wildcards).
 */
export interface PolicyRule {
    id: string;
    description?: string;
    priority: number;
    effect: PolicyEffect;
    match: {
        projectId?: string;
        environmentId?: string;
        environmentKind?: EnvironmentKind;
        provider?: ProviderId;
        capability?: Capability;
    };
    createdAt: string;
}
/** The fully-resolved context for a single attempted provider action. */
export interface ActionContext {
    project: Project;
    environment: Environment;
    provider: ProviderId;
    capability: Capability;
    /** Tool name, for audit + readable messages. */
    tool: string;
    /** Short human summary of what the action does. */
    summary: string;
    /**
     * Provider-specific risk signal: true when the action targets a "live" /
     * irreversible context independent of environment kind (e.g. a Stripe live
     * key, or an environment explicitly flagged production-like). Lets policy
     * require approval even if the environment kind looks benign.
     */
    live?: boolean;
    /** Concrete provider resource touched, for the audit log. */
    resourceLabel?: string;
}
export interface PolicyDecision {
    effect: PolicyEffect;
    reason: string;
    /** Which rule (or the default engine) produced this decision. */
    source: string;
}
export type ApprovalStatus = "pending" | "approved" | "rejected" | "used";
export interface PendingApproval {
    id: string;
    projectId: string;
    environmentId: string;
    provider: ProviderId;
    capability: Capability;
    tool: string;
    actionSummary: string;
    reason: string;
    providerResource?: string;
    status: ApprovalStatus;
    createdAt: string;
    decidedAt?: string;
    usedAt?: string;
    decisionNote?: string;
}
export type AuditResult = "success" | "error" | "not_executed";
export interface AuditLogEntry {
    timestamp: string;
    projectSlug?: string;
    environment?: string;
    provider?: ProviderId | "core";
    tool: string;
    actionSummary: string;
    policyDecision: PolicyEffect | "n/a";
    result: AuditResult;
    errorMessage?: string;
    /** The concrete provider resource touched, e.g. "your-org/your-repo" or "test". */
    providerResource?: string;
    /** Agent / MCP client info if the transport exposed it. */
    agent?: string;
    /** DashClaw guard decision id, when DashClaw governed this action. */
    dashclawDecisionId?: string;
    /** DashClaw action id, when DashClaw returned or created one. */
    dashclawActionId?: string;
    /** Whether the server recorded the post-execution outcome to DashClaw. */
    dashclawOutcomeRecorded?: boolean;
    /** DashClaw guard/evidence error when governance metadata could not be recorded. */
    dashclawError?: string;
    /** Local correlation id used to connect guard payload, audit line, and outcome. */
    auditCorrelationId?: string;
}
export interface ProjectMemory {
    id: string;
    projectId: string;
    /** Optional environment scoping; omit for project-wide notes. */
    environmentId?: string;
    note: string;
    tags?: string[];
    createdAt: string;
}
export interface LocalState {
    version: 1;
    workspaces: Workspace[];
    projects: Project[];
    environments: Environment[];
    connections: ProviderConnection[];
    mappings: ProviderMapping[];
    policyRules: PolicyRule[];
    pendingApprovals: PendingApproval[];
    /** Currently selected project id (for tools that omit an explicit project). */
    selectedProjectId?: string;
    /** Default workspace id. */
    defaultWorkspaceId?: string;
}

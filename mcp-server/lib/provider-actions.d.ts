import type { Store } from "./storage.js";
import { type GuardedResponse } from "./actions.js";
import * as nc from "./providers/namecheap.js";
import type { ProviderId } from "./types.js";
/**
 * Provider actions. Every function:
 *   1. resolves project + environment,
 *   2. resolves the provider mapping (concrete resource) + credentials,
 *   3. builds an ActionContext and runs it through runGuarded,
 *      which enforces policy and writes the audit log.
 * The real provider call only runs inside the `exec` thunk when policy allows.
 */
interface Base {
    project?: string;
    environment: string;
}
type AppEnvTargetProvider = "vercel" | "railway";
type AppEnvVarInput = {
    key: string;
    value: string;
};
export declare function githubRepoContext(store: Store, input: Base): Promise<GuardedResponse>;
export declare function githubReadme(store: Store, input: Base): Promise<GuardedResponse>;
export declare function githubListFiles(store: Store, input: Base & {
    path?: string;
}): Promise<GuardedResponse>;
export declare function vercelProjectContext(store: Store, input: Base): Promise<GuardedResponse>;
export declare function vercelDeployments(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
export declare function githubPullRequests(store: Store, input: Base & {
    state?: "open" | "closed" | "all";
    limit?: number;
}): Promise<GuardedResponse>;
export declare function githubBranches(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
export declare function githubStatusChecks(store: Store, input: Base & {
    ref: string;
}): Promise<GuardedResponse>;
export declare function githubWorkflowRuns(store: Store, input: Base & {
    branch?: string;
    event?: string;
    status?: string;
    limit?: number;
}): Promise<GuardedResponse>;
export declare function githubWorkflowJobs(store: Store, input: Base & {
    runId: number;
    filter?: "latest" | "all";
    limit?: number;
}): Promise<GuardedResponse>;
export declare function githubRerunWorkflowRun(store: Store, input: Base & {
    runId: number;
}): Promise<GuardedResponse>;
export declare function githubCancelWorkflowRun(store: Store, input: Base & {
    runId: number;
}): Promise<GuardedResponse>;
export declare function vercelDeploymentStatus(store: Store, input: Base & {
    deploymentId: string;
}): Promise<GuardedResponse>;
export declare function vercelDeploymentLogs(store: Store, input: Base & {
    deploymentId: string;
    limit?: number;
}): Promise<GuardedResponse>;
export declare function vercelSetEnvVar(store: Store, input: Base & {
    key: string;
    value: string;
    target?: string[];
}): Promise<GuardedResponse>;
export declare function vercelCreateDeployment(store: Store, input: Base & {
    name?: string;
    deploymentId?: string;
    gitSource?: {
        type: "github";
        repoId: string;
        ref?: string;
        sha?: string;
    };
}): Promise<GuardedResponse>;
/**
 * create_vercel_project — create a Vercel project (capability "write"). No
 * mapping is required: the project usually doesn't exist locally yet; any
 * existing Vercel mapping only supplies credentials/team scope.
 */
export declare function vercelCreateProject(store: Store, input: Base & {
    name: string;
    framework?: string;
}): Promise<GuardedResponse>;
/**
 * add_vercel_domain — attach a domain to a Vercel project (capability
 * "write"). The result includes the DNS target (A 76.76.21.21 for apex,
 * CNAME cname.vercel-dns.com for subdomains) to set at the registrar.
 */
export declare function vercelAddDomain(store: Store, input: Base & {
    vercelProject: string;
    domain: string;
}): Promise<GuardedResponse>;
/** get_vercel_logs — Vercel-specific; resolves latest deployment if none given. */
export declare function vercelLogs(store: Store, input: Base & {
    deploymentId?: string;
    since?: string;
    limit?: number;
}): Promise<GuardedResponse>;
/** get_railway_logs — Railway-specific; resolves latest deployment if none given. */
export declare function railwayLogs(store: Store, input: Base & {
    deploymentId?: string;
    since?: string;
    limit?: number;
}): Promise<GuardedResponse>;
/** get_railway_project_context — Railway project + its environments/services. */
export declare function railwayProjectContext(store: Store, input: Base): Promise<GuardedResponse>;
/** get_railway_deployments — recent deployments for the mapped project/service. */
export declare function railwayDeployments(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
export declare function railwayDiscover(store: Store, input: Base): Promise<GuardedResponse>;
/**
 * create_railway_deployment — trigger a deployment of the mapped Railway
 * service, or redeploy an existing deployment by id. PRODUCTION deploys require
 * approval by default (capability "deploy").
 */
export declare function railwayCreateDeployment(store: Store, input: Base & {
    deploymentId?: string;
}): Promise<GuardedResponse>;
/**
 * set_railway_env_var — create/update a Railway variable. PRODUCTION env changes
 * require approval by default (capability "env_change"). Railway redeploys the
 * affected service on change unless `skipDeploys` is true.
 */
export declare function railwaySetEnvVar(store: Store, input: Base & {
    key: string;
    value: string;
    serviceId?: string;
    skipDeploys?: boolean;
}): Promise<GuardedResponse>;
/** set_app_env_vars — apply a bundle of deployment env vars under one governed action. */
export declare function setAppEnvVars(store: Store, input: Base & {
    targetProvider: AppEnvTargetProvider;
    vars: AppEnvVarInput[];
    target?: string[];
    serviceId?: string;
    skipDeploys?: boolean;
}): Promise<GuardedResponse>;
/** check_domain_availability — availability + premium pricing (read-only). */
export declare function checkDomainAvailability(store: Store, input: Base & {
    domains: string[];
}): Promise<GuardedResponse>;
/** list_namecheap_domains — domains in the Namecheap account (read-only). */
export declare function namecheapListDomains(store: Store, input: Base & {
    page?: number;
    pageSize?: number;
    searchTerm?: string;
}): Promise<GuardedResponse>;
/**
 * purchase_domain — registers a domain and SPENDS REAL MONEY. Capability
 * "purchase" is clamped to approval_required by policy and marked live, so it
 * always needs a human. The registrant contact is validated before any HTTP
 * (including the DashClaw guard call) so a missing config never burns an
 * approval round-trip.
 */
export declare function purchaseDomain(store: Store, input: Base & {
    domain: string;
    years?: number;
}): Promise<GuardedResponse>;
/** get_dns_records — DNS host records for a domain (read-only). */
export declare function getDnsRecords(store: Store, input: Base & {
    domain: string;
}): Promise<GuardedResponse>;
/**
 * set_dns_records — REPLACES ALL host records for the domain (Namecheap
 * setHosts semantics). Capability "env_change": approval required in
 * production by default.
 */
export declare function setDnsRecords(store: Store, input: Base & {
    domain: string;
    records: nc.DnsRecordInput[];
}): Promise<GuardedResponse>;
/** list_neon_projects — Neon projects visible to the API key (read-only). */
export declare function neonListProjects(store: Store, input: Base): Promise<GuardedResponse>;
/** create_neon_project — provision a Neon project (capability "write"). */
export declare function neonCreateProject(store: Store, input: Base & {
    name?: string;
    regionId?: string;
    pgVersion?: number;
}): Promise<GuardedResponse>;
/**
 * get_neon_connection_uri — fetch the connection URI for a Neon project. The
 * URI (with credentials) goes to the tool result ONLY; summary and resource
 * label deliberately name the project, never the URI.
 */
export declare function neonGetConnectionUri(store: Store, input: Base & {
    neonProjectId: string;
    databaseName: string;
    roleName: string;
    branchId?: string;
    pooled?: boolean;
}): Promise<GuardedResponse>;
/** list_upstash_redis_databases — Redis databases visible to the Upstash API key. */
export declare function upstashListRedisDatabases(store: Store, input: Base & {
    apiHost?: string;
}): Promise<GuardedResponse>;
/** create_upstash_redis_database — create Redis and return REST env wiring. */
export declare function upstashCreateRedisDatabase(store: Store, input: Base & {
    apiHost?: string;
    databaseName: string;
    platform: "aws" | "gcp";
    primaryRegion: string;
    readRegions?: string[];
    plan?: string;
    budget?: number;
    eviction?: boolean;
    tls?: boolean;
}): Promise<GuardedResponse>;
/** get_upstash_redis_env — return REST URL/token env wiring for a mapped Redis database. */
export declare function upstashGetRedisEnv(store: Store, input: Base & {
    databaseId?: string;
}): Promise<GuardedResponse>;
/** get_upstash_qstash_env — return QStash URL/token/signing-key env wiring for background jobs. */
export declare function upstashGetQstashEnv(store: Store, input: Base): Promise<GuardedResponse>;
/** list_upstash_qstash_schedules — cron/background schedules visible to the QStash token. */
export declare function upstashListQstashSchedules(store: Store, input: Base): Promise<GuardedResponse>;
/** create_upstash_qstash_schedule — create a cron delivery schedule for an app endpoint. */
export declare function upstashCreateQstashSchedule(store: Store, input: Base & {
    destination: string;
    cron: string;
    scheduleId?: string;
    body?: string;
    contentType?: string;
    method?: string;
    retries?: number;
}): Promise<GuardedResponse>;
/** list_cloudflare_r2_buckets — buckets visible in the mapped Cloudflare account. */
export declare function cloudflareR2ListBuckets(store: Store, input: Base & {
    accountId?: string;
    cursor?: string;
    limit?: number;
}): Promise<GuardedResponse>;
/** create_cloudflare_r2_bucket — create a bucket and return S3-compatible app env wiring. */
export declare function cloudflareR2CreateBucket(store: Store, input: Base & {
    accountId?: string;
    bucketName: string;
    locationHint?: string;
    storageClass?: string;
    jurisdiction?: string;
}): Promise<GuardedResponse>;
/** get_cloudflare_r2_env — return S3-compatible R2 app env wiring for a mapped bucket. */
export declare function cloudflareR2GetEnv(store: Store, input: Base & {
    accountId?: string;
    bucketName?: string;
}): Promise<GuardedResponse>;
/** list_cloudflare_r2_objects — list object summaries for the mapped R2 bucket. */
export declare function cloudflareR2ListObjects(store: Store, input: Base & {
    accountId?: string;
    bucketName?: string;
    prefix?: string;
    cursor?: string;
    limit?: number;
}): Promise<GuardedResponse>;
/** get_clerk_app_env — return public Clerk frontend env wiring for the mapped app. */
export declare function clerkGetAppEnv(store: Store, input: Base): Promise<GuardedResponse>;
/** list_clerk_users — user summaries visible to the Clerk secret key. */
export declare function clerkListUsers(store: Store, input: Base & {
    limit?: number;
    offset?: number;
    query?: string;
}): Promise<GuardedResponse>;
/** list_clerk_domains — primary/satellite domain configuration for the Clerk instance. */
export declare function clerkListDomains(store: Store, input: Base): Promise<GuardedResponse>;
/** list_clerk_redirect_urls — whitelisted OAuth/native redirect URLs for the Clerk instance. */
export declare function clerkListRedirectUrls(store: Store, input: Base & {
    limit?: number;
    offset?: number;
}): Promise<GuardedResponse>;
/** create_clerk_redirect_url — whitelist a redirect URL for OAuth/native auth flows. */
export declare function clerkCreateRedirectUrl(store: Store, input: Base & {
    url: string;
}): Promise<GuardedResponse>;
/** list_sentry_projects — Sentry projects visible within the mapped organization. */
export declare function sentryListProjects(store: Store, input: Base & {
    limit?: number;
    query?: string;
}): Promise<GuardedResponse>;
/** create_sentry_project — create an observability project for SDK event ingest. */
export declare function sentryCreateProject(store: Store, input: Base & {
    name: string;
    slug?: string;
    platform?: string;
    teamSlug?: string;
    defaultRules?: boolean;
}): Promise<GuardedResponse>;
/** list_sentry_client_keys — return public DSNs only; secret DSNs are stripped. */
export declare function sentryListClientKeys(store: Store, input: Base & {
    projectSlug?: string;
    status?: "active" | "inactive";
}): Promise<GuardedResponse>;
/** create_sentry_client_key — create a public DSN for wiring SENTRY_DSN. */
export declare function sentryCreateClientKey(store: Store, input: Base & {
    projectSlug?: string;
    name?: string;
    useCase?: string;
    rateLimitWindow?: number;
    rateLimitCount?: number;
}): Promise<GuardedResponse>;
/** list_sentry_releases — release records for the mapped Sentry organization. */
export declare function sentryListReleases(store: Store, input: Base & {
    query?: string;
}): Promise<GuardedResponse>;
/** create_sentry_release — create a version marker Sentry can correlate to issues. */
export declare function sentryCreateRelease(store: Store, input: Base & {
    version: string;
    projects?: string[];
    ref?: string;
    url?: string;
    dateReleased?: string;
}): Promise<GuardedResponse>;
/** list_sentry_deploys — deploy markers for a Sentry release. */
export declare function sentryListDeploys(store: Store, input: Base & {
    version: string;
}): Promise<GuardedResponse>;
/** create_sentry_deploy — record that a release reached an environment. */
export declare function sentryCreateDeploy(store: Store, input: Base & {
    version: string;
    deployEnvironment: string;
    name?: string;
    url?: string;
    dateStarted?: string;
    dateFinished?: string;
    projects?: string[];
}): Promise<GuardedResponse>;
/** list_posthog_projects — PostHog projects visible in the mapped organization. */
export declare function posthogListProjects(store: Store, input: Base & {
    limit?: number;
    search?: string;
}): Promise<GuardedResponse>;
/** get_posthog_project_env — return client-safe env wiring for a mapped project. */
export declare function posthogGetProjectEnv(store: Store, input: Base & {
    projectId?: string;
}): Promise<GuardedResponse>;
/** create_posthog_project — create an analytics project and return NEXT_PUBLIC_POSTHOG_* wiring. */
export declare function posthogCreateProject(store: Store, input: Base & {
    name: string;
    productDescription?: string;
    appUrls?: string[];
    timezone?: string;
    sessionRecording?: boolean;
}): Promise<GuardedResponse>;
/** list_posthog_feature_flags — feature flags for the mapped PostHog project. */
export declare function posthogListFeatureFlags(store: Store, input: Base & {
    projectId?: string;
    limit?: number;
    search?: string;
    active?: "STALE" | "false" | "true";
    type?: "boolean" | "experiment" | "multivariant" | "remote_config";
}): Promise<GuardedResponse>;
/** create_posthog_feature_flag — create a feature flag, inactive by default. */
export declare function posthogCreateFeatureFlag(store: Store, input: Base & {
    projectId?: string;
    key: string;
    name?: string;
    active?: boolean;
    filters?: Record<string, unknown>;
    tags?: string[];
    isRemoteConfiguration?: boolean;
}): Promise<GuardedResponse>;
/** list_resend_domains — email domains visible to the API key. */
export declare function resendListDomains(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
/** create_resend_domain — create a sending domain and return DNS records to set. */
export declare function resendCreateDomain(store: Store, input: Base & {
    name: string;
}): Promise<GuardedResponse>;
/** verify_resend_domain — start Resend's asynchronous DNS verification cycle. */
export declare function resendVerifyDomain(store: Store, input: Base & {
    domainId: string;
}): Promise<GuardedResponse>;
/** send_resend_email — outbound email reaches users and is always treated live. */
export declare function resendSendEmail(store: Store, input: Base & {
    from?: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
}): Promise<GuardedResponse>;
/** list_twilio_phone_numbers — communication numbers visible to the account. */
export declare function twilioListPhoneNumbers(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
/** update_twilio_phone_number_webhooks — wire inbound SMS/voice URLs. */
export declare function twilioUpdatePhoneNumberWebhooks(store: Store, input: Base & {
    phoneNumberSid: string;
    smsUrl?: string;
    voiceUrl?: string;
}): Promise<GuardedResponse>;
/** send_twilio_sms — outbound messages cost money and are always treated live. */
export declare function twilioSendSms(store: Store, input: Base & {
    to: string;
    body: string;
    from?: string;
    messagingServiceSid?: string;
    statusCallback?: string;
}): Promise<GuardedResponse>;
/** create_twilio_call — outbound voice calls cost money and are always treated live. */
export declare function twilioCreateCall(store: Store, input: Base & {
    to: string;
    url: string;
    from?: string;
    statusCallback?: string;
}): Promise<GuardedResponse>;
/** get_latest_deployment_logs — convenience; latest deployment for the provider. */
export declare function latestDeploymentLogs(store: Store, input: Base & {
    provider?: ProviderId;
}): Promise<GuardedResponse>;
/**
 * get_app_logs — generic entry point. With an explicit `provider`, reads that
 * provider only; otherwise reads every mapped provider that supports logs
 * (Vercel prioritized). Each provider read is independently policy-checked and
 * audited; results are returned per provider.
 */
export declare function appLogs(store: Store, input: Base & {
    provider?: ProviderId;
    deploymentId?: string;
    since?: string;
    limit?: number;
}): Promise<{
    status: "ok";
    project: string;
    environment: string;
    providers: GuardedResponse[];
    limitation?: string;
}>;
export declare function supabaseListProjects(store: Store, input: Base): Promise<GuardedResponse>;
export declare function supabaseProjectContext(store: Store, input: Base): Promise<GuardedResponse>;
export declare function supabaseQuery(store: Store, input: Base & {
    sql: string;
}): Promise<GuardedResponse>;
export declare function supabaseLogs(store: Store, input: Base & {
    service?: string;
    since?: string;
    limit?: number;
}): Promise<GuardedResponse>;
export declare function supabaseApplyMigration(store: Store, input: Base & {
    name: string;
    sql: string;
}): Promise<GuardedResponse>;
export declare function stripeListProducts(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
export declare function stripeListCustomers(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
export declare function stripeListSubscriptions(store: Store, input: Base & {
    limit?: number;
    status?: string;
}): Promise<GuardedResponse>;
export declare function stripeListInvoices(store: Store, input: Base & {
    limit?: number;
    customer?: string;
}): Promise<GuardedResponse>;
export declare function stripeCreateProduct(store: Store, input: Base & {
    name: string;
    description?: string;
}): Promise<GuardedResponse>;
/**
 * create_stripe_webhook — create a webhook endpoint (capability "write").
 * Stripe returns the whsec_ signing secret ONLY at creation; it goes to the
 * tool result and is redacted from audit + DashClaw by the sanitizer.
 */
export declare function stripeCreateWebhook(store: Store, input: Base & {
    url: string;
    enabledEvents: string[];
    description?: string;
}): Promise<GuardedResponse>;
/** list_stripe_webhooks — webhook endpoints for the environment's mode (read). */
export declare function stripeListWebhooks(store: Store, input: Base & {
    limit?: number;
}): Promise<GuardedResponse>;
export declare function stripeCreatePrice(store: Store, input: Base & {
    product: string;
    currency: string;
    unitAmount: number;
    recurringInterval?: "day" | "week" | "month" | "year";
}): Promise<GuardedResponse>;
export {};

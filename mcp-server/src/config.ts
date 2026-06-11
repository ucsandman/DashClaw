import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Store } from "./storage.js";
import {
  addEnvironment,
  createProject,
  mapProviderResource,
  setPolicyRule,
  writeProjectMemory,
} from "./service.js";
import type { Capability, EnvironmentKind, PolicyRule, ProviderId, ProviderResource } from "./types.js";
import type { RegistrantContact } from "./providers/namecheap.js";
import { OfflocalError } from "./util.js";

/**
 * Declarative config (`.offlocal/config.yaml`) — the file that sells the mental
 * model. It maps projects → environments → provider resources, and declares
 * policy as `require_approval` / `block` lists. `offlocal init` seeds the
 * runtime state (state.json) from it; state.json remains the source of truth.
 * Seeding skips projects whose slug already exists, so re-running is safe.
 *
 * Format:
 *   projects:
 *     your-project:
 *       environments:
 *         staging:
 *           github:   { repo: your-org/your-repo }
 *           vercel:   { project: your-staging-vercel-project }
 *           supabase: { project_ref: your_staging_project_ref }
 *           stripe:   { mode: test }
 *   policy:
 *     require_approval: [ vercel.deploy, vercel.env.write, supabase.write, stripe.write ]
 *     block:            [ supabase.destructive_sql, provider.delete ]
 */

interface ConfigEnvironment {
  kind?: EnvironmentKind;
  github?: { repo: string; connection_id?: string };
  vercel?: { project: string; team_id?: string; connection_id?: string };
  supabase?: { project_ref: string; connection_id?: string };
  stripe?: { mode: "test" | "live"; connection_id?: string };
  railway?: { project_id: string; environment_id?: string; service_id?: string; connection_id?: string };
  upstash?: {
    database_id: string;
    api_host?: string;
    qstash_url?: string;
    qstash_token_env_var?: string;
    qstash_current_signing_key_env_var?: string;
    qstash_next_signing_key_env_var?: string;
    connection_id?: string;
  };
  cloudflare_r2?: {
    account_id: string;
    bucket_name?: string;
    api_host?: string;
    jurisdiction?: "default" | "eu" | "fedramp";
    access_key_id_env_var?: string;
    secret_access_key_env_var?: string;
    public_url?: string;
    connection_id?: string;
  };
  sentry?: { organization_slug: string; project_slug?: string; team_slug?: string; connection_id?: string };
  posthog?: { organization_id: string; project_id?: string; api_host?: string; ingest_host?: string; connection_id?: string };
  resend?: { domain: string; default_from?: string; connection_id?: string };
  twilio?: { account_sid: string; from_number?: string; messaging_service_sid?: string; connection_id?: string };
  clerk?: {
    publishable_key: string;
    api_host?: string;
    frontend_api_url?: string;
    sign_in_url?: string;
    sign_up_url?: string;
    sign_in_fallback_redirect_url?: string;
    sign_up_fallback_redirect_url?: string;
    connection_id?: string;
  };
}

interface ConfigMemory {
  environment?: string;
  note: string;
  tags?: string[];
}

interface ConfigProject {
  name?: string;
  description?: string;
  environments?: Record<string, ConfigEnvironment>;
  memory?: ConfigMemory[];
}

interface ConfigRegistrant {
  first_name: string;
  last_name: string;
  address1: string;
  address2?: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  /** Format +NNN.NNNNNNNNNN, e.g. "+1.5551234567". */
  phone: string;
  email_address: string;
  organization?: string;
}

interface OfflocalConfig {
  projects?: Record<string, ConfigProject>;
  policy?: {
    require_approval?: string[];
    block?: string[];
  };
  /** Account-level Namecheap settings; registrant contact used for domain purchases. */
  namecheap?: {
    registrant?: ConfigRegistrant;
  };
}

export function loadConfig(path: string): OfflocalConfig | undefined {
  if (!existsSync(path)) return undefined;
  const parsed = parseYaml(readFileSync(path, "utf8")) ?? {};
  return validateConfig(parsed);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalObject(value: unknown, field: string): void {
  if (value !== undefined && !isPlainObject(value)) {
    throw new OfflocalError(`Invalid config: ${field} must be an object.`);
  }
}

function optionalStringArray(value: unknown, field: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new OfflocalError(`Invalid config: ${field} must be an array of strings.`);
  }
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new OfflocalError(`Invalid config: ${field} must be a string.`);
  }
}

function requiredString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OfflocalError(`Invalid config: ${field} must be a non-empty string.`);
  }
}

function optionalConnectionId(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
    throw new OfflocalError(`Invalid config: ${field} must be a non-empty string when provided.`);
  }
}

function validateProviderBlock(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new OfflocalError(`Invalid config: ${field} must be an object.`);
  }
  optionalConnectionId(value.connection_id, `${field}.connection_id`);
  return value;
}

function validateEnvironmentConfig(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new OfflocalError(`Invalid config: ${field} must be an object.`);
  }
  if (value.kind !== undefined && value.kind !== "development" && value.kind !== "staging" && value.kind !== "production") {
    throw new OfflocalError(`Invalid config: ${field}.kind must be development, staging, or production.`);
  }

  const github = validateProviderBlock(value.github, `${field}.github`);
  if (github) requiredString(github.repo, `${field}.github.repo`);

  const vercel = validateProviderBlock(value.vercel, `${field}.vercel`);
  if (vercel) {
    requiredString(vercel.project, `${field}.vercel.project`);
    optionalString(vercel.team_id, `${field}.vercel.team_id`);
  }

  const supabase = validateProviderBlock(value.supabase, `${field}.supabase`);
  if (supabase) requiredString(supabase.project_ref, `${field}.supabase.project_ref`);

  const stripe = validateProviderBlock(value.stripe, `${field}.stripe`);
  if (stripe && stripe.mode !== "test" && stripe.mode !== "live") {
    throw new OfflocalError(`Invalid config: ${field}.stripe.mode must be "test" or "live".`);
  }

  const railway = validateProviderBlock(value.railway, `${field}.railway`);
  if (railway) {
    requiredString(railway.project_id, `${field}.railway.project_id`);
    optionalString(railway.environment_id, `${field}.railway.environment_id`);
    optionalString(railway.service_id, `${field}.railway.service_id`);
  }

  const upstash = validateProviderBlock(value.upstash, `${field}.upstash`);
  if (upstash) {
    requiredString(upstash.database_id, `${field}.upstash.database_id`);
    optionalString(upstash.api_host, `${field}.upstash.api_host`);
    optionalString(upstash.qstash_url, `${field}.upstash.qstash_url`);
    optionalString(upstash.qstash_token_env_var, `${field}.upstash.qstash_token_env_var`);
    optionalString(upstash.qstash_current_signing_key_env_var, `${field}.upstash.qstash_current_signing_key_env_var`);
    optionalString(upstash.qstash_next_signing_key_env_var, `${field}.upstash.qstash_next_signing_key_env_var`);
  }

  const cloudflareR2 = validateProviderBlock(value.cloudflare_r2, `${field}.cloudflare_r2`);
  if (cloudflareR2) {
    requiredString(cloudflareR2.account_id, `${field}.cloudflare_r2.account_id`);
    optionalString(cloudflareR2.bucket_name, `${field}.cloudflare_r2.bucket_name`);
    optionalString(cloudflareR2.api_host, `${field}.cloudflare_r2.api_host`);
    if (
      cloudflareR2.jurisdiction !== undefined &&
      cloudflareR2.jurisdiction !== "default" &&
      cloudflareR2.jurisdiction !== "eu" &&
      cloudflareR2.jurisdiction !== "fedramp"
    ) {
      throw new OfflocalError(`Invalid config: ${field}.cloudflare_r2.jurisdiction must be default, eu, or fedramp.`);
    }
    optionalString(cloudflareR2.access_key_id_env_var, `${field}.cloudflare_r2.access_key_id_env_var`);
    optionalString(cloudflareR2.secret_access_key_env_var, `${field}.cloudflare_r2.secret_access_key_env_var`);
    optionalString(cloudflareR2.public_url, `${field}.cloudflare_r2.public_url`);
  }

  const sentry = validateProviderBlock(value.sentry, `${field}.sentry`);
  if (sentry) {
    requiredString(sentry.organization_slug, `${field}.sentry.organization_slug`);
    optionalString(sentry.project_slug, `${field}.sentry.project_slug`);
    optionalString(sentry.team_slug, `${field}.sentry.team_slug`);
  }

  const posthog = validateProviderBlock(value.posthog, `${field}.posthog`);
  if (posthog) {
    requiredString(posthog.organization_id, `${field}.posthog.organization_id`);
    optionalString(posthog.project_id, `${field}.posthog.project_id`);
    optionalString(posthog.api_host, `${field}.posthog.api_host`);
    optionalString(posthog.ingest_host, `${field}.posthog.ingest_host`);
  }

  const resend = validateProviderBlock(value.resend, `${field}.resend`);
  if (resend) {
    requiredString(resend.domain, `${field}.resend.domain`);
    optionalString(resend.default_from, `${field}.resend.default_from`);
  }

  const twilio = validateProviderBlock(value.twilio, `${field}.twilio`);
  if (twilio) {
    requiredString(twilio.account_sid, `${field}.twilio.account_sid`);
    optionalString(twilio.from_number, `${field}.twilio.from_number`);
    optionalString(twilio.messaging_service_sid, `${field}.twilio.messaging_service_sid`);
  }

  const clerk = validateProviderBlock(value.clerk, `${field}.clerk`);
  if (clerk) {
    requiredString(clerk.publishable_key, `${field}.clerk.publishable_key`);
    optionalString(clerk.api_host, `${field}.clerk.api_host`);
    optionalString(clerk.frontend_api_url, `${field}.clerk.frontend_api_url`);
    optionalString(clerk.sign_in_url, `${field}.clerk.sign_in_url`);
    optionalString(clerk.sign_up_url, `${field}.clerk.sign_up_url`);
    optionalString(clerk.sign_in_fallback_redirect_url, `${field}.clerk.sign_in_fallback_redirect_url`);
    optionalString(clerk.sign_up_fallback_redirect_url, `${field}.clerk.sign_up_fallback_redirect_url`);
  }
}

function validateMemoryConfig(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new OfflocalError(`Invalid config: ${field} must be an object.`);
  }
  optionalString(value.environment, `${field}.environment`);
  requiredString(value.note, `${field}.note`);
  optionalStringArray(value.tags, `${field}.tags`);
}

function validateProjectConfig(value: unknown, slug: string): void {
  if (!isPlainObject(value)) {
    throw new OfflocalError(`Invalid config: projects.${slug} must be an object.`);
  }
  optionalString(value.name, `projects.${slug}.name`);
  optionalString(value.description, `projects.${slug}.description`);
  optionalObject(value.environments, `projects.${slug}.environments`);
  if (value.memory !== undefined && !Array.isArray(value.memory)) {
    throw new OfflocalError(`Invalid config: projects.${slug}.memory must be an array.`);
  }
  if (isPlainObject(value.environments)) {
    for (const [envName, env] of Object.entries(value.environments)) {
      validateEnvironmentConfig(env, `projects.${slug}.environments.${envName}`);
    }
  }
  if (Array.isArray(value.memory)) {
    value.memory.forEach((entry, index) => {
      validateMemoryConfig(entry, `projects.${slug}.memory[${index}]`);
    });
  }
}

function validateRegistrantConfig(value: unknown): void {
  if (!isPlainObject(value)) {
    throw new OfflocalError("Invalid config: namecheap.registrant must be an object.");
  }
  for (const field of [
    "first_name",
    "last_name",
    "address1",
    "city",
    "state_province",
    "postal_code",
    "country",
    "phone",
    "email_address",
  ]) {
    requiredString(value[field], `namecheap.registrant.${field}`);
  }
  optionalString(value.address2, "namecheap.registrant.address2");
  optionalString(value.organization, "namecheap.registrant.organization");
}

function validateConfig(value: unknown): OfflocalConfig {
  if (!isPlainObject(value)) {
    throw new OfflocalError("Invalid config: top-level config must be an object.");
  }
  optionalObject(value.projects, "projects");
  optionalObject(value.policy, "policy");
  optionalObject(value.namecheap, "namecheap");
  if (isPlainObject(value.namecheap) && value.namecheap.registrant !== undefined) {
    validateRegistrantConfig(value.namecheap.registrant);
  }
  if (isPlainObject(value.policy)) {
    optionalStringArray(value.policy.require_approval, "policy.require_approval");
    optionalStringArray(value.policy.block, "policy.block");
  }
  if (isPlainObject(value.projects)) {
    for (const [slug, project] of Object.entries(value.projects)) {
      validateProjectConfig(project, slug);
    }
  }
  for (const token of [
    ...(isPlainObject(value.policy) && Array.isArray(value.policy.require_approval) ? value.policy.require_approval : []),
    ...(isPlainObject(value.policy) && Array.isArray(value.policy.block) ? value.policy.block : []),
  ]) {
    if (!tokenToMatch(token)) {
      throw new OfflocalError(`Unknown policy token in config: ${token}.`);
    }
  }
  return value as OfflocalConfig;
}

/** Map a dotted policy token (e.g. "vercel.env.write") to a rule match. */
function tokenToMatch(token: string): { provider?: ProviderId; capability: Capability } | null {
  const parts = token.trim().split(".");
  const head = parts[0]!;
  const rest = parts.slice(1).join(".");
  const knownProviders: ProviderId[] = [
    "github",
    "vercel",
    "supabase",
    "stripe",
    "railway",
    "namecheap",
    "neon",
    "upstash",
    "cloudflare_r2",
    "sentry",
    "posthog",
    "resend",
    "twilio",
    "clerk",
  ];
  if (head !== "provider" && head !== "*" && !knownProviders.includes(head as ProviderId)) {
    return null;
  }
  const provider: ProviderId | undefined =
    head === "provider" || head === "*" ? undefined : (head as ProviderId);

  const capByToken: Record<string, Capability> = {
    deploy: "deploy",
    "env.write": "env_change",
    env_change: "env_change",
    write: "write",
    destructive_sql: "destructive_sql",
    delete: "delete",
    read: "read",
    purchase: "purchase",
  };
  // For "provider.delete" the action token is "delete"; for "vercel.deploy" it's "deploy".
  const capability = capByToken[rest] ?? capByToken[head];
  if (!capability) return null;
  return { provider, capability };
}

function environmentResource(provider: ProviderId, env: ConfigEnvironment): ProviderResource | null {
  switch (provider) {
    case "github": {
      if (!env.github) return null;
      const [owner, repo] = env.github.repo.split("/");
      if (!owner || !repo) {
        throw new OfflocalError(
          `Invalid github repo "${env.github.repo}" in config; expected owner/repo.`,
        );
      }
      return { provider, owner, repo };
    }
    case "vercel":
      if (!env.vercel) return null;
      if (!env.vercel.project?.trim()) {
        throw new OfflocalError("Invalid vercel project in config; expected a non-empty project id/name.");
      }
      return { provider, projectId: env.vercel.project, teamId: env.vercel.team_id };
    case "supabase":
      if (!env.supabase) return null;
      if (!env.supabase.project_ref?.trim()) {
        throw new OfflocalError("Invalid supabase project_ref in config; expected a non-empty project ref.");
      }
      return { provider, projectRef: env.supabase.project_ref };
    case "stripe":
      return env.stripe ? { provider, mode: env.stripe.mode } : null;
    case "railway":
      if (!env.railway) return null;
      if (!env.railway.project_id?.trim()) {
        throw new OfflocalError("Invalid railway project_id in config; expected a non-empty project id.");
      }
      return {
        provider,
        projectId: env.railway.project_id,
        environmentId: env.railway.environment_id,
        serviceId: env.railway.service_id,
      };
    case "upstash":
      if (!env.upstash) return null;
      if (!env.upstash.database_id?.trim()) {
        throw new OfflocalError("Invalid upstash database_id in config; expected a non-empty database id.");
      }
      return {
        provider,
        databaseId: env.upstash.database_id,
        apiHost: env.upstash.api_host,
        qstashUrl: env.upstash.qstash_url,
        qstashTokenEnvVar: env.upstash.qstash_token_env_var,
        qstashCurrentSigningKeyEnvVar: env.upstash.qstash_current_signing_key_env_var,
        qstashNextSigningKeyEnvVar: env.upstash.qstash_next_signing_key_env_var,
      };
    case "cloudflare_r2":
      if (!env.cloudflare_r2) return null;
      if (!env.cloudflare_r2.account_id?.trim()) {
        throw new OfflocalError("Invalid cloudflare_r2 account_id in config; expected a non-empty account id.");
      }
      return {
        provider,
        accountId: env.cloudflare_r2.account_id,
        bucketName: env.cloudflare_r2.bucket_name,
        apiHost: env.cloudflare_r2.api_host,
        jurisdiction: env.cloudflare_r2.jurisdiction,
        accessKeyIdEnvVar: env.cloudflare_r2.access_key_id_env_var,
        secretAccessKeyEnvVar: env.cloudflare_r2.secret_access_key_env_var,
        publicUrl: env.cloudflare_r2.public_url,
      };
    case "sentry":
      if (!env.sentry) return null;
      if (!env.sentry.organization_slug?.trim()) {
        throw new OfflocalError("Invalid sentry organization_slug in config; expected a non-empty organization slug.");
      }
      return {
        provider,
        organizationSlug: env.sentry.organization_slug,
        projectSlug: env.sentry.project_slug,
        teamSlug: env.sentry.team_slug,
      };
    case "posthog":
      if (!env.posthog) return null;
      if (!env.posthog.organization_id?.trim()) {
        throw new OfflocalError("Invalid posthog organization_id in config; expected a non-empty organization id.");
      }
      return {
        provider,
        organizationId: env.posthog.organization_id,
        projectId: env.posthog.project_id,
        apiHost: env.posthog.api_host,
        ingestHost: env.posthog.ingest_host,
      };
    case "twilio":
      if (!env.twilio) return null;
      if (!env.twilio.account_sid?.trim()) {
        throw new OfflocalError("Invalid twilio account_sid in config; expected a non-empty account SID.");
      }
      return {
        provider,
        accountSid: env.twilio.account_sid,
        fromNumber: env.twilio.from_number,
        messagingServiceSid: env.twilio.messaging_service_sid,
      };
    case "resend":
      if (!env.resend) return null;
      if (!env.resend.domain?.trim()) {
        throw new OfflocalError("Invalid resend domain in config; expected a non-empty domain.");
      }
      return {
        provider,
        domain: env.resend.domain,
        defaultFrom: env.resend.default_from,
      };
    case "clerk":
      if (!env.clerk) return null;
      if (!env.clerk.publishable_key?.trim()) {
        throw new OfflocalError("Invalid clerk publishable_key in config; expected a non-empty publishable key.");
      }
      return {
        provider,
        publishableKey: env.clerk.publishable_key,
        apiHost: env.clerk.api_host,
        frontendApiUrl: env.clerk.frontend_api_url,
        signInUrl: env.clerk.sign_in_url,
        signUpUrl: env.clerk.sign_up_url,
        signInFallbackRedirectUrl: env.clerk.sign_in_fallback_redirect_url,
        signUpFallbackRedirectUrl: env.clerk.sign_up_fallback_redirect_url,
      };
    // No config blocks for these yet; their provider phases add them.
    case "namecheap":
    case "neon":
      return null;
  }
}

function environmentConnectionId(provider: ProviderId, env: ConfigEnvironment): string | undefined {
  switch (provider) {
    case "github":
      return env.github?.connection_id;
    case "vercel":
      return env.vercel?.connection_id;
    case "supabase":
      return env.supabase?.connection_id;
    case "stripe":
      return env.stripe?.connection_id;
    case "railway":
      return env.railway?.connection_id;
    case "upstash":
      return env.upstash?.connection_id;
    case "cloudflare_r2":
      return env.cloudflare_r2?.connection_id;
    case "sentry":
      return env.sentry?.connection_id;
    case "posthog":
      return env.posthog?.connection_id;
    case "resend":
      return env.resend?.connection_id;
    case "twilio":
      return env.twilio?.connection_id;
    case "clerk":
      return env.clerk?.connection_id;
    case "namecheap":
    case "neon":
      return undefined;
  }
}

export interface SeedResult {
  createdProjects: string[];
  skippedProjects: string[];
  createdRules: number;
}

export function applyConfig(store: Store, config: OfflocalConfig): SeedResult {
  validateConfig(config);
  const result: SeedResult = { createdProjects: [], skippedProjects: [], createdRules: 0 };
  const providers: ProviderId[] = ["github", "vercel", "supabase", "stripe", "railway", "upstash", "cloudflare_r2", "sentry", "posthog", "resend", "twilio", "clerk"];

  for (const [slug, p] of Object.entries(config.projects ?? {})) {
    if (store.data.projects.some((x) => x.slug === slug)) {
      result.skippedProjects.push(slug);
      continue;
    }
    const project = createProject(store, { name: p.name ?? slug, slug, description: p.description });
    result.createdProjects.push(project.slug);

    for (const [envName, envCfg] of Object.entries(p.environments ?? {})) {
      addEnvironment(store, { project: project.slug, name: envName, kind: envCfg.kind });
      for (const provider of providers) {
        const resource = environmentResource(provider, envCfg);
        if (!resource) continue;
        mapProviderResource(store, {
          project: project.slug,
          environment: envName,
          provider,
          connectionId: environmentConnectionId(provider, envCfg),
          resource,
        });
      }
    }

    for (const m of p.memory ?? []) {
      writeProjectMemory(store, {
        project: project.slug,
        environment: m.environment,
        note: m.note,
        tags: m.tags,
      });
    }
  }

  // Policy: require_approval → approval scoped to production; block → block everywhere.
  // (Staging/dev keep the permissive built-in defaults, so test/staging stays usable.)
  for (const token of config.policy?.require_approval ?? []) {
    const match = tokenToMatch(token);
    if (!match) throw new OfflocalError(`Unknown policy token in config: ${token}.`);
    setPolicyRule(store, {
      effect: "approval_required",
      priority: 100,
      description: `config: require approval for ${token} in production`,
      match: { ...match, environmentKind: "production" } as PolicyRule["match"],
    });
    result.createdRules += 1;
  }
  for (const token of config.policy?.block ?? []) {
    const match = tokenToMatch(token);
    if (!match) throw new OfflocalError(`Unknown policy token in config: ${token}.`);
    setPolicyRule(store, {
      effect: "block",
      priority: 150,
      description: `config: block ${token} everywhere`,
      match: match as PolicyRule["match"],
    });
    result.createdRules += 1;
  }

  return result;
}

export function seedFromConfigFile(store: Store, path: string): SeedResult | undefined {
  const config = loadConfig(path);
  if (!config) return undefined;
  return applyConfig(store, config);
}

/**
 * Read the registrant contact for domain purchases from the config file at
 * call time (it is account data, not runtime state, so it never enters
 * state.json). Returns undefined when the file or block is absent.
 */
export function loadRegistrantContact(path: string): RegistrantContact | undefined {
  const config = loadConfig(path);
  const r = config?.namecheap?.registrant;
  if (!r) return undefined;
  return {
    firstName: r.first_name,
    lastName: r.last_name,
    address1: r.address1,
    address2: r.address2,
    city: r.city,
    stateProvince: r.state_province,
    postalCode: r.postal_code,
    country: r.country,
    phone: r.phone,
    emailAddress: r.email_address,
    organization: r.organization,
  };
}

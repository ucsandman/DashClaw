import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshStore, acmeConfig } from "./helpers.js";
import { applyConfig, loadConfig } from "../src/config.js";
import { checkPolicy, ensureConnection, listProviderMappings, listEnvironments } from "../src/service.js";

function writeTempConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "offlocal-config-test-"));
  const path = join(dir, "config.yaml");
  writeFileSync(path, contents);
  return path;
}

describe("config seeding", () => {
  it("init/applyConfig creates project, environments, mappings, rules and persists state", () => {
    const store = freshStore();
    const result = applyConfig(store, acmeConfig());

    expect(result.createdProjects).toEqual(["acme-crm"]);
    expect(result.createdRules).toBe(6); // 4 require_approval + 2 block

    expect(listEnvironments(store, "acme-crm").map((e) => e.name).sort()).toEqual([
      "production",
      "staging",
    ]);
    // 4 providers × 2 environments = 8 mappings.
    expect(listProviderMappings(store, "acme-crm")).toHaveLength(8);

    // State persisted to disk.
    expect(existsSync(store.paths.state)).toBe(true);
  });

  it("is idempotent — re-applying skips existing projects", () => {
    const store = freshStore();
    applyConfig(store, acmeConfig());
    const second = applyConfig(store, acmeConfig());
    expect(second.createdProjects).toEqual([]);
    expect(second.skippedProjects).toEqual(["acme-crm"]);
  });

  it("policy from config gates production but leaves staging permissive", () => {
    const store = freshStore();
    applyConfig(store, acmeConfig());

    // require_approval: supabase.write → production approval, staging allowed.
    expect(
      checkPolicy(store, { project: "acme-crm", environment: "production", provider: "supabase", capability: "write" }).effect,
    ).toBe("approval_required");
    expect(
      checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "supabase", capability: "write" }).effect,
    ).toBe("allow");

    // block: supabase.destructive_sql everywhere; provider.delete everywhere.
    expect(
      checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "supabase", capability: "destructive_sql" }).effect,
    ).toBe("block");
    expect(
      checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "github", capability: "delete" }).effect,
    ).toBe("block");
  });

  it("fails loudly when a provider mapping in config is malformed", () => {
    const store = freshStore();
    const config = acmeConfig();
    config.projects["acme-crm"]!.environments!.staging.github = { repo: "missing-slash" };

    expect(() => applyConfig(store, config)).toThrow(/github repo.*owner\/repo/i);
  });

  it("rejects malformed nested provider blocks before mutating state", () => {
    const store = freshStore();
    const config = acmeConfig() as any;
    config.projects["acme-crm"].environments.staging.github = "acme/acme-crm";

    expect(() => applyConfig(store, config)).toThrow(/projects\.acme-crm\.environments\.staging\.github.*object/i);
    expect(store.data.projects).toHaveLength(0);
    expect(store.data.environments).toHaveLength(0);
    expect(store.data.mappings).toHaveLength(0);
  });

  it("rejects malformed memory entries before mutating state", () => {
    const store = freshStore();
    const config = acmeConfig() as any;
    config.projects["acme-crm"].memory = [{ environment: "staging", tags: ["incident"] }];

    expect(() => applyConfig(store, config)).toThrow(/projects\.acme-crm\.memory\[0\]\.note/i);
    expect(store.data.projects).toHaveLength(0);
    expect(store.data.environments).toHaveLength(0);
    expect(store.data.mappings).toHaveLength(0);
  });

  it("rejects invalid connection ids from config before mutating state", () => {
    const store = freshStore();
    const config = acmeConfig() as any;
    config.projects["acme-crm"].environments.staging.vercel.connection_id = "";

    expect(() => applyConfig(store, config)).toThrow(/vercel\.connection_id.*non-empty string/i);
    expect(store.data.projects).toHaveLength(0);
    expect(store.data.environments).toHaveLength(0);
    expect(store.data.mappings).toHaveLength(0);
  });

  it("seeds provider mappings with explicit connection ids from config", () => {
    const store = freshStore();
    const connectionId = ensureConnection(store, "github");
    const config = acmeConfig();
    config.projects["acme-crm"]!.environments!.staging.github = {
      repo: "acme/acme-crm",
      connection_id: connectionId,
    } as any;

    applyConfig(store, config);

    expect(
      listProviderMappings(store, "acme-crm").find((m) => m.environment === "staging" && m.provider === "github"),
    ).toMatchObject({ connectionId });
  });

  it("seeds Twilio communication mapping from config", () => {
    const store = freshStore();
    const path = writeTempConfig(`
projects:
  acme-comms:
    environments:
      staging:
        kind: staging
        twilio:
          account_sid: AC11111111111111111111111111111111
          from_number: "+15551230000"
          messaging_service_sid: MG11111111111111111111111111111111
policy:
  require_approval:
    - twilio.write
`);
    const config = loadConfig(path)!;

    applyConfig(store, config);

    expect(listProviderMappings(store, "acme-comms")).toEqual([
      expect.objectContaining({
        provider: "twilio",
        resource: expect.objectContaining({
          provider: "twilio",
          accountSid: "AC11111111111111111111111111111111",
          fromNumber: "+15551230000",
          messagingServiceSid: "MG11111111111111111111111111111111",
        }),
      }),
    ]);
    expect(
      checkPolicy(store, { project: "acme-comms", environment: "staging", provider: "twilio" as any, capability: "write" }).effect,
    ).toBe("allow");
  });

  it("seeds Resend email mapping from config", () => {
    const store = freshStore();
    const path = writeTempConfig(`
projects:
  acme-email:
    environments:
      staging:
        kind: staging
        resend:
          domain: example.com
          default_from: Acme <onboarding@example.com>
policy:
  require_approval:
    - resend.write
`);
    const config = loadConfig(path)!;

    applyConfig(store, config);

    expect(listProviderMappings(store, "acme-email")).toEqual([
      expect.objectContaining({
        provider: "resend",
        resource: expect.objectContaining({
          provider: "resend",
          domain: "example.com",
          defaultFrom: "Acme <onboarding@example.com>",
        }),
      }),
    ]);
    expect(
      checkPolicy(store, { project: "acme-email", environment: "staging", provider: "resend" as any, capability: "write" }).effect,
    ).toBe("allow");
  });

  it("seeds Sentry observability mapping from config", () => {
    const store = freshStore();
    const path = writeTempConfig(`
projects:
  acme-observability:
    environments:
      staging:
        kind: staging
        sentry:
          organization_slug: acme-org
          project_slug: acme-api
          team_slug: platform
policy:
  require_approval:
    - sentry.write
`);
    const config = loadConfig(path)!;

    applyConfig(store, config);

    expect(listProviderMappings(store, "acme-observability")).toEqual([
      expect.objectContaining({
        provider: "sentry",
        resource: expect.objectContaining({
          provider: "sentry",
          organizationSlug: "acme-org",
          projectSlug: "acme-api",
          teamSlug: "platform",
        }),
      }),
    ]);
    expect(
      checkPolicy(store, { project: "acme-observability", environment: "staging", provider: "sentry" as any, capability: "write" }).effect,
    ).toBe("allow");
  });

  it("seeds PostHog analytics mapping from config", () => {
    const store = freshStore();
    const path = writeTempConfig(`
projects:
  acme-analytics:
    environments:
      staging:
        kind: staging
        posthog:
          organization_id: org_123
          project_id: "42"
          api_host: https://eu.posthog.com
          ingest_host: https://eu.i.posthog.com
policy:
  require_approval:
    - posthog.write
`);
    const config = loadConfig(path)!;

    applyConfig(store, config);

    expect(listProviderMappings(store, "acme-analytics")).toEqual([
      expect.objectContaining({
        provider: "posthog",
        resource: expect.objectContaining({
          provider: "posthog",
          organizationId: "org_123",
          projectId: "42",
          apiHost: "https://eu.posthog.com",
          ingestHost: "https://eu.i.posthog.com",
        }),
      }),
    ]);
    expect(
      checkPolicy(store, { project: "acme-analytics", environment: "staging", provider: "posthog" as any, capability: "write" }).effect,
    ).toBe("allow");
  });

  it("seeds Upstash Redis mapping from config", () => {
    const store = freshStore();
    const path = writeTempConfig(`
projects:
  acme-cache:
    environments:
      staging:
        kind: staging
        upstash:
          database_id: db_123
          api_host: https://api.upstash.com
          qstash_url: https://qstash.upstash.io
          qstash_token_env_var: QSTASH_TOKEN
          qstash_current_signing_key_env_var: QSTASH_CURRENT_SIGNING_KEY
          qstash_next_signing_key_env_var: QSTASH_NEXT_SIGNING_KEY
policy:
  require_approval:
    - upstash.env_change
`);
    const config = loadConfig(path)!;

    applyConfig(store, config);

    expect(listProviderMappings(store, "acme-cache")).toEqual([
      expect.objectContaining({
        provider: "upstash",
        resource: expect.objectContaining({
          provider: "upstash",
          databaseId: "db_123",
          apiHost: "https://api.upstash.com",
          qstashUrl: "https://qstash.upstash.io",
          qstashTokenEnvVar: "QSTASH_TOKEN",
          qstashCurrentSigningKeyEnvVar: "QSTASH_CURRENT_SIGNING_KEY",
          qstashNextSigningKeyEnvVar: "QSTASH_NEXT_SIGNING_KEY",
        }),
      }),
    ]);
    expect(
      checkPolicy(store, { project: "acme-cache", environment: "staging", provider: "upstash" as any, capability: "env_change" }).effect,
    ).toBe("allow");
  });

  it("seeds Clerk auth mapping from config", () => {
    const store = freshStore();
    const path = writeTempConfig(`
projects:
  acme-auth:
    environments:
      staging:
        kind: staging
        clerk:
          publishable_key: pk_test_public
          sign_in_url: /sign-in
          sign_up_url: /sign-up
          sign_in_fallback_redirect_url: /dashboard
          sign_up_fallback_redirect_url: /dashboard
policy:
  require_approval:
    - clerk.env_change
`);
    const config = loadConfig(path)!;

    applyConfig(store, config);

    expect(listProviderMappings(store, "acme-auth")).toEqual([
      expect.objectContaining({
        provider: "clerk",
        resource: expect.objectContaining({
          provider: "clerk",
          publishableKey: "pk_test_public",
          signInUrl: "/sign-in",
          signUpUrl: "/sign-up",
          signInFallbackRedirectUrl: "/dashboard",
          signUpFallbackRedirectUrl: "/dashboard",
        }),
      }),
    ]);
    expect(
      checkPolicy(store, { project: "acme-auth", environment: "staging", provider: "clerk" as any, capability: "env_change" }).effect,
    ).toBe("allow");
  });

  it("seeds Cloudflare R2 object storage mapping from config", () => {
    const store = freshStore();
    const path = writeTempConfig(`
projects:
  acme-storage:
    environments:
      staging:
        kind: staging
        cloudflare_r2:
          account_id: acc_123
          bucket_name: acme-assets
          api_host: https://api.cloudflare.com/client/v4
          jurisdiction: default
          access_key_id_env_var: R2_ACCESS_KEY_ID
          secret_access_key_env_var: R2_SECRET_ACCESS_KEY
          public_url: https://assets.acme.example
policy:
  require_approval:
    - cloudflare_r2.env_change
`);
    const config = loadConfig(path)!;

    applyConfig(store, config);

    expect(listProviderMappings(store, "acme-storage")).toEqual([
      expect.objectContaining({
        provider: "cloudflare_r2",
        resource: expect.objectContaining({
          provider: "cloudflare_r2",
          accountId: "acc_123",
          bucketName: "acme-assets",
          apiHost: "https://api.cloudflare.com/client/v4",
          jurisdiction: "default",
          accessKeyIdEnvVar: "R2_ACCESS_KEY_ID",
          secretAccessKeyEnvVar: "R2_SECRET_ACCESS_KEY",
          publicUrl: "https://assets.acme.example",
        }),
      }),
    ]);
    expect(
      checkPolicy(store, { project: "acme-storage", environment: "staging", provider: "cloudflare_r2" as any, capability: "env_change" }).effect,
    ).toBe("allow");
  });

  it("fails loudly when config references a missing provider connection", () => {
    const store = freshStore();
    const config = acmeConfig();
    config.projects["acme-crm"]!.environments!.staging.github = {
      repo: "acme/acme-crm",
      connection_id: "conn_missing",
    } as any;

    expect(() => applyConfig(store, config)).toThrow(/connection.*not found/i);
  });

  it("fails loudly when a policy token in config is unknown", () => {
    const store = freshStore();
    const config = acmeConfig();
    config.policy.require_approval = ["vercel.fly-to-mars"];

    expect(() => applyConfig(store, config)).toThrow(/unknown policy token.*vercel\.fly-to-mars/i);
    expect(store.data.projects).toHaveLength(0);
    expect(store.data.environments).toHaveLength(0);
    expect(store.data.mappings).toHaveLength(0);
  });

  it("fails loudly when config yaml is not an object", () => {
    const path = writeTempConfig("- just\n- a list\n");

    expect(() => loadConfig(path)).toThrow(/config.*object/i);
  });

  it("fails loudly when policy lists are not arrays", () => {
    const store = freshStore();
    const config = acmeConfig() as any;
    config.policy.require_approval = "vercel.deploy";

    expect(() => applyConfig(store, config)).toThrow(/policy\.require_approval.*array/i);
  });

  it("fails loudly when project environments is not an object", () => {
    const store = freshStore();
    const config = acmeConfig() as any;
    config.projects["acme-crm"].environments = ["staging"];

    expect(() => applyConfig(store, config)).toThrow(/projects\.acme-crm\.environments.*object/i);
  });

  it("fails loudly when project memory is not an array", () => {
    const store = freshStore();
    const config = acmeConfig() as any;
    config.projects["acme-crm"].memory = { note: "not a list" };

    expect(() => applyConfig(store, config)).toThrow(/projects\.acme-crm\.memory.*array/i);
  });
});

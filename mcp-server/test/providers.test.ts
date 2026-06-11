import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { freshStore, seedAcme } from "./helpers.js";
import * as pa from "../src/provider-actions.js";
import { defaultEnvVar } from "../src/providers/auth.js";
import { listAuditLog, listPendingApprovals, mapProviderResource, setPolicyRule } from "../src/service.js";
import type { Store } from "../src/storage.js";

/**
 * These tests exercise the guarded provider flow with a mocked global fetch, so
 * no real network calls happen. The key assertions are:
 *   - allowed actions EXECUTE (fetch is called) and audit "success";
 *   - approval_required / blocked actions DO NOT execute (fetch not called) and
 *     audit "not_executed".
 */

let fetchMock: ReturnType<typeof vi.fn>;
let dashclawDecision: Record<string, unknown>;

function mockOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function dashclawRoute(url: string): Response | undefined {
  if (url === "https://dashclaw.example/api/guard") {
    return mockOk(dashclawDecision);
  }
  if (url.startsWith("https://dashclaw.example/api/actions/") && url.endsWith("/outcome")) {
    return mockOk({ ok: true });
  }
  return undefined;
}

function withDashclawRoute(providerRoute: (url: string, init?: any) => Response | Promise<Response>) {
  return async (url: string, init?: any) => dashclawRoute(url) ?? providerRoute(url, init);
}

function setDashclawDecision(decision: "allow" | "block" | "require_approval", suffix = decision) {
  dashclawDecision = {
    decision,
    reason: `DashClaw ${decision}`,
    decision_id: `gd_${suffix}`,
    action_id: `act_${suffix}`,
  };
}

beforeEach(() => {
  process.env.DASHCLAW_BASE_URL = "https://dashclaw.example";
  process.env.DASHCLAW_API_KEY = "dc_test";
  setDashclawDecision("allow");
  fetchMock = vi.fn(withDashclawRoute(() => mockOk({ id: "obj_123", name: "Test", active: true, created: 1 })));
  vi.stubGlobal("fetch", fetchMock);
  process.env.STRIPE_TEST_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_LIVE_SECRET_KEY = "sk_live_dummy";
  process.env.GITHUB_TOKEN = "gh_dummy";
  process.env.VERCEL_TOKEN = "vc_dummy";
  process.env.SUPABASE_ACCESS_TOKEN = "sb_dummy";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CUSTOM_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.CUSTOM_VERCEL_TOKEN;
  delete process.env.CUSTOM_STRIPE_TEST_KEY;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.SENTRY_AUTH_TOKEN;
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  delete process.env.UPSTASH_EMAIL;
  delete process.env.UPSTASH_API_KEY;
  delete process.env.QSTASH_TOKEN;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.DASHCLAW_BASE_URL;
  delete process.env.DASHCLAW_API_KEY;
});

function lastAudit(store: Store) {
  return listAuditLog(store, { project: "acme-crm" })[0];
}

function providerCalls() {
  return fetchMock.mock.calls.filter(([url]) => typeof url === "string" && !url.startsWith("https://dashclaw.example"));
}

describe("provider auth defaults", () => {
  it("returns explicit env vars for non-core providers", () => {
    expect(defaultEnvVar("namecheap")).toBe("NAMECHEAP_API_KEY");
    expect(defaultEnvVar("neon")).toBe("NEON_API_KEY");
    expect(defaultEnvVar("twilio")).toBe("TWILIO_AUTH_TOKEN");
    expect(defaultEnvVar("resend")).toBe("RESEND_API_KEY");
    expect(defaultEnvVar("sentry")).toBe("SENTRY_AUTH_TOKEN");
    expect(defaultEnvVar("posthog")).toBe("POSTHOG_PERSONAL_API_KEY");
    expect(defaultEnvVar("upstash")).toBe("UPSTASH_API_KEY");
    expect(defaultEnvVar("clerk")).toBe("CLERK_SECRET_KEY");
    expect(defaultEnvVar("cloudflare_r2")).toBe("CLOUDFLARE_API_TOKEN");
  });
});

describe("Sentry", () => {
  function mapSentry(store: Store, projectSlug?: string) {
    mapProviderResource(store, {
      environment: "staging",
      provider: "sentry" as any,
      resource: {
        provider: "sentry",
        organizationSlug: "acme-org",
        projectSlug,
        teamSlug: "platform",
      },
    });
  }

  it("lists organization projects through the guarded read path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store);
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          id: "6758470122493650",
          slug: "acme-api",
          name: "Acme API",
          platform: "node-express",
          team: { slug: "platform" },
        },
      ]),
    );

    const res = await pa.sentryListProjects(store, { environment: "staging", limit: 1, query: "api" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ id: "6758470122493650", slug: "acme-api", name: "Acme API" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sentry.io/api/0/organizations/acme-org/projects/?per_page=1&query=api",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sntrys_dummy" }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "sentry", tool: "list_sentry_projects" });
  });

  it("creates a team Sentry project as a governed env change", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store);
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://sentry.io/api/0/teams/acme-org/platform/projects/");
        expect(JSON.parse(init.body)).toEqual({
          name: "Acme API",
          slug: "acme-api",
          platform: "node-express",
          default_rules: false,
        });
        return mockOk({ id: "6758470122493650", slug: "acme-api", name: "Acme API", platform: "node-express" });
      }),
    );

    const res = await pa.sentryCreateProject(store, {
      environment: "staging",
      name: "Acme API",
      slug: "acme-api",
      platform: "node-express",
      defaultRules: false,
    });

    expect(res.status).toBe("ok");
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"sentry"');
    expect(guardBody).toContain('"capability":"env_change"');
  });

  it("lists client keys without exposing Sentry secret DSNs", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store, "acme-api");
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          id: "key_123",
          name: "Browser",
          public: "pub_123",
          secret: "sec_123",
          isActive: true,
          dsn: {
            public: "https://pub_123@o1.ingest.sentry.io/450",
            secret: "https://pub_123:sec_123@o1.ingest.sentry.io/450",
          },
        },
      ]),
    );

    const res = await pa.sentryListClientKeys(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({
        id: "key_123",
        name: "Browser",
        publicKey: "pub_123",
        publicDsn: "https://pub_123@o1.ingest.sentry.io/450",
      }),
    ]);
    expect(JSON.stringify((res as any).data)).not.toContain("sec_123");
    expect(JSON.stringify(lastAudit(store))).not.toContain("sec_123");
  });

  it("creates a client key for SENTRY_DSN wiring without leaking secret DSNs", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store, "acme-api");
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://sentry.io/api/0/projects/acme-org/acme-api/keys/");
        expect(JSON.parse(init.body)).toEqual({
          name: "web",
          useCase: "user",
          rateLimit: { window: 7200, count: 1000 },
        });
        return mockOk({
          id: "key_123",
          name: "web",
          public: "pub_123",
          secret: "sec_123",
          isActive: true,
          dsn: {
            public: "https://pub_123@o1.ingest.sentry.io/450",
            secret: "https://pub_123:sec_123@o1.ingest.sentry.io/450",
          },
        });
      }),
    );

    const res = await pa.sentryCreateClientKey(store, {
      environment: "staging",
      name: "web",
      useCase: "user",
      rateLimitWindow: 7200,
      rateLimitCount: 1000,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({ id: "key_123", publicDsn: "https://pub_123@o1.ingest.sentry.io/450" });
    expect(JSON.stringify((res as any).data)).not.toContain("sec_123");
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).not.toContain("sec_123");
    expect(JSON.stringify(lastAudit(store))).not.toContain("sec_123");
  });

  it("lists Sentry releases through the guarded read path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store, "acme-api");
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          id: 2,
          version: "acme-api@abc123",
          shortVersion: "abc123",
          ref: "abc123",
          deployCount: 1,
          projects: [{ name: "Acme API", slug: "acme-api" }],
        },
      ]),
    );

    const res = await pa.sentryListReleases(store, { environment: "staging", query: "acme-api@" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({
        id: "2",
        version: "acme-api@abc123",
        projectSlugs: ["acme-api"],
        deployCount: 1,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sentry.io/api/0/organizations/acme-org/releases/?query=acme-api%40",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sntrys_dummy" }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "sentry", tool: "list_sentry_releases" });
  });

  it("creates a Sentry release for the mapped project through a governed write path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store, "acme-api");
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://sentry.io/api/0/organizations/acme-org/releases/");
        expect(JSON.parse(init.body)).toEqual({
          version: "acme-api@abc123",
          projects: ["acme-api"],
          ref: "abc123",
          url: "https://github.com/acme/api/commit/abc123",
          dateReleased: "2026-06-10T16:00:00.000Z",
        });
        return mockOk({ id: 2, version: "acme-api@abc123", ref: "abc123", projects: [{ slug: "acme-api" }] });
      }),
    );

    const res = await pa.sentryCreateRelease(store, {
      environment: "staging",
      version: "acme-api@abc123",
      ref: "abc123",
      url: "https://github.com/acme/api/commit/abc123",
      dateReleased: "2026-06-10T16:00:00.000Z",
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({ version: "acme-api@abc123", projectSlugs: ["acme-api"] });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"sentry"');
    expect(guardBody).toContain('"capability":"write"');
  });

  it("creates a Sentry deploy marker through the guarded deploy path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store, "acme-api");
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://sentry.io/api/0/organizations/acme-org/releases/acme-api%40abc123/deploys/");
        expect(JSON.parse(init.body)).toEqual({
          environment: "production",
          name: "vercel dpl_123",
          url: "https://acme.example.com",
          dateStarted: "2026-06-10T15:55:00.000Z",
          dateFinished: "2026-06-10T16:00:00.000Z",
          projects: ["acme-api"],
        });
        return mockOk({
          id: "dep_123",
          environment: "production",
          name: "vercel dpl_123",
          url: "https://acme.example.com",
          dateStarted: "2026-06-10T15:55:00.000Z",
          dateFinished: "2026-06-10T16:00:00.000Z",
        });
      }),
    );

    const res = await pa.sentryCreateDeploy(store, {
      environment: "staging",
      version: "acme-api@abc123",
      deployEnvironment: "production",
      name: "vercel dpl_123",
      url: "https://acme.example.com",
      dateStarted: "2026-06-10T15:55:00.000Z",
      dateFinished: "2026-06-10T16:00:00.000Z",
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({ id: "dep_123", environment: "production", name: "vercel dpl_123" });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"sentry"');
    expect(guardBody).toContain('"capability":"deploy"');
  });

  it("lists deploy markers for a Sentry release", async () => {
    const store = freshStore();
    seedAcme(store);
    mapSentry(store, "acme-api");
    process.env.SENTRY_AUTH_TOKEN = "sntrys_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          id: "dep_123",
          environment: "production",
          name: "vercel dpl_123",
          url: "https://acme.example.com",
          dateStarted: "2026-06-10T15:55:00.000Z",
          dateFinished: "2026-06-10T16:00:00.000Z",
        },
      ]),
    );

    const res = await pa.sentryListDeploys(store, { environment: "staging", version: "acme-api@abc123" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ id: "dep_123", environment: "production", url: "https://acme.example.com" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sentry.io/api/0/organizations/acme-org/releases/acme-api%40abc123/deploys/",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sntrys_dummy" }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "sentry", tool: "list_sentry_deploys" });
  });
});

describe("PostHog", () => {
  function mapPosthog(store: Store, projectId?: string) {
    mapProviderResource(store, {
      environment: "staging",
      provider: "posthog" as any,
      resource: {
        provider: "posthog",
        organizationId: "org_123",
        projectId,
        apiHost: "https://eu.posthog.com",
        ingestHost: "https://eu.i.posthog.com",
      },
    });
  }

  it("lists organization projects without exposing PostHog secret tokens", async () => {
    const store = freshStore();
    seedAcme(store);
    mapPosthog(store);
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        count: 1,
        results: [
          {
            id: 42,
            uuid: "095be615-a8ad-4c33-8e9c-c7612fbf6c9f",
            organization: "org_123",
            api_token: "phc_public",
            secret_api_token: "phs_secret",
            secret_api_token_backup: "phs_backup",
            name: "Acme Web",
            timezone: "UTC",
          },
        ],
      }),
    );

    const res = await pa.posthogListProjects(store, { environment: "staging", limit: 1, search: "Acme" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ id: "42", name: "Acme Web", projectToken: "phc_public" }),
    ]);
    expect(JSON.stringify((res as any).data)).not.toContain("phs_secret");
    expect(JSON.stringify((res as any).data)).not.toContain("phs_backup");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://eu.posthog.com/api/organizations/org_123/projects/?limit=1&search=Acme",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer phx_dummy" }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "posthog", tool: "list_posthog_projects" });
  });

  it("returns client-safe PostHog environment wiring for a mapped project", async () => {
    const store = freshStore();
    seedAcme(store);
    mapPosthog(store, "42");
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        id: 42,
        organization: "org_123",
        api_token: "phc_public",
        secret_api_token: "phs_secret",
        secret_api_token_backup: "phs_backup",
        name: "Acme Web",
      }),
    );

    const res = await pa.posthogGetProjectEnv(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      projectId: "42",
      projectName: "Acme Web",
      env: {
        POSTHOG_PROJECT_ID: "42",
        NEXT_PUBLIC_POSTHOG_KEY: "phc_public",
        NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
      },
    });
    expect(JSON.stringify((res as any).data)).not.toContain("phs_secret");
    expect(JSON.stringify(lastAudit(store))).not.toContain("phs_secret");
  });

  it("creates a PostHog project as a governed env change and returns env wiring", async () => {
    const store = freshStore();
    seedAcme(store);
    mapPosthog(store);
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://eu.posthog.com/api/organizations/org_123/projects/");
        expect(JSON.parse(init.body)).toEqual({
          name: "Acme Web",
          product_description: "CRM onboarding analytics",
          app_urls: ["https://staging.acme.example"],
          timezone: "UTC",
          session_recording_opt_in: false,
        });
        return mockOk({
          id: 42,
          organization: "org_123",
          api_token: "phc_public",
          secret_api_token: "phs_secret",
          secret_api_token_backup: "phs_backup",
          name: "Acme Web",
        });
      }),
    );

    const res = await pa.posthogCreateProject(store, {
      environment: "staging",
      name: "Acme Web",
      productDescription: "CRM onboarding analytics",
      appUrls: ["https://staging.acme.example"],
      timezone: "UTC",
      sessionRecording: false,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data.env).toMatchObject({
      NEXT_PUBLIC_POSTHOG_KEY: "phc_public",
      NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
    });
    expect(JSON.stringify((res as any).data)).not.toContain("phs_secret");
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"posthog"');
    expect(guardBody).toContain('"capability":"env_change"');
  });

  it("lists PostHog feature flags through the guarded read path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapPosthog(store, "42");
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        count: 1,
        results: [
          {
            id: 7,
            key: "checkout-v2",
            name: "Checkout v2",
            active: true,
            deleted: false,
            created_at: "2026-06-10T16:00:00Z",
            updated_at: "2026-06-10T16:05:00Z",
            filters: { groups: [] },
            tags: ["launch"],
            status: "active",
          },
        ],
      }),
    );

    const res = await pa.posthogListFeatureFlags(store, {
      environment: "staging",
      limit: 2,
      search: "checkout",
      active: "true",
      type: "boolean",
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ id: "7", key: "checkout-v2", active: true, tags: ["launch"] }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://eu.posthog.com/api/projects/42/feature_flags/?limit=2&search=checkout&active=true&type=boolean",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer phx_dummy" }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "posthog", tool: "list_posthog_feature_flags" });
  });

  it("creates a PostHog feature flag through a governed write path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapPosthog(store, "42");
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://eu.posthog.com/api/projects/42/feature_flags/");
        expect(JSON.parse(init.body)).toEqual({
          key: "checkout-v2",
          name: "Checkout v2",
          active: false,
          filters: { groups: [] },
          tags: ["launch"],
          is_remote_configuration: false,
        });
        return mockOk({
          id: 7,
          key: "checkout-v2",
          name: "Checkout v2",
          active: false,
          deleted: false,
          filters: { groups: [] },
          tags: ["launch"],
        });
      }),
    );

    const res = await pa.posthogCreateFeatureFlag(store, {
      environment: "staging",
      key: "checkout-v2",
      name: "Checkout v2",
      active: false,
      filters: { groups: [] },
      tags: ["launch"],
      isRemoteConfiguration: false,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({ id: "7", key: "checkout-v2", active: false });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"posthog"');
    expect(guardBody).toContain('"capability":"write"');
  });
});

describe("Upstash Redis", () => {
  function mapUpstash(store: Store, databaseId?: string) {
    mapProviderResource(store, {
      environment: "staging",
      provider: "upstash" as any,
      resource: {
        provider: "upstash",
        databaseId,
        apiHost: "https://api.upstash.com",
        qstashUrl: "https://qstash.upstash.io",
        qstashTokenEnvVar: "QSTASH_TOKEN",
        qstashCurrentSigningKeyEnvVar: "QSTASH_CURRENT_SIGNING_KEY",
        qstashNextSigningKeyEnvVar: "QSTASH_NEXT_SIGNING_KEY",
      },
    });
  }

  it("lists Redis databases with Basic auth and strips credential fields", async () => {
    const store = freshStore();
    seedAcme(store);
    process.env.UPSTASH_EMAIL = "ops@example.com";
    process.env.UPSTASH_API_KEY = "upstash_api_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          database_id: "db_123",
          database_name: "acme-cache",
          endpoint: "acme-cache-us1.upstash.io",
          region: "global",
          primary_region: "us-east-1",
          read_regions: ["us-west-1"],
          state: "active",
          type: "free",
          tls: true,
          rest_token: "upstash_rest_secret",
          read_only_rest_token: "upstash_readonly_secret",
          password: "redis_password_secret",
          customer_id: "ops@example.com",
        },
      ]),
    );

    const res = await pa.upstashListRedisDatabases(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({
        id: "db_123",
        name: "acme-cache",
        endpoint: "acme-cache-us1.upstash.io",
        state: "active",
        primaryRegion: "us-east-1",
        readRegions: ["us-west-1"],
      }),
    ]);
    expect(JSON.stringify((res as any).data)).not.toContain("upstash_rest_secret");
    expect(JSON.stringify((res as any).data)).not.toContain("redis_password_secret");
    expect(JSON.stringify((res as any).data)).not.toContain("ops@example.com");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.upstash.com/v2/redis/databases",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("ops@example.com:upstash_api_dummy").toString("base64")}`,
        }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "upstash", tool: "list_upstash_redis_databases" });
  });

  it("creates a Redis database as a governed env change and returns app env wiring", async () => {
    const store = freshStore();
    seedAcme(store);
    process.env.UPSTASH_EMAIL = "ops@example.com";
    process.env.UPSTASH_API_KEY = "upstash_api_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.upstash.com/v2/redis/database");
        expect(JSON.parse(init.body)).toEqual({
          database_name: "acme-cache",
          platform: "aws",
          primary_region: "us-east-1",
          read_regions: ["us-west-1"],
          plan: "free",
          budget: 0,
          eviction: true,
          tls: true,
        });
        return mockOk({
          database_id: "db_123",
          database_name: "acme-cache",
          endpoint: "acme-cache-us1.upstash.io",
          region: "global",
          primary_region: "us-east-1",
          read_regions: ["us-west-1"],
          state: "active",
          type: "free",
          tls: true,
          rest_token: "upstash_rest_secret",
          read_only_rest_token: "upstash_readonly_secret",
        });
      }),
    );

    const res = await pa.upstashCreateRedisDatabase(store, {
      environment: "staging",
      databaseName: "acme-cache",
      platform: "aws",
      primaryRegion: "us-east-1",
      readRegions: ["us-west-1"],
      plan: "free",
      budget: 0,
      eviction: true,
      tls: true,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data.env).toEqual({
      UPSTASH_REDIS_REST_URL: "https://acme-cache-us1.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "upstash_rest_secret",
      UPSTASH_REDIS_READ_ONLY_REST_TOKEN: "upstash_readonly_secret",
    });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"upstash"');
    expect(guardBody).toContain('"capability":"env_change"');
    expect(guardBody).not.toContain("upstash_rest_secret");
    expect(JSON.stringify(lastAudit(store))).not.toContain("upstash_rest_secret");
  });

  it("returns Upstash Redis env wiring for a mapped database without leaking tokens to audit", async () => {
    const store = freshStore();
    seedAcme(store);
    mapUpstash(store, "db_123");
    process.env.UPSTASH_EMAIL = "ops@example.com";
    process.env.UPSTASH_API_KEY = "upstash_api_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        database_id: "db_123",
        database_name: "acme-cache",
        endpoint: "acme-cache-us1.upstash.io",
        region: "global",
        primary_region: "us-east-1",
        read_regions: ["us-west-1"],
        state: "active",
        type: "free",
        tls: true,
        rest_token: "upstash_rest_secret",
        read_only_rest_token: "upstash_readonly_secret",
      }),
    );

    const res = await pa.upstashGetRedisEnv(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      databaseId: "db_123",
      databaseName: "acme-cache",
      env: {
        UPSTASH_REDIS_REST_URL: "https://acme-cache-us1.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "upstash_rest_secret",
        UPSTASH_REDIS_READ_ONLY_REST_TOKEN: "upstash_readonly_secret",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.upstash.com/v2/redis/database/db_123",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("ops@example.com:upstash_api_dummy").toString("base64")}`,
        }),
      }),
    );
    expect(JSON.stringify(lastAudit(store))).not.toContain("upstash_rest_secret");
  });

  it("returns QStash app env wiring with signing keys from the QStash API", async () => {
    const store = freshStore();
    seedAcme(store);
    mapUpstash(store, "db_123");
    process.env.QSTASH_TOKEN = "qstash_token_secret";
    fetchMock.mockResolvedValueOnce(mockOk({ current: "qstash_current_secret", next: "qstash_next_secret" }));

    const res = await pa.upstashGetQstashEnv(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      url: "https://qstash.upstash.io",
      credentialEnv: {
        tokenEnvVar: "QSTASH_TOKEN",
        currentSigningKeyEnvVar: "QSTASH_CURRENT_SIGNING_KEY",
        nextSigningKeyEnvVar: "QSTASH_NEXT_SIGNING_KEY",
      },
      env: {
        QSTASH_URL: "https://qstash.upstash.io",
        QSTASH_TOKEN: "qstash_token_secret",
        QSTASH_CURRENT_SIGNING_KEY: "qstash_current_secret",
        QSTASH_NEXT_SIGNING_KEY: "qstash_next_secret",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qstash.upstash.io/v2/keys",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer qstash_token_secret" }),
      }),
    );
    expect(JSON.stringify(lastAudit(store))).not.toContain("qstash_token_secret");
    expect(JSON.stringify(lastAudit(store))).not.toContain("qstash_current_secret");
  });

  it("lists QStash schedules without returning bodies or forwarded headers", async () => {
    const store = freshStore();
    seedAcme(store);
    mapUpstash(store, "db_123");
    process.env.QSTASH_TOKEN = "qstash_token_secret";
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          scheduleId: "daily-sync",
          cron: "CRON_TZ=America/New_York 0 9 * * *",
          destination: "https://app.example.com/api/jobs/daily",
          createdAt: 1781112000000,
          method: "POST",
          isPaused: false,
          header: { Authorization: ["Bearer forwarded_secret"] },
          body: "{\"apiKey\":\"payload_secret\"}",
          retries: 3,
          nextScheduleTime: 1781198400000,
          lastScheduleTime: 1781112000000,
        },
      ]),
    );

    const res = await pa.upstashListQstashSchedules(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      {
        scheduleId: "daily-sync",
        cron: "CRON_TZ=America/New_York 0 9 * * *",
        destination: "https://app.example.com/api/jobs/daily",
        createdAt: 1781112000000,
        method: "POST",
        isPaused: false,
        retries: 3,
        nextScheduleTime: 1781198400000,
        lastScheduleTime: 1781112000000,
      },
    ]);
    expect(JSON.stringify((res as any).data)).not.toContain("payload_secret");
    expect(JSON.stringify((res as any).data)).not.toContain("forwarded_secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qstash.upstash.io/v2/schedules",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer qstash_token_secret" }),
      }),
    );
  });

  it("creates a QStash cron schedule as a governed env change and redacts payloads upstream", async () => {
    const store = freshStore();
    seedAcme(store);
    mapUpstash(store, "db_123");
    process.env.QSTASH_TOKEN = "qstash_token_secret";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://qstash.upstash.io/v2/schedules/https%3A%2F%2Fapp.example.com%2Fapi%2Fjobs%2Fdaily");
        expect(init.method).toBe("POST");
        expect(init.headers).toMatchObject({
          Authorization: "Bearer qstash_token_secret",
          "Content-Type": "application/json",
          "Upstash-Cron": "CRON_TZ=America/New_York 0 9 * * *",
          "Upstash-Method": "POST",
          "Upstash-Retries": "3",
          "Upstash-Schedule-Id": "daily-sync",
          "Upstash-Redact-Fields": "body, headers",
        });
        expect(init.body).toBe("{\"job\":\"daily_sync\"}");
        return mockOk({ scheduleId: "daily-sync" });
      }),
    );

    const res = await pa.upstashCreateQstashSchedule(store, {
      environment: "staging",
      destination: "https://app.example.com/api/jobs/daily",
      cron: "CRON_TZ=America/New_York 0 9 * * *",
      scheduleId: "daily-sync",
      body: "{\"job\":\"daily_sync\"}",
      contentType: "application/json",
      method: "POST",
      retries: 3,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({ scheduleId: "daily-sync" });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"upstash"');
    expect(guardBody).toContain('"capability":"env_change"');
    expect(guardBody).not.toContain("qstash_token_secret");
    expect(guardBody).not.toContain("daily_sync");
  });
});

describe("Cloudflare R2", () => {
  function mapR2(store: Store, bucketName = "acme-assets") {
    mapProviderResource(store, {
      environment: "staging",
      provider: "cloudflare_r2" as any,
      resource: {
        provider: "cloudflare_r2",
        accountId: "acc_123",
        bucketName,
        apiHost: "https://api.cloudflare.com/client/v4",
        jurisdiction: "default",
        accessKeyIdEnvVar: "R2_ACCESS_KEY_ID",
        secretAccessKeyEnvVar: "R2_SECRET_ACCESS_KEY",
        publicUrl: "https://assets.acme.example",
      },
    });
  }

  it("lists R2 buckets through the Cloudflare API without exposing tokens", async () => {
    const store = freshStore();
    seedAcme(store);
    mapR2(store);
    process.env.CLOUDFLARE_API_TOKEN = "cf_api_secret";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        success: true,
        errors: [],
        messages: [],
        result: {
          buckets: [
            {
              name: "acme-assets",
              creation_date: "2026-06-10T00:00:00.000Z",
              jurisdiction: "default",
              location: "enam",
              storage_class: "Standard",
            },
          ],
        },
        result_info: { cursor: "next", per_page: 20 },
      }),
    );

    const res = await pa.cloudflareR2ListBuckets(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      buckets: [
        {
          name: "acme-assets",
          createdAt: "2026-06-10T00:00:00.000Z",
          jurisdiction: "default",
          location: "enam",
          storageClass: "Standard",
        },
      ],
      cursor: "next",
      perPage: 20,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc_123/r2/buckets",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer cf_api_secret" }),
      }),
    );
    expect(JSON.stringify(lastAudit(store))).not.toContain("cf_api_secret");
  });

  it("creates an R2 bucket as a governed env change and returns app wiring", async () => {
    const store = freshStore();
    seedAcme(store);
    mapR2(store);
    process.env.CLOUDFLARE_API_TOKEN = "cf_api_secret";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc_123/r2/buckets");
        expect(init.method).toBe("POST");
        expect(init.headers).toMatchObject({
          Authorization: "Bearer cf_api_secret",
          "Content-Type": "application/json",
          "cf-r2-jurisdiction": "default",
        });
        expect(JSON.parse(init.body)).toEqual({
          name: "acme-assets",
          locationHint: "enam",
          storageClass: "Standard",
        });
        return mockOk({
          success: true,
          errors: [],
          messages: [],
          result: {
            name: "acme-assets",
            creation_date: "2026-06-10T00:00:00.000Z",
            jurisdiction: "default",
            location: "enam",
            storage_class: "Standard",
          },
        });
      }),
    );

    const res = await pa.cloudflareR2CreateBucket(store, {
      environment: "staging",
      bucketName: "acme-assets",
      locationHint: "enam",
      storageClass: "Standard",
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({
      bucket: { name: "acme-assets", location: "enam", storageClass: "Standard" },
      env: {
        R2_ACCOUNT_ID: "acc_123",
        R2_BUCKET_NAME: "acme-assets",
        R2_ENDPOINT: "https://acc_123.r2.cloudflarestorage.com",
        R2_REGION: "auto",
        R2_PUBLIC_URL: "https://assets.acme.example",
      },
      credentialEnv: {
        accessKeyIdEnvVar: "R2_ACCESS_KEY_ID",
        secretAccessKeyEnvVar: "R2_SECRET_ACCESS_KEY",
      },
    });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"cloudflare_r2"');
    expect(guardBody).toContain('"capability":"env_change"');
    expect(guardBody).not.toContain("cf_api_secret");
  });

  it("returns R2 app env wiring with S3 credentials read from env and kept out of audit", async () => {
    const store = freshStore();
    seedAcme(store);
    mapR2(store);
    process.env.R2_ACCESS_KEY_ID = "r2_access_id";
    process.env.R2_SECRET_ACCESS_KEY = "r2_secret_key";

    const res = await pa.cloudflareR2GetEnv(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      bucketName: "acme-assets",
      endpoint: "https://acc_123.r2.cloudflarestorage.com",
      credentialEnv: {
        accessKeyIdEnvVar: "R2_ACCESS_KEY_ID",
        secretAccessKeyEnvVar: "R2_SECRET_ACCESS_KEY",
      },
      env: {
        R2_ACCOUNT_ID: "acc_123",
        R2_BUCKET_NAME: "acme-assets",
        R2_ENDPOINT: "https://acc_123.r2.cloudflarestorage.com",
        R2_REGION: "auto",
        R2_PUBLIC_URL: "https://assets.acme.example",
        R2_ACCESS_KEY_ID: "r2_access_id",
        R2_SECRET_ACCESS_KEY: "r2_secret_key",
      },
    });
    expect(providerCalls()).toHaveLength(0);
    expect(JSON.stringify(lastAudit(store))).not.toContain("r2_secret_key");
  });

  it("lists R2 objects for the mapped bucket", async () => {
    const store = freshStore();
    seedAcme(store);
    mapR2(store);
    process.env.CLOUDFLARE_API_TOKEN = "cf_api_secret";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        success: true,
        errors: [],
        messages: [],
        result: {
          objects: [
            {
              key: "avatars/user_123.png",
              size: 42,
              etag: "abc123",
              uploaded: "2026-06-10T00:00:00.000Z",
              storage_class: "Standard",
            },
          ],
        },
        result_info: { cursor: "next", per_page: 50 },
      }),
    );

    const res = await pa.cloudflareR2ListObjects(store, {
      environment: "staging",
      prefix: "avatars/",
      limit: 50,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      objects: [
        {
          key: "avatars/user_123.png",
          size: 42,
          etag: "abc123",
          uploadedAt: "2026-06-10T00:00:00.000Z",
          storageClass: "Standard",
        },
      ],
      cursor: "next",
      perPage: 50,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc_123/r2/buckets/acme-assets/objects?prefix=avatars%2F&per_page=50",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer cf_api_secret" }),
      }),
    );
  });
});

describe("Clerk", () => {
  function mapClerk(store: Store) {
    mapProviderResource(store, {
      environment: "staging",
      provider: "clerk" as any,
      resource: {
        provider: "clerk",
        publishableKey: "pk_test_public",
        signInUrl: "/sign-in",
        signUpUrl: "/sign-up",
        signInFallbackRedirectUrl: "/dashboard",
        signUpFallbackRedirectUrl: "/dashboard",
      },
    });
  }

  it("returns client-safe Clerk environment wiring without exposing the secret key", async () => {
    const store = freshStore();
    seedAcme(store);
    mapClerk(store);
    process.env.CLERK_SECRET_KEY = "sk_test_secret";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        data: [
          {
            object: "domain",
            id: "dmn_123",
            name: "accounts.acme.example",
            is_satellite: false,
            frontend_api_url: "https://humble-lion-12.clerk.accounts.dev",
            development_origin: "https://humble-lion-12.clerk.accounts.dev",
            accounts_portal_url: "https://accounts.acme.example",
            proxy_url: null,
          },
        ],
        total_count: 1,
      }),
    );

    const res = await pa.clerkGetAppEnv(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      domain: "accounts.acme.example",
      frontendApiUrl: "https://humble-lion-12.clerk.accounts.dev",
      secretEnvVar: "CLERK_SECRET_KEY",
      env: {
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
        NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
        NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/dashboard",
        NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/dashboard",
        NEXT_PUBLIC_CLERK_FAPI: "https://humble-lion-12.clerk.accounts.dev",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/domains",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_secret" }),
      }),
    );
    expect(JSON.stringify((res as any).data)).not.toContain("sk_test_secret");
    expect(JSON.stringify(lastAudit(store))).not.toContain("sk_test_secret");
  });

  it("lists Clerk users with safe summaries and keeps user PII out of audit", async () => {
    const store = freshStore();
    seedAcme(store);
    mapClerk(store);
    process.env.CLERK_SECRET_KEY = "sk_test_secret";
    fetchMock.mockResolvedValueOnce(
      mockOk([
        {
          id: "user_123",
          first_name: "Ada",
          last_name: "Lovelace",
          primary_email_address_id: "idn_123",
          email_addresses: [{ id: "idn_123", email_address: "ada@example.com" }],
          private_metadata: { internalNote: "do-not-return" },
          unsafe_metadata: { leakedByClient: "do-not-return" },
          created_at: 1770489600000,
          updated_at: 1770489700000,
          last_sign_in_at: 1770489800000,
          banned: false,
          locked: false,
        },
      ]),
    );

    const res = await pa.clerkListUsers(store, { environment: "staging", limit: 1, query: "ada@example.com" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      {
        id: "user_123",
        primaryEmail: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        createdAt: 1770489600000,
        updatedAt: 1770489700000,
        lastSignInAt: 1770489800000,
        banned: false,
        locked: false,
      },
    ]);
    expect(JSON.stringify((res as any).data)).not.toContain("do-not-return");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/users?limit=1&query=ada%40example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_secret" }),
      }),
    );
    expect(JSON.stringify(lastAudit(store))).not.toContain("ada@example.com");
  });

  it("lists and creates Clerk redirect URLs through guarded provider actions", async () => {
    const store = freshStore();
    seedAcme(store);
    mapClerk(store);
    process.env.CLERK_SECRET_KEY = "sk_test_secret";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        data: [{ id: "rurl_123", url: "my-app://oauth-callback", created_at: 1770489600000 }],
        total_count: 1,
      }),
    );

    const listed = await pa.clerkListRedirectUrls(store, { environment: "staging", limit: 10 });

    expect(listed.status).toBe("ok");
    expect((listed as any).data).toEqual([
      { id: "rurl_123", url: "my-app://oauth-callback", createdAt: 1770489600000 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/redirect_urls?limit=10",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_secret" }),
      }),
    );

    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.clerk.com/v1/redirect_urls");
        expect(JSON.parse(init.body)).toEqual({ url: "my-app://oauth-callback" });
        return mockOk({ id: "rurl_456", url: "my-app://oauth-callback", created_at: 1770489700000 });
      }),
    );

    const created = await pa.clerkCreateRedirectUrl(store, {
      environment: "staging",
      url: "my-app://oauth-callback",
    });

    expect(created.status).toBe("ok");
    expect((created as any).data).toEqual({
      id: "rurl_456",
      url: "my-app://oauth-callback",
      createdAt: 1770489700000,
    });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"clerk"');
    expect(guardBody).toContain('"capability":"env_change"');
    expect(guardBody).not.toContain("sk_test_secret");
  });
});

describe("Resend", () => {
  function mapResend(store: Store) {
    mapProviderResource(store, {
      environment: "staging",
      provider: "resend" as any,
      resource: {
        provider: "resend",
        domain: "example.com",
        defaultFrom: "Acme <onboarding@example.com>",
      },
    });
  }

  it("lists email domains through the guarded read path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapResend(store);
    process.env.RESEND_API_KEY = "re_dummy";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        object: "list",
        has_more: false,
        data: [
          {
            id: "dom_123",
            name: "example.com",
            status: "verified",
            created_at: "2026-06-10T00:00:00.000Z",
            region: "us-east-1",
            capabilities: { sending: "enabled", receiving: "disabled" },
          },
        ],
      }),
    );

    const res = await pa.resendListDomains(store, { environment: "staging", limit: 1 });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ id: "dom_123", name: "example.com", status: "verified" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/domains?limit=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer re_dummy",
          "User-Agent": expect.stringContaining("offlocal"),
        }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "resend", tool: "list_resend_domains" });
  });

  it("creates a Resend domain and returns DNS records through a governed env change", async () => {
    const store = freshStore();
    seedAcme(store);
    mapResend(store);
    process.env.RESEND_API_KEY = "re_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.resend.com/domains");
        expect(JSON.parse(init.body)).toEqual({ name: "example.com" });
        return mockOk({
          id: "dom_123",
          name: "example.com",
          status: "not_started",
          records: [{ record: "DKIM", name: "k._domainkey", type: "CNAME", value: "k.dkim.amazonses.com.", status: "not_started" }],
        });
      }),
    );

    const res = await pa.resendCreateDomain(store, { environment: "staging", name: "example.com" });

    expect(res.status).toBe("ok");
    expect((res as any).data.records).toEqual([expect.objectContaining({ type: "CNAME", name: "k._domainkey" })]);
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"resend"');
    expect(guardBody).toContain('"capability":"env_change"');
  });

  it("triggers domain verification as a governed env change", async () => {
    const store = freshStore();
    seedAcme(store);
    mapResend(store);
    process.env.RESEND_API_KEY = "re_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.resend.com/domains/dom_123/verify");
        expect(init.method).toBe("POST");
        return mockOk({ object: "domain", id: "dom_123" });
      }),
    );

    const res = await pa.resendVerifyDomain(store, { environment: "staging", domainId: "dom_123" });

    expect(res.status).toBe("ok");
    expect(lastAudit(store)).toMatchObject({ provider: "resend", tool: "verify_resend_domain", result: "success" });
  });

  it("sends email without leaking recipients, subject, or body into DashClaw/audit", async () => {
    const store = freshStore();
    seedAcme(store);
    mapResend(store);
    process.env.RESEND_API_KEY = "re_dummy";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.resend.com/emails");
        expect(JSON.parse(init.body)).toMatchObject({
          from: "Acme <onboarding@example.com>",
          to: ["ada@example.com"],
          subject: "Your OTP is 123456",
          html: "<p>Your OTP is 123456</p>",
        });
        return mockOk({ id: "email_123" });
      }),
    );

    const res = await pa.resendSendEmail(store, {
      environment: "staging",
      to: ["ada@example.com"],
      subject: "Your OTP is 123456",
      html: "<p>Your OTP is 123456</p>",
    });

    expect(res.status).toBe("ok");
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"resend"');
    expect(guardBody).not.toContain("ada@example.com");
    expect(guardBody).not.toContain("123456");
    expect(JSON.stringify(lastAudit(store))).not.toContain("ada@example.com");
    expect(JSON.stringify(lastAudit(store))).not.toContain("123456");
  });
});

describe("Twilio", () => {
  function mapTwilio(store: Store) {
    mapProviderResource(store, {
      environment: "staging",
      provider: "twilio" as any,
      resource: {
        provider: "twilio",
        accountSid: "AC11111111111111111111111111111111",
        fromNumber: "+15551230000",
      },
    });
  }

  it("lists phone numbers through the guarded read path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapTwilio(store);
    process.env.TWILIO_AUTH_TOKEN = "tw_auth";
    fetchMock.mockResolvedValueOnce(
      mockOk({
        incoming_phone_numbers: [
          {
            sid: "PN111",
            phone_number: "+15551230000",
            friendly_name: "Support",
            sms_url: "https://example.com/api/twilio/sms",
            voice_url: "https://example.com/api/twilio/voice",
            capabilities: { SMS: true, voice: true },
          },
        ],
      }),
    );

    const res = await pa.twilioListPhoneNumbers(store, { environment: "staging", limit: 1 });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({
        sid: "PN111",
        phoneNumber: "+15551230000",
        smsUrl: "https://example.com/api/twilio/sms",
        voiceUrl: "https://example.com/api/twilio/voice",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111/IncomingPhoneNumbers.json?PageSize=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("AC11111111111111111111111111111111:tw_auth").toString("base64")}`,
        }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "twilio", tool: "list_twilio_phone_numbers" });
  });

  it("updates SMS and voice webhooks as a governed env change", async () => {
    const store = freshStore();
    seedAcme(store);
    mapTwilio(store);
    process.env.TWILIO_AUTH_TOKEN = "tw_auth";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe(
          "https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111/IncomingPhoneNumbers/PN111.json",
        );
        expect(init.body).toContain("SmsUrl=https%3A%2F%2Fexample.com%2Fapi%2Ftwilio%2Fsms");
        expect(init.body).toContain("VoiceUrl=https%3A%2F%2Fexample.com%2Fapi%2Ftwilio%2Fvoice");
        return mockOk({ sid: "PN111", sms_url: "https://example.com/api/twilio/sms", voice_url: "https://example.com/api/twilio/voice" });
      }),
    );

    const res = await pa.twilioUpdatePhoneNumberWebhooks(store, {
      environment: "staging",
      phoneNumberSid: "PN111",
      smsUrl: "https://example.com/api/twilio/sms",
      voiceUrl: "https://example.com/api/twilio/voice",
    });

    expect(res.status).toBe("ok");
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"twilio"');
    expect(guardBody).toContain('"capability":"env_change"');
  });

  it("sends SMS without leaking message content or recipient into DashClaw/audit", async () => {
    const store = freshStore();
    seedAcme(store);
    mapTwilio(store);
    process.env.TWILIO_AUTH_TOKEN = "tw_auth";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111/Messages.json");
        expect(init.body).toContain("Body=Your%20OTP%20is%20123456");
        expect(init.body).toContain("To=%2B15559876543");
        return mockOk({ sid: "SM111", status: "queued", to: "+15559876543", from: "+15551230000" });
      }),
    );

    const res = await pa.twilioSendSms(store, {
      environment: "staging",
      to: "+15559876543",
      body: "Your OTP is 123456",
    });

    expect(res.status).toBe("ok");
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"twilio"');
    expect(guardBody).not.toContain("+15559876543");
    expect(guardBody).not.toContain("123456");
    expect(JSON.stringify(lastAudit(store))).not.toContain("+15559876543");
    expect(JSON.stringify(lastAudit(store))).not.toContain("123456");
  });

  it("creates an outbound voice call through the live guarded path", async () => {
    const store = freshStore();
    seedAcme(store);
    mapTwilio(store);
    process.env.TWILIO_AUTH_TOKEN = "tw_auth";
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111/Calls.json");
        expect(init.body).toContain("Url=https%3A%2F%2Fexample.com%2Fapi%2Ftwilio%2Fvoice");
        return mockOk({ sid: "CA111", status: "queued", to: "+15559876543", from: "+15551230000" });
      }),
    );

    const res = await pa.twilioCreateCall(store, {
      environment: "staging",
      to: "+15559876543",
      url: "https://example.com/api/twilio/voice",
    });

    expect(res.status).toBe("ok");
    expect(lastAudit(store)).toMatchObject({ provider: "twilio", tool: "create_twilio_call", result: "success" });
  });
});

describe("Stripe", () => {
  it("uses the mapping connection token for Stripe calls", async () => {
    const store = freshStore();
    seedAcme(store);
    process.env.CUSTOM_STRIPE_TEST_KEY = "sk_test_custom";
    store.update((s) => {
      s.connections.push({
        id: "conn_custom_stripe",
        workspaceId: s.defaultWorkspaceId!,
        provider: "stripe",
        label: "custom-stripe",
        auth: { kind: "env", envVar: "CUSTOM_STRIPE_TEST_KEY" },
        createdAt: new Date().toISOString(),
      });
    });
    mapProviderResource(store, {
      environment: "staging",
      provider: "stripe",
      connectionId: "conn_custom_stripe",
      resource: { provider: "stripe", mode: "test" },
    });
    fetchMock.mockResolvedValueOnce(mockOk({ data: [{ id: "prod_123", name: "Pro", active: true, created: 1 }] }));

    const res = await pa.stripeListProducts(store, { environment: "staging", limit: 1 });

    expect(res.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/products?limit=1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_test_custom" }),
      }),
    );
  });

  it("allows test-mode writes and executes them", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.stripeCreateProduct(store, {
      environment: "staging", // staging -> stripe mode test
      name: "Pro Plan",
    });
    expect(res.status).toBe("ok");
    expect(providerCalls()).toHaveLength(1);
    expect(lastAudit(store)).toMatchObject({ result: "success", policyDecision: "allow", provider: "stripe" });
  });

  it("uses the live Stripe key for production reads when no explicit connection is mapped", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk({ data: [{ id: "prod_live", name: "Live", active: true, created: 1 }] }));

    const res = await pa.stripeListProducts(store, { environment: "production", limit: 1 });

    expect(res.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/products?limit=1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_live_dummy" }),
      }),
    );
  });

  it("requires approval for live-mode writes and does NOT execute them", async () => {
    setDashclawDecision("require_approval", "stripe_live");
    const store = freshStore();
    seedAcme(store);
    const res = await pa.stripeCreateProduct(store, {
      environment: "production", // production -> stripe mode live
      name: "Pro Plan",
    });
    expect(res.status).toBe("approval_required");
    expect((res as any).approval_id).toBe("act_stripe_live");
    expect(providerCalls()).toHaveLength(0);
    expect(lastAudit(store)).toMatchObject({
      result: "not_executed",
      policyDecision: "approval_required",
      dashclawDecisionId: "gd_stripe_live",
      dashclawActionId: "act_stripe_live",
    });
  });
});

describe("mapped provider connections", () => {
  it("uses the mapping connection token for provider calls", async () => {
    const store = freshStore();
    seedAcme(store);
    process.env.CUSTOM_GITHUB_TOKEN = "gh_custom";
    store.update((s) => {
      s.connections.push({
        id: "conn_custom_github",
        workspaceId: s.defaultWorkspaceId!,
        provider: "github",
        label: "custom-github",
        auth: { kind: "env", envVar: "CUSTOM_GITHUB_TOKEN" },
        createdAt: new Date().toISOString(),
      });
    });
    mapProviderResource(store, {
      environment: "staging",
      provider: "github",
      connectionId: "conn_custom_github",
      resource: { provider: "github", owner: "acme", repo: "acme-crm" },
    });
    fetchMock.mockResolvedValueOnce(mockOk({
      full_name: "acme/acme-crm",
      default_branch: "main",
      private: true,
      pushed_at: "2026-06-09T12:00:00.000Z",
      open_issues_count: 0,
      html_url: "https://github.com/acme/acme-crm",
    }));

    const res = await pa.githubRepoContext(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/acme-crm",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer gh_custom" }),
      }),
    );
  });

  it("retries transient read failures for idempotent provider calls", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "temporary" }), { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(mockOk({
        full_name: "acme/acme-crm",
        default_branch: "main",
        private: true,
        pushed_at: "2026-06-09T12:00:00.000Z",
        open_issues_count: 0,
        html_url: "https://github.com/acme/acme-crm",
      }));

    const res = await pa.githubRepoContext(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when provider responses have the wrong shape", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk({ default_branch: "main" }));

    const res = await pa.githubRepoContext(store, { environment: "staging" });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/github repo.*full_name/i);
    expect(lastAudit(store)).toMatchObject({ result: "error", provider: "github" });
  });

  it("lists GitHub pull requests through the guarded read path", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk([
      {
        number: 7,
        title: "Ship feature",
        state: "open",
        draft: false,
        head: { ref: "feature" },
        base: { ref: "main" },
        html_url: "https://github.com/acme/acme-crm/pull/7",
        updated_at: "2026-06-09T12:00:00.000Z",
      },
    ]));

    const res = await pa.githubPullRequests(store, { environment: "staging", limit: 1 });

    expect(res.status).toBe("ok");
    expect((res as any).data[0]).toMatchObject({ number: 7, headRef: "feature", baseRef: "main" });
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "github", tool: "list_github_pull_requests" });
  });

  it("lists GitHub Actions workflow runs for the mapped repo", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk({
      total_count: 1,
      workflow_runs: [
        {
          id: 101,
          name: "CI",
          display_title: "Ship feature",
          status: "completed",
          conclusion: "failure",
          event: "pull_request",
          head_branch: "feature",
          head_sha: "abc123",
          run_attempt: 1,
          created_at: "2026-06-10T00:00:00Z",
          updated_at: "2026-06-10T00:03:00Z",
          html_url: "https://github.com/acme/acme-crm/actions/runs/101",
          workflow_id: 7,
        },
      ],
    }));

    const res = await pa.githubWorkflowRuns(store, {
      environment: "staging",
      branch: "feature",
      status: "completed",
      limit: 1,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      totalCount: 1,
      workflowRuns: [
        {
          id: 101,
          name: "CI",
          title: "Ship feature",
          status: "completed",
          conclusion: "failure",
          event: "pull_request",
          headBranch: "feature",
          headSha: "abc123",
          runAttempt: 1,
          createdAt: "2026-06-10T00:00:00Z",
          updatedAt: "2026-06-10T00:03:00Z",
          htmlUrl: "https://github.com/acme/acme-crm/actions/runs/101",
          workflowId: 7,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/acme-crm/actions/runs?branch=feature&status=completed&per_page=1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer gh_dummy" }),
      }),
    );
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "github", tool: "list_github_workflow_runs" });
  });

  it("lists GitHub Actions jobs for a workflow run without log bodies", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk({
      total_count: 1,
      jobs: [
        {
          id: 501,
          run_id: 101,
          name: "test",
          status: "completed",
          conclusion: "failure",
          started_at: "2026-06-10T00:01:00Z",
          completed_at: "2026-06-10T00:02:00Z",
          html_url: "https://github.com/acme/acme-crm/actions/runs/101/job/501",
          steps: [
            {
              name: "npm test",
              status: "completed",
              conclusion: "failure",
              number: 3,
              started_at: "2026-06-10T00:01:30Z",
              completed_at: "2026-06-10T00:02:00Z",
            },
          ],
        },
      ],
    }));

    const res = await pa.githubWorkflowJobs(store, {
      environment: "staging",
      runId: 101,
      filter: "latest",
      limit: 1,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      totalCount: 1,
      jobs: [
        {
          id: 501,
          runId: 101,
          name: "test",
          status: "completed",
          conclusion: "failure",
          startedAt: "2026-06-10T00:01:00Z",
          completedAt: "2026-06-10T00:02:00Z",
          htmlUrl: "https://github.com/acme/acme-crm/actions/runs/101/job/501",
          steps: [
            {
              name: "npm test",
              status: "completed",
              conclusion: "failure",
              number: 3,
              startedAt: "2026-06-10T00:01:30Z",
              completedAt: "2026-06-10T00:02:00Z",
            },
          ],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/acme-crm/actions/runs/101/jobs?filter=latest&per_page=1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer gh_dummy" }),
      }),
    );
    expect(JSON.stringify((res as any).data)).not.toContain("logs");
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "github", tool: "list_github_workflow_jobs" });
  });

  it("reruns a GitHub Actions workflow run as a governed write", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.github.com/repos/acme/acme-crm/actions/runs/101/rerun");
        expect(init.method).toBe("POST");
        return new Response(null, { status: 201 });
      }),
    );

    const res = await pa.githubRerunWorkflowRun(store, { environment: "staging", runId: 101 });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({ runId: 101, rerun: true });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"github"');
    expect(guardBody).toContain('"capability":"write"');
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "github", tool: "rerun_github_workflow_run" });
  });

  it("cancels a GitHub Actions workflow run as a governed write", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.github.com/repos/acme/acme-crm/actions/runs/101/cancel");
        expect(init.method).toBe("POST");
        return new Response(null, { status: 202 });
      }),
    );

    const res = await pa.githubCancelWorkflowRun(store, { environment: "staging", runId: 101 });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({ runId: 101, canceled: true });
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"provider":"github"');
    expect(guardBody).toContain('"capability":"write"');
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "github", tool: "cancel_github_workflow_run" });
  });
});

describe("Namecheap", () => {
  beforeEach(() => {
    process.env.NAMECHEAP_API_USER = "ncuser";
    process.env.NAMECHEAP_API_KEY = "nc_dummy_key";
    process.env.NAMECHEAP_CLIENT_IP = "203.0.113.7";
    process.env.NAMECHEAP_SANDBOX = "true";
  });

  afterEach(() => {
    delete process.env.NAMECHEAP_API_USER;
    delete process.env.NAMECHEAP_API_KEY;
    delete process.env.NAMECHEAP_CLIENT_IP;
    delete process.env.NAMECHEAP_SANDBOX;
  });

  function mockXml(body: string) {
    return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
  }

  const CHECK_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
<Errors/>
<RequestedCommand>namecheap.domains.check</RequestedCommand>
<CommandResponse Type="namecheap.domains.check">
<DomainCheckResult Domain="taken.com" Available="false" ErrorNo="0" Description="" IsPremiumName="false" PremiumRegistrationPrice="0" IcannFee="0" EapFee="0"/>
<DomainCheckResult Domain="fancy.xyz" Available="true" ErrorNo="0" Description="" IsPremiumName="true" PremiumRegistrationPrice="13000.0000" PremiumRenewalPrice="13000.0000" IcannFee="0.0000" EapFee="0.0000"/>
</CommandResponse>
</ApiResponse>`;

  const GETLIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
<Errors/>
<RequestedCommand>namecheap.domains.getList</RequestedCommand>
<CommandResponse Type="namecheap.domains.getList">
<DomainGetListResult>
<Domain ID="127" Name="domain1.com" User="owner" Created="02/15/2026" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
</DomainGetListResult>
<Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
</CommandResponse>
</ApiResponse>`;

  const GETHOSTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
<Errors/>
<RequestedCommand>namecheap.domains.dns.getHosts</RequestedCommand>
<CommandResponse Type="namecheap.domains.dns.getHosts">
<DomainDNSGetHostsResult Domain="domain1.com" IsUsingOurDNS="true">
<Host HostId="12" Name="@" Type="A" Address="76.76.21.21" MXPref="10" TTL="1800"/>
<Host HostId="14" Name="www" Type="CNAME" Address="cname.vercel-dns.com" MXPref="10" TTL="1800"/>
</DomainDNSGetHostsResult>
</CommandResponse>
</ApiResponse>`;

  const SETHOSTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
<Errors/>
<RequestedCommand>namecheap.domains.dns.setHosts</RequestedCommand>
<CommandResponse Type="namecheap.domains.dns.setHosts">
<DomainDNSSetHostsResult Domain="domain1.com" IsSuccess="true"/>
</CommandResponse>
</ApiResponse>`;

  const CREATE_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
<Errors/>
<RequestedCommand>namecheap.domains.create</RequestedCommand>
<CommandResponse Type="namecheap.domains.create">
<DomainCreateResult Domain="fancy.xyz" Registered="true" ChargedAmount="10.87" DomainID="9007" OrderID="196074" TransactionID="380716" WhoisguardEnable="false" NonRealTimeDomain="false"/>
</CommandResponse>
</ApiResponse>`;

  function writeRegistrantConfig(store: Store) {
    writeFileSync(
      store.paths.config,
      [
        "namecheap:",
        "  registrant:",
        "    first_name: Test",
        "    last_name: User",
        "    address1: 123 Main St",
        "    city: Anytown",
        "    state_province: CA",
        '    postal_code: "12345"',
        "    country: US",
        '    phone: "+1.5551234567"',
        "    email_address: registrant@example.com",
        "",
      ].join("\n"),
    );
  }

  const IP_ERROR_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="ERROR">
<Errors><Error Number="1011102">API Key is invalid or API access has not been enabled</Error></Errors>
<RequestedCommand>namecheap.domains.check</RequestedCommand>
</ApiResponse>`;

  it("checks domain availability with sandbox host, global params, and premium pricing parsed", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(CHECK_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.checkDomainAvailability(store, { environment: "staging", domains: ["taken.com", "fancy.xyz"] });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ domain: "taken.com", available: false, premium: false }),
      expect.objectContaining({ domain: "fancy.xyz", available: true, premium: true, premiumRegistrationPrice: "13000.0000" }),
    ]);
    const [url] = providerCalls()[0]!;
    expect(url).toContain("https://api.sandbox.namecheap.com/xml.response?");
    expect(url).toContain("ApiUser=ncuser");
    expect(url).toContain("ApiKey=nc_dummy_key");
    expect(url).toContain("UserName=ncuser");
    expect(url).toContain("ClientIp=203.0.113.7");
    expect(url).toContain("Command=namecheap.domains.check");
    expect(url).toContain("DomainList=taken.com%2Cfancy.xyz");
  });

  it("uses the production host when NAMECHEAP_SANDBOX is not true", async () => {
    delete process.env.NAMECHEAP_SANDBOX;
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(CHECK_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.checkDomainAvailability(store, { environment: "staging", domains: ["taken.com"] });

    expect(res.status).toBe("ok");
    expect(providerCalls()[0]![0]).toContain("https://api.namecheap.com/xml.response?");
  });

  it("lists domains with names and expiry parsed from XML", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(GETLIST_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.namecheapListDomains(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ name: "domain1.com", expires: "02/15/2027", autoRenew: false }),
    ]);
    expect(providerCalls()[0]![0]).toContain("Command=namecheap.domains.getList");
  });

  it("gets DNS host records parsed from XML", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(GETHOSTS_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.getDnsRecords(store, { environment: "staging", domain: "domain1.com" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({
      domain: "domain1.com",
      records: [
        { name: "@", type: "A", address: "76.76.21.21", ttl: 1800 },
        { name: "www", type: "CNAME", address: "cname.vercel-dns.com", ttl: 1800 },
      ],
    });
    const [url] = providerCalls()[0]!;
    expect(url).toContain("Command=namecheap.domains.dns.getHosts");
    expect(url).toContain("SLD=domain1");
    expect(url).toContain("TLD=com");
  });

  it("sets DNS host records with numbered params and env_change capability", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(SETHOSTS_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.setDnsRecords(store, {
      environment: "staging",
      domain: "domain1.com",
      records: [
        { name: "@", type: "A", address: "76.76.21.21" },
        { name: "www", type: "CNAME", address: "cname.vercel-dns.com", ttl: 300 },
      ],
    });

    expect(res.status).toBe("ok");
    const [url] = providerCalls()[0]!;
    expect(url).toContain("Command=namecheap.domains.dns.setHosts");
    expect(url).toContain("HostName1=%40");
    expect(url).toContain("RecordType1=A");
    expect(url).toContain("Address1=76.76.21.21");
    expect(url).toContain("HostName2=www");
    expect(url).toContain("RecordType2=CNAME");
    expect(url).toContain("TTL2=300");
    expect(lastAudit(store)).toMatchObject({ tool: "set_dns_records", result: "success" });
    // Capability env_change reaches the DashClaw guard payload.
    const guardBody = fetchMock.mock.calls.find(([u]: [string]) => u === "https://dashclaw.example/api/guard")?.[1]?.body;
    expect(String(guardBody)).toContain('"capability":"env_change"');
  });

  it("requires approval for purchase_domain end-to-end even with an explicit allow policy", async () => {
    setDashclawDecision("require_approval", "purchase");
    const store = freshStore();
    seedAcme(store);
    writeRegistrantConfig(store);
    setPolicyRule(store, {
      effect: "allow",
      priority: 500,
      description: "Attempt to un-gate purchases (must be clamped).",
      match: { capability: "purchase" },
    });

    const res = await pa.purchaseDomain(store, { environment: "production", domain: "fancy.xyz" });

    expect(res.status).toBe("approval_required");
    expect(providerCalls()).toHaveLength(0);
    // The clamped local preview travels to DashClaw: approval_required despite the allow rule.
    const guardBody = String(
      fetchMock.mock.calls.find(([u]: [string]) => u === "https://dashclaw.example/api/guard")?.[1]?.body,
    );
    expect(guardBody).toContain('"capability":"purchase"');
    expect(guardBody).toContain('"local_policy_effect":"approval_required"');
    expect(lastAudit(store)).toMatchObject({ tool: "purchase_domain", result: "not_executed" });
  });

  it("sends registrant contact fields on an approved purchase", async () => {
    const store = freshStore();
    seedAcme(store);
    writeRegistrantConfig(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(CREATE_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.purchaseDomain(store, { environment: "production", domain: "fancy.xyz", years: 1 });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({ domain: "fancy.xyz", registered: true, chargedAmount: "10.87" });
    const [url] = providerCalls()[0]!;
    expect(url).toContain("Command=namecheap.domains.create");
    expect(url).toContain("DomainName=fancy.xyz");
    expect(url).toContain("Years=1");
    expect(url).toContain("RegistrantFirstName=Test");
    expect(url).toContain("RegistrantEmailAddress=registrant%40example.com");
    expect(url).toContain("TechFirstName=Test");
    expect(url).toContain("AdminFirstName=Test");
    expect(url).toContain("AuxBillingFirstName=Test");
    expect(lastAudit(store)).toMatchObject({ tool: "purchase_domain", result: "success" });
  });

  it("fails actionably before any HTTP when registrant contact config is missing", async () => {
    const store = freshStore();
    seedAcme(store);

    await expect(
      pa.purchaseDomain(store, { environment: "production", domain: "fancy.xyz" }),
    ).rejects.toThrow(/namecheap\.registrant/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps error 1011102 to a re-whitelist-your-IP message", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(IP_ERROR_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.checkDomainAvailability(store, { environment: "staging", domains: ["taken.com"] });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/whitelist/i);
    expect((res as any).error).toMatch(/public IP/i);
    expect((res as any).error).toMatch(/1011102/);
  });

  it("surfaces generic Namecheap errors with code and text", async () => {
    const store = freshStore();
    seedAcme(store);
    const GENERIC_ERROR_XML = IP_ERROR_XML.replace("1011102", "2030280").replace(
      "API Key is invalid or API access has not been enabled",
      "TLD is not supported in API",
    );
    fetchMock = vi.fn(withDashclawRoute(() => mockXml(GENERIC_ERROR_XML)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.checkDomainAvailability(store, { environment: "staging", domains: ["x.weirdtld"] });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/2030280/);
    expect((res as any).error).toMatch(/TLD is not supported/i);
  });
});

describe("Neon", () => {
  // Obviously-fake fixture URI: placeholder credentials only, never a real secret.
  const NEON_URI =
    "postgresql://neondb_owner:test-placeholder-password@ep-test-123.us-east-1.aws.neon.tech/neondb?sslmode=require";

  beforeEach(() => {
    process.env.NEON_API_KEY = "neon_dummy";
  });

  afterEach(() => {
    delete process.env.NEON_API_KEY;
  });

  function dashclawBodies(): string {
    return fetchMock.mock.calls
      .filter(([url]) => typeof url === "string" && url.startsWith("https://dashclaw.example"))
      .map(([, init]) => String(init?.body ?? ""))
      .join(" ");
  }

  it("lists Neon projects with Bearer auth against the v2 API", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute(() =>
        mockOk({
          projects: [
            { id: "proj-1", name: "acme-db", region_id: "aws-us-east-1", pg_version: 17, created_at: "2026-06-10T00:00:00Z" },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.neonListProjects(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      { id: "proj-1", name: "acme-db", regionId: "aws-us-east-1", pgVersion: 17, createdAt: "2026-06-10T00:00:00Z" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer neon_dummy" }),
      }),
    );
  });

  it("creates a Neon project with the right body and returns the connection URI exactly once", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute(() =>
        mockOk({
          project: { id: "proj-new", name: "acme-db", region_id: "aws-us-east-1", pg_version: 17 },
          branch: { id: "br-1" },
          connection_uris: [{ connection_uri: NEON_URI }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.neonCreateProject(store, { environment: "staging", name: "acme-db" });

    expect(res.status).toBe("ok");
    const [url, init] = providerCalls()[0]!;
    expect(url).toBe("https://console.neon.tech/api/v2/projects");
    expect(JSON.parse(init.body)).toMatchObject({ project: { name: "acme-db" } });
    expect((res as any).data).toMatchObject({
      project: { id: "proj-new", name: "acme-db" },
      branchId: "br-1",
      connectionUri: NEON_URI,
    });
    // The URI reaches the calling agent exactly once, in the tool result only.
    expect(JSON.stringify(res).split(NEON_URI)).toHaveLength(2);
  });

  it("returns the connection URI for a project via query params", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockOk({ connection_uri: NEON_URI })));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.neonGetConnectionUri(store, {
      environment: "staging",
      neonProjectId: "proj-new",
      databaseName: "neondb",
      roleName: "neondb_owner",
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({ connectionUri: NEON_URI });
    const [url] = providerCalls()[0]!;
    expect(url).toContain("https://console.neon.tech/api/v2/projects/proj-new/connection_uri?");
    expect(url).toContain("database_name=neondb");
    expect(url).toContain("role_name=neondb_owner");
  });

  it("keeps the connection URI out of audit entries and DashClaw payloads", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute((url) =>
        url.endsWith("/connection_uri") || url.includes("/connection_uri?")
          ? mockOk({ connection_uri: NEON_URI })
          : mockOk({
              project: { id: "proj-new", name: "acme-db" },
              branch: { id: "br-1" },
              connection_uris: [{ connection_uri: NEON_URI }],
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await pa.neonCreateProject(store, { environment: "staging", name: "acme-db" });
    const fetched = await pa.neonGetConnectionUri(store, {
      environment: "staging",
      neonProjectId: "proj-new",
      databaseName: "neondb",
      roleName: "neondb_owner",
    });

    expect(created.status).toBe("ok");
    expect(fetched.status).toBe("ok");
    // Both audit entries exist and neither carries the URI or its credentials.
    const audit = listAuditLog(store, { project: "acme-crm" });
    expect(audit.filter((e) => e.tool === "create_neon_project")).toHaveLength(1);
    expect(audit.filter((e) => e.tool === "get_neon_connection_uri")).toHaveLength(1);
    const auditJson = JSON.stringify(audit);
    expect(auditJson).not.toContain("postgres");
    expect(auditJson).not.toContain("test-placeholder-password");
    // No DashClaw guard/outcome payload contains the URI or its credentials.
    const bodies = dashclawBodies();
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies).not.toContain("postgres://");
    expect(bodies).not.toContain("postgresql://");
    expect(bodies).not.toContain("test-placeholder-password");
  });
});

describe("Vercel", () => {
  it("uses the mapping connection token and team scope for Vercel calls", async () => {
    const store = freshStore();
    seedAcme(store);
    process.env.CUSTOM_VERCEL_TOKEN = "vc_custom";
    store.update((s) => {
      s.connections.push({
        id: "conn_custom_vercel",
        workspaceId: s.defaultWorkspaceId!,
        provider: "vercel",
        label: "custom-vercel",
        auth: { kind: "env", envVar: "CUSTOM_VERCEL_TOKEN" },
        scope: { vercelTeamId: "team_custom" },
        createdAt: new Date().toISOString(),
      });
    });
    mapProviderResource(store, {
      environment: "staging",
      provider: "vercel",
      connectionId: "conn_custom_vercel",
      resource: { provider: "vercel", projectId: "acme-preview" },
    });
    fetchMock.mockResolvedValueOnce(mockOk({ deployments: [] }));

    const res = await pa.vercelDeployments(store, { environment: "staging", limit: 3 });

    expect(res.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://api.vercel.com/v7/deployments?teamId=team_custom"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer vc_custom" }),
      }),
    );
  });

  it("rejects invalid deployment list limits before calling Vercel", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.vercelDeployments(store, { environment: "staging", limit: -1 });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/limit/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a Vercel project against v11 with capability write", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(withDashclawRoute(() => mockOk({ id: "prj_new", name: "acme-site", framework: "nextjs" })));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.vercelCreateProject(store, { environment: "staging", name: "acme-site", framework: "nextjs" });

    expect(res.status).toBe("ok");
    const [url, init] = providerCalls()[0]!;
    expect(url).toContain("https://api.vercel.com/v11/projects");
    expect(JSON.parse(init.body)).toMatchObject({ name: "acme-site", framework: "nextjs" });
    expect((res as any).data).toMatchObject({ id: "prj_new", name: "acme-site" });
    const guardBody = String(
      fetchMock.mock.calls.find(([u]: [string]) => u === "https://dashclaw.example/api/guard")?.[1]?.body,
    );
    expect(guardBody).toContain('"capability":"write"');
  });

  it("adds an apex domain to a Vercel project and returns A-record DNS target info", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute(() =>
        mockOk({
          name: "example.com",
          apexName: "example.com",
          projectId: "prj_new",
          verified: false,
          verification: [
            { type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=example", reason: "pending" },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.vercelAddDomain(store, { environment: "staging", vercelProject: "prj_new", domain: "example.com" });

    expect(res.status).toBe("ok");
    const [url, init] = providerCalls()[0]!;
    expect(url).toContain("/v10/projects/prj_new/domains");
    expect(JSON.parse(init.body)).toMatchObject({ name: "example.com" });
    expect((res as any).data).toMatchObject({
      name: "example.com",
      verified: false,
      dnsTarget: { type: "A", host: "@", value: "76.76.21.21" },
      verification: [expect.objectContaining({ type: "TXT" })],
    });
  });

  it("returns CNAME DNS target info for a subdomain", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute(() =>
        mockOk({ name: "www.example.com", apexName: "example.com", projectId: "prj_new", verified: true }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.vercelAddDomain(store, {
      environment: "staging",
      vercelProject: "prj_new",
      domain: "www.example.com",
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toMatchObject({
      name: "www.example.com",
      dnsTarget: { type: "CNAME", host: "www", value: "cname.vercel-dns.com" },
    });
  });

  it("requires approval for production deploys and does NOT execute them", async () => {
    setDashclawDecision("require_approval", "vercel_prod_deploy");
    const store = freshStore();
    seedAcme(store);
    const res = await pa.vercelCreateDeployment(store, { environment: "production" });
    expect(res.status).toBe("approval_required");
    expect((res as any).approval_id).toBe("act_vercel_prod_deploy");
    expect(providerCalls()).toHaveLength(0);
    expect(listPendingApprovals(store, { project: "acme-crm" })).toHaveLength(0);
  });

  it("executes a production deploy when DashClaw allows it", async () => {
    const store = freshStore();
    seedAcme(store);

    const res = await pa.vercelCreateDeployment(store, { environment: "production" });

    expect(res.status).toBe("ok");
    expect(providerCalls()).toHaveLength(1);
    expect(listPendingApprovals(store, { project: "acme-crm" })).toHaveLength(0);
    expect(lastAudit(store)).toMatchObject({
      result: "success",
      policyDecision: "allow",
      dashclawDecisionId: "gd_allow",
      dashclawActionId: "act_allow",
      auditCorrelationId: expect.stringMatching(/^audit_/),
    });
    expect((res as any).dashclaw).toMatchObject({ outcome_recorded: true });
  });

  it("keeps production deploys gated while DashClaw requires approval", async () => {
    setDashclawDecision("require_approval", "vercel_retry");
    const store = freshStore();
    seedAcme(store);
    const gated = await pa.vercelCreateDeployment(store, { environment: "production" });
    expect(gated.status).toBe("approval_required");

    const rerun = await pa.vercelCreateDeployment(store, { environment: "production" });
    expect(rerun.status).toBe("approval_required");
    expect((rerun as any).approval_id).toBe("act_vercel_retry");
    expect(providerCalls()).toHaveLength(0);
    expect(listPendingApprovals(store, { project: "acme-crm" })).toHaveLength(0);
  });

  it("requires approval for production env-var changes", async () => {
    setDashclawDecision("require_approval", "vercel_env");
    const store = freshStore();
    seedAcme(store);
    const res = await pa.vercelSetEnvVar(store, {
      environment: "production",
      key: "DATABASE_URL",
      value: "postgres://...",
    });
    expect(res.status).toBe("approval_required");
    expect(providerCalls()).toHaveLength(0);
  });

  it("rejects empty env-var keys before calling Vercel", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.vercelSetEnvVar(store, {
      environment: "staging",
      key: "   ",
      value: "value",
    });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/key/i);
    expect(providerCalls()).toHaveLength(0);
  });

  it("sets multiple Vercel env vars through one governed action without leaking values", async () => {
    const store = freshStore();
    seedAcme(store);
    const bodies: any[] = [];
    fetchMock.mockImplementation(
      withDashclawRoute((url: string, init?: any) => {
        expect(url).toBe("https://api.vercel.com/v10/projects/acme-crm-preview/env?upsert=true");
        const body = JSON.parse(init.body);
        bodies.push(body);
        return mockOk({ id: `env_${body.key}`, key: body.key });
      }),
    );

    const res = await pa.setAppEnvVars(store, {
      environment: "staging",
      targetProvider: "vercel",
      vars: [
        { key: "DATABASE_URL", value: "postgres://secret" },
        { key: "STRIPE_WEBHOOK_SECRET", value: "whsec_secret" },
      ],
      target: ["preview"],
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      targetProvider: "vercel",
      count: 2,
      keys: ["DATABASE_URL", "STRIPE_WEBHOOK_SECRET"],
    });
    expect(providerCalls()).toHaveLength(2);
    expect(bodies).toEqual([
      { key: "DATABASE_URL", value: "postgres://secret", type: "encrypted", target: ["preview"] },
      { key: "STRIPE_WEBHOOK_SECRET", value: "whsec_secret", type: "encrypted", target: ["preview"] },
    ]);
    const guardBody = String(fetchMock.mock.calls.find(([url]) => url === "https://dashclaw.example/api/guard")?.[1]?.body);
    expect(guardBody).toContain('"tool":"set_app_env_vars"');
    expect(guardBody).toContain('"capability":"env_change"');
    expect(guardBody).not.toContain("postgres://secret");
    expect(guardBody).not.toContain("whsec_secret");
    expect(JSON.stringify(lastAudit(store))).not.toContain("postgres://secret");
    expect(JSON.stringify(lastAudit(store))).not.toContain("whsec_secret");
  });

  it("rejects duplicate bulk env-var keys before calling the target provider", async () => {
    const store = freshStore();
    seedAcme(store);

    const res = await pa.setAppEnvVars(store, {
      environment: "staging",
      targetProvider: "vercel",
      vars: [
        { key: "DATABASE_URL", value: "one" },
        { key: "DATABASE_URL", value: "two" },
      ],
    });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/duplicate/i);
    expect(providerCalls()).toHaveLength(0);
  });

  it("allows and executes a non-production (preview) deploy", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.vercelCreateDeployment(store, { environment: "staging" });
    expect(res.status).toBe("ok");
    expect(providerCalls()).toHaveLength(1);
  });

  it("does not execute an allowed provider action when the audit log cannot be reserved", async () => {
    const store = freshStore();
    seedAcme(store);
    mkdirSync(`${store.paths.audit}.lock`);

    const res = await pa.vercelCreateDeployment(store, { environment: "staging" });

    expect(res.status).toBe("error");
    expect(res.executed).toBe(false);
    expect((res as any).error).toMatch(/audit/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("App logs", () => {
  /** Route a mocked fetch by URL to the right Vercel endpoint payload. */
  function routeVercel(opts: { deployments?: any[]; events?: any[]; status?: any }) {
    return (url: string) => {
      if (url.includes("/v7/deployments")) return mockOk({ deployments: opts.deployments ?? [] });
      if (/\/v3\/deployments\/[^/]+\/events/.test(url)) return mockOk(opts.events ?? []);
      if (url.includes("/v13/deployments/")) return mockOk(opts.status ?? {});
      return mockOk({});
    };
  }

  const LATEST = { uid: "dpl_123", url: "acme.vercel.app", readyState: "ERROR", state: "ERROR", created: 1700000000000 };

  it("get_vercel_logs resolves the latest deployment and returns normalized logs", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockImplementation(async (url: string) =>
      routeVercel({
        deployments: [LATEST],
        events: [
          { type: "stdout", created: 1700000001000, text: "Building..." },
          { type: "stderr", created: 1700000002000, text: "Error: DATABASE_URL is missing" },
        ],
      })(url),
    );

    const res = await pa.vercelLogs(store, { environment: "staging" });
    expect(res.status).toBe("ok");
    const data = (res as any).data;
    expect(data.resource.deployment_id).toBe("dpl_123");
    expect(data.resource.deployment_status).toBe("ERROR");
    expect(data.resource.deployment_url).toBe("https://acme.vercel.app");
    expect(data.logs).toHaveLength(2);
    expect(data.logs[1]).toMatchObject({ level: "error", message: "Error: DATABASE_URL is missing" });
    expect(data.audit_written).toBe(true);
    expect(lastAudit(store)).toMatchObject({ result: "success", policyDecision: "allow", provider: "vercel", tool: "get_vercel_logs" });
  });

  it("redacts secrets that appear in log lines", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockImplementation(async (url: string) =>
      routeVercel({
        deployments: [LATEST],
        events: [{ type: "stdout", created: 1700000001000, text: "Using key sk_live_ABCDEFGH123456789" }],
      })(url),
    );
    const res = await pa.vercelLogs(store, { environment: "staging" });
    const msg = (res as any).data.logs[0].message;
    expect(msg).not.toContain("sk_live_ABCDEFGH123456789");
    expect(msg).toContain("REDACTED");
  });

  it("returns a limitation (not an error) when the events API yields no logs", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockImplementation(async (url: string) => routeVercel({ deployments: [LATEST], events: [] })(url));
    const res = await pa.vercelLogs(store, { environment: "staging" });
    expect(res.status).toBe("ok");
    const data = (res as any).data;
    expect(data.logs).toHaveLength(0);
    expect(typeof data.limitation).toBe("string");
  });

  it("rejects invalid since filters before calling Vercel", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.vercelLogs(store, { environment: "staging", since: "not a timestamp" });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/since/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("get_app_logs with no provider discovers the mapped Vercel project and audits the read", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockImplementation(async (url: string) =>
      routeVercel({ deployments: [LATEST], events: [{ type: "stdout", created: 1700000001000, text: "ok" }] })(url),
    );
    const res = await pa.appLogs(store, { environment: "staging" });
    expect(res.status).toBe("ok");
    expect(res.providers).toHaveLength(1);
    expect((res.providers[0] as any).provider).toBe("vercel");
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "vercel", tool: "get_app_logs" });
  });

  it("get_latest_deployment_logs returns a clear limitation for unsupported providers", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.latestDeploymentLogs(store, { environment: "staging", provider: "supabase" });
    expect(res.status).toBe("ok");
    expect((res as any).data.limitation).toMatch(/not supported/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Railway logs", () => {
  function mapRailway(store: Store) {
    mapProviderResource(store, {
      project: "acme-crm",
      environment: "staging",
      provider: "railway",
      resource: { provider: "railway", projectId: "rw_proj_1", environmentId: "rw_env_1", serviceId: "rw_svc_1" },
    });
  }

  /** Route a mocked fetch (GraphQL POST) by inspecting the query body. */
  function routeRailway(opts: { project?: any; deployments?: any[]; logs?: any[]; errors?: any[] }) {
    return (_url: string, init?: any) => {
      if (opts.errors) return mockOk({ errors: opts.errors });
      const q = init?.body ? JSON.parse(init.body).query ?? "" : "";
      if (q.includes("deploymentLogs")) return mockOk({ data: { deploymentLogs: opts.logs ?? [] } });
      if (q.includes("deployments(")) {
        return mockOk({ data: { deployments: { edges: (opts.deployments ?? []).map((node) => ({ node })) } } });
      }
      if (q.includes("project(")) return mockOk({ data: { project: opts.project ?? null } });
      return mockOk({ data: {} });
    };
  }

  const RW_LATEST = { id: "rw_dpl_1", status: "FAILED", staticUrl: "acme.up.railway.app", createdAt: "2026-06-09T12:00:00Z" };

  beforeEach(() => {
    process.env.RAILWAY_TOKEN = "rw_dummy";
  });

  it("get_railway_logs resolves the latest deployment and normalizes severity", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailway(store);
    fetchMock.mockImplementation(async (url: string, init: any) =>
      routeRailway({
        deployments: [RW_LATEST],
        logs: [
          { timestamp: "2026-06-09T12:00:01Z", severity: "info", message: "Starting container" },
          { timestamp: "2026-06-09T12:00:02Z", severity: "err", message: "Boom: missing DATABASE_URL" },
        ],
      })(url, init),
    );

    const res = await pa.railwayLogs(store, { environment: "staging" });
    expect(res.status).toBe("ok");
    const data = (res as any).data;
    expect(data.resource.deployment_id).toBe("rw_dpl_1");
    expect(data.resource.deployment_status).toBe("FAILED");
    expect(data.resource.deployment_url).toBe("https://acme.up.railway.app");
    expect(data.logs).toHaveLength(2);
    expect(data.logs[1]).toMatchObject({ level: "error", message: "Boom: missing DATABASE_URL" });
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "railway", tool: "get_railway_logs" });
  });

  it("rejects invalid log limits before calling Railway", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailway(store);
    const res = await pa.railwayLogs(store, { environment: "staging", limit: -5 });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/limit/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid since filters before calling Railway", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailway(store);
    const res = await pa.railwayLogs(store, { environment: "staging", since: "not a timestamp" });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/since/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("get_app_logs with no provider reads BOTH vercel and railway (vercel first)", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailway(store);
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (url.includes("backboard.railway")) {
        return routeRailway({ deployments: [RW_LATEST], logs: [{ timestamp: "t", severity: "info", message: "rw" }] })(url, init);
      }
      // Vercel REST
      if (url.includes("/v7/deployments")) return mockOk({ deployments: [{ uid: "vc_1", url: "v.app", readyState: "READY", created: 1 }] });
      if (/\/v3\/deployments\/[^/]+\/events/.test(url)) return mockOk([{ type: "stdout", created: 1, text: "vc" }]);
      return mockOk({});
    });

    const res = await pa.appLogs(store, { environment: "staging" });
    expect(res.status).toBe("ok");
    expect(res.providers.map((p: any) => p.provider)).toEqual(["vercel", "railway"]);
  });

  it("get_latest_deployment_logs works for provider=railway", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailway(store);
    fetchMock.mockImplementation(async (url: string, init: any) =>
      routeRailway({ deployments: [RW_LATEST], logs: [] })(url, init),
    );
    const res = await pa.latestDeploymentLogs(store, { environment: "staging", provider: "railway" });
    expect(res.status).toBe("ok");
    expect((res as any).data.resource.deployment_id).toBe("rw_dpl_1");
    // No log lines -> a clear limitation, still ok + audited.
    expect((res as any).data.limitation).toBeTruthy();
    expect(lastAudit(store)).toMatchObject({ provider: "railway", tool: "get_latest_deployment_logs", result: "success" });
  });

  it("surfaces a GraphQL error as a clean error envelope", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailway(store);
    fetchMock.mockImplementation(async (url: string, init: any) =>
      routeRailway({ errors: [{ message: "Not Authorized" }] })(url, init),
    );
    const res = await pa.railwayDeployments(store, { environment: "staging" });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/Not Authorized/);
  });
});

describe("Railway writes", () => {
  function mapRailwayTo(store: Store, environment: string) {
    mapProviderResource(store, {
      project: "acme-crm",
      environment,
      provider: "railway",
      resource: { provider: "railway", projectId: "rw_proj_1", environmentId: "rw_env_1", serviceId: "rw_svc_1" },
    });
  }

  function routeMutations() {
    return (_url: string, init?: any) => {
      const q = init?.body ? JSON.parse(init.body).query ?? "" : "";
      if (q.includes("environmentTriggersDeploy")) return mockOk({ data: { environmentTriggersDeploy: "rw_dpl_new" } });
      if (q.includes("deploymentRedeploy")) return mockOk({ data: { deploymentRedeploy: { id: "rw_dpl_re", status: "BUILDING" } } });
      if (q.includes("variableUpsert")) return mockOk({ data: { variableUpsert: true } });
      return mockOk({ data: {} });
    };
  }

  beforeEach(() => {
    process.env.RAILWAY_TOKEN = "rw_dummy";
  });

  it("allows and executes a staging deploy", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailwayTo(store, "staging");
    fetchMock.mockImplementation(withDashclawRoute((url: string, init: any) => routeMutations()(url, init)));
    const res = await pa.railwayCreateDeployment(store, { environment: "staging" });
    expect(res.status).toBe("ok");
    expect((res as any).data.deploymentId).toBe("rw_dpl_new");
    expect(providerCalls()).toHaveLength(1);
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "railway", tool: "create_railway_deployment" });
  });

  it("requires approval for a production deploy and does NOT execute", async () => {
    setDashclawDecision("require_approval", "railway_prod_deploy");
    const store = freshStore();
    seedAcme(store);
    mapRailwayTo(store, "production");
    fetchMock.mockImplementation(withDashclawRoute((url: string, init: any) => routeMutations()(url, init)));
    const res = await pa.railwayCreateDeployment(store, { environment: "production" });
    expect(res.status).toBe("approval_required");
    expect(providerCalls()).toHaveLength(0);
    expect(lastAudit(store)).toMatchObject({
      result: "not_executed",
      policyDecision: "approval_required",
      dashclawDecisionId: "gd_railway_prod_deploy",
      dashclawActionId: "act_railway_prod_deploy",
    });
  });

  it("requires approval for a production variable change and does NOT execute", async () => {
    setDashclawDecision("require_approval", "railway_prod_var");
    const store = freshStore();
    seedAcme(store);
    mapRailwayTo(store, "production");
    fetchMock.mockImplementation(withDashclawRoute((url: string, init: any) => routeMutations()(url, init)));
    const res = await pa.railwaySetEnvVar(store, { environment: "production", key: "DATABASE_URL", value: "postgres://..." });
    expect(res.status).toBe("approval_required");
    expect(providerCalls()).toHaveLength(0);
  });

  it("allows and executes a staging variable change", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailwayTo(store, "staging");
    fetchMock.mockImplementation(withDashclawRoute((url: string, init: any) => routeMutations()(url, init)));
    const res = await pa.railwaySetEnvVar(store, { environment: "staging", key: "FEATURE_FLAG", value: "on" });
    expect(res.status).toBe("ok");
    expect(providerCalls()).toHaveLength(1);
    const body = JSON.parse((providerCalls()[0]![1] as RequestInit).body as string);
    expect(body.variables.input).toMatchObject({ name: "FEATURE_FLAG", value: "on", environmentId: "rw_env_1" });
  });

  it("sets multiple Railway env vars through one governed action", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailwayTo(store, "staging");
    fetchMock.mockImplementation(withDashclawRoute((url: string, init: any) => routeMutations()(url, init)));

    const res = await pa.setAppEnvVars(store, {
      environment: "staging",
      targetProvider: "railway",
      vars: [
        { key: "DATABASE_URL", value: "postgres://secret" },
        { key: "RESEND_API_KEY", value: "re_secret" },
      ],
      skipDeploys: true,
    });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual({
      targetProvider: "railway",
      count: 2,
      keys: ["DATABASE_URL", "RESEND_API_KEY"],
    });
    expect(providerCalls()).toHaveLength(2);
    const first = JSON.parse((providerCalls()[0]![1] as RequestInit).body as string);
    const second = JSON.parse((providerCalls()[1]![1] as RequestInit).body as string);
    expect(first.variables.input).toMatchObject({
      projectId: "rw_proj_1",
      environmentId: "rw_env_1",
      serviceId: "rw_svc_1",
      name: "DATABASE_URL",
      value: "postgres://secret",
      skipDeploys: true,
    });
    expect(second.variables.input).toMatchObject({
      name: "RESEND_API_KEY",
      value: "re_secret",
      skipDeploys: true,
    });
    expect(JSON.stringify(lastAudit(store))).not.toContain("postgres://secret");
    expect(JSON.stringify(lastAudit(store))).not.toContain("re_secret");
  });

  it("rejects empty variable keys before calling Railway", async () => {
    const store = freshStore();
    seedAcme(store);
    mapRailwayTo(store, "staging");
    fetchMock.mockImplementation(withDashclawRoute((url: string, init: any) => routeMutations()(url, init)));
    const res = await pa.railwaySetEnvVar(store, { environment: "staging", key: " ", value: "on" });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/key/i);
    expect(providerCalls()).toHaveLength(0);
  });
});

describe("Supabase", () => {
  it("blocks destructive SQL everywhere and does NOT execute", async () => {
    setDashclawDecision("block", "supabase_destructive");
    const store = freshStore();
    seedAcme(store);
    const res = await pa.supabaseQuery(store, { environment: "staging", sql: "DROP TABLE users" });
    expect(res.status).toBe("blocked");
    expect(providerCalls()).toHaveLength(0);
    expect(lastAudit(store)).toMatchObject({
      result: "not_executed",
      policyDecision: "block",
      dashclawDecisionId: "gd_supabase_destructive",
      dashclawActionId: "act_supabase_destructive",
    });
  });

  it("requires approval for a production DB write and does NOT execute", async () => {
    setDashclawDecision("require_approval", "supabase_prod_write");
    const store = freshStore();
    seedAcme(store);
    const res = await pa.supabaseQuery(store, {
      environment: "production",
      sql: "INSERT INTO users (id) VALUES (1)",
    });
    expect(res.status).toBe("approval_required");
    expect(providerCalls()).toHaveLength(0);
  });

  it("allows a read-only SELECT and sends read_only=true", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk([{ count: 5 }]));
    const res = await pa.supabaseQuery(store, { environment: "production", sql: "SELECT count(*) FROM users" });
    expect(res.status).toBe("ok");
    expect(providerCalls()).toHaveLength(1);
    const body = JSON.parse((providerCalls()[0]![1] as RequestInit).body as string);
    expect(body.read_only).toBe(true);
  });

  it("rejects empty SQL before calling Supabase", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.supabaseQuery(store, { environment: "staging", sql: "   " });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/sql/i);
    expect(providerCalls()).toHaveLength(0);
  });
});

describe("Stripe webhooks", () => {
  // Built via concatenation so no secret-shaped literal sits in the repo.
  const FAKE_WHSEC = ["whsec", "testplaceholder123"].join("_");

  it("creates a webhook endpoint with indexed enabled_events and returns the signing secret once", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute(() =>
        mockOk({
          id: "we_1",
          url: "https://example.com/api/stripe/webhook",
          enabled_events: ["checkout.session.completed", "invoice.paid"],
          status: "enabled",
          secret: FAKE_WHSEC,
          created: 1,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.stripeCreateWebhook(store, {
      environment: "staging",
      url: "https://example.com/api/stripe/webhook",
      enabledEvents: ["checkout.session.completed", "invoice.paid"],
    });

    expect(res.status).toBe("ok");
    const [url, init] = providerCalls()[0]!;
    expect(url).toBe("https://api.stripe.com/v1/webhook_endpoints");
    expect(init.body).toContain("enabled_events%5B0%5D=checkout.session.completed");
    expect(init.body).toContain("enabled_events%5B1%5D=invoice.paid");
    expect((res as any).data).toMatchObject({ id: "we_1", secret: FAKE_WHSEC });
    // Secret appears exactly once, in the tool result only.
    expect(JSON.stringify(res).split(FAKE_WHSEC)).toHaveLength(2);
    // Capability write reaches the DashClaw guard payload.
    const guardBody = String(
      fetchMock.mock.calls.find(([u]: [string]) => u === "https://dashclaw.example/api/guard")?.[1]?.body,
    );
    expect(guardBody).toContain('"capability":"write"');
  });

  it("keeps the webhook signing secret out of audit entries and DashClaw payloads", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute(() =>
        mockOk({ id: "we_1", url: "https://example.com/api/stripe/webhook", secret: FAKE_WHSEC, created: 1 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.stripeCreateWebhook(store, {
      environment: "staging",
      url: "https://example.com/api/stripe/webhook",
      enabledEvents: ["checkout.session.completed"],
    });

    expect(res.status).toBe("ok");
    const audit = listAuditLog(store, { project: "acme-crm" });
    expect(audit.filter((e) => e.tool === "create_stripe_webhook")).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("whsec");
    const dashclawBodies = fetchMock.mock.calls
      .filter(([u]: [string]) => typeof u === "string" && u.startsWith("https://dashclaw.example"))
      .map(([, init]: [string, any]) => String(init?.body ?? ""))
      .join(" ");
    expect(dashclawBodies.length).toBeGreaterThan(0);
    expect(dashclawBodies).not.toContain("whsec");
  });

  it("lists webhook endpoints", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock = vi.fn(
      withDashclawRoute(() =>
        mockOk({
          data: [
            { id: "we_1", url: "https://example.com/api/stripe/webhook", status: "enabled", enabled_events: ["invoice.paid"], created: 1 },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await pa.stripeListWebhooks(store, { environment: "staging" });

    expect(res.status).toBe("ok");
    expect((res as any).data).toEqual([
      expect.objectContaining({ id: "we_1", url: "https://example.com/api/stripe/webhook", status: "enabled" }),
    ]);
    expect(providerCalls()[0]![0]).toContain("https://api.stripe.com/v1/webhook_endpoints");
  });
});

describe("missing-credential error messages name the exact env var", () => {
  it("Neon actions name NEON_API_KEY", async () => {
    const store = freshStore();
    seedAcme(store);

    const res = await pa.neonListProjects(store, { environment: "staging" });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/NEON_API_KEY/);
  });

  it("Namecheap actions name NAMECHEAP_API_KEY when the key is missing", async () => {
    const store = freshStore();
    seedAcme(store);

    const res = await pa.checkDomainAvailability(store, { environment: "staging", domains: ["example.com"] });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/NAMECHEAP_API_KEY/);
  });

  it("Namecheap actions name NAMECHEAP_API_USER when only the key is set", async () => {
    process.env.NAMECHEAP_API_KEY = "nc_dummy_key";
    try {
      const store = freshStore();
      seedAcme(store);

      const res = await pa.checkDomainAvailability(store, { environment: "staging", domains: ["example.com"] });

      expect(res.status).toBe("error");
      expect((res as any).error).toMatch(/NAMECHEAP_API_USER/);
    } finally {
      delete process.env.NAMECHEAP_API_KEY;
    }
  });

  it("Namecheap actions name NAMECHEAP_CLIENT_IP and the whitelist requirement", async () => {
    process.env.NAMECHEAP_API_KEY = "nc_dummy_key";
    process.env.NAMECHEAP_API_USER = "ncuser";
    try {
      const store = freshStore();
      seedAcme(store);

      const res = await pa.checkDomainAvailability(store, { environment: "staging", domains: ["example.com"] });

      expect(res.status).toBe("error");
      expect((res as any).error).toMatch(/NAMECHEAP_CLIENT_IP/);
      expect((res as any).error).toMatch(/whitelist/i);
    } finally {
      delete process.env.NAMECHEAP_API_KEY;
      delete process.env.NAMECHEAP_API_USER;
    }
  });

  it("Vercel project creation names VERCEL_TOKEN", async () => {
    delete process.env.VERCEL_TOKEN;
    const store = freshStore();
    seedAcme(store);

    const res = await pa.vercelCreateProject(store, { environment: "staging", name: "acme-site" });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/VERCEL_TOKEN/);
  });

  it("Stripe webhook creation names STRIPE_TEST_SECRET_KEY", async () => {
    delete process.env.STRIPE_TEST_SECRET_KEY;
    const store = freshStore();
    seedAcme(store);

    const res = await pa.stripeCreateWebhook(store, {
      environment: "staging",
      url: "https://example.com/api/stripe/webhook",
      enabledEvents: ["invoice.paid"],
    });

    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/STRIPE_TEST_SECRET_KEY/);
  });
});

describe("Stripe price validation", () => {
  it("lists Stripe customers through the guarded read path", async () => {
    const store = freshStore();
    seedAcme(store);
    fetchMock.mockResolvedValueOnce(mockOk({ data: [{ id: "cus_123", email: "a@example.com", name: "Ada", created: 1 }] }));

    const res = await pa.stripeListCustomers(store, { environment: "staging", limit: 1 });

    expect(res.status).toBe("ok");
    expect((res as any).data[0]).toMatchObject({ id: "cus_123", email: "a@example.com" });
    expect(lastAudit(store)).toMatchObject({ result: "success", provider: "stripe", tool: "list_stripe_customers" });
  });

  it("rejects empty product names before calling Stripe", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.stripeCreateProduct(store, {
      environment: "staging",
      name: "   ",
    });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/name/i);
    expect(providerCalls()).toHaveLength(0);
  });

  it("rejects non-positive price amounts before calling Stripe", async () => {
    const store = freshStore();
    seedAcme(store);
    const res = await pa.stripeCreatePrice(store, {
      environment: "staging",
      product: "prod_123",
      currency: "usd",
      unitAmount: 0,
    });
    expect(res.status).toBe("error");
    expect((res as any).error).toMatch(/unitAmount/i);
    expect(providerCalls()).toHaveLength(0);
  });
});

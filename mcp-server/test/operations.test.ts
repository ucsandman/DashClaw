import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { freshStore, seedAcme } from "./helpers.js";
import { applyConfig } from "../src/config.js";
import {
  createConnection,
  dashclawRecentDecisions,
  dashclawStatus,
  doctor,
  explainActionRisk,
  exportAuditLog,
  exportContextSnapshot,
  exportDashclawEvidence,
  governedActionSummary,
  listConnections,
  simulateAction,
} from "../src/service.js";

describe("operational readiness", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.VERCEL_TOKEN;
    delete process.env.CUSTOM_SENTRY_A_TOKEN;
    delete process.env.CUSTOM_SENTRY_B_TOKEN;
    delete process.env.STRIPE_TEST_SECRET_KEY;
    delete process.env.STRIPE_LIVE_SECRET_KEY;
    delete process.env.UPSTASH_EMAIL;
    delete process.env.UPSTASH_API_KEY;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.NAMECHEAP_API_KEY;
    delete process.env.NAMECHEAP_API_USER;
    delete process.env.NAMECHEAP_CLIENT_IP;
  });

  it("creates and lists explicit provider connections without storing secrets", () => {
    const store = freshStore();

    const created = createConnection(store, {
      provider: "vercel",
      label: "team-a",
      envVar: "VERCEL_TEAM_A_TOKEN",
      vercelTeamId: "team_a",
    });

    expect(created).toMatchObject({
      provider: "vercel",
      label: "team-a",
      auth: { kind: "env", envVar: "VERCEL_TEAM_A_TOKEN" },
      scope: { vercelTeamId: "team_a" },
    });
    expect(JSON.stringify(created)).not.toContain("TOKEN_VALUE");
    expect(listConnections(store)).toEqual([created]);
  });

  it("rejects duplicate connection labels per provider", () => {
    const store = freshStore();
    createConnection(store, { provider: "github", label: "main", envVar: "GITHUB_TOKEN" });

    expect(() =>
      createConnection(store, { provider: "github", label: "main", envVar: "GITHUB_TOKEN_2" }),
    ).toThrow(/already exists/i);
  });

  it("simulates policy decisions without writing audit entries", () => {
    const store = freshStore();
    seedAcme(store);

    const decision = simulateAction(store, {
      project: "acme-crm",
      environment: "production",
      provider: "vercel",
      capability: "deploy",
    });

    expect(decision).toMatchObject({
      project: "acme-crm",
      environment: "production",
      provider: "vercel",
      capability: "deploy",
      effect: "approval_required",
      wouldExecute: false,
    });
    expect(store.readAudit()).toHaveLength(0);
  });

  it("reports doctor checks for mappings, env vars, and audit writability", () => {
    const store = freshStore();
    seedAcme(store);
    delete process.env.GITHUB_TOKEN;
    process.env.VERCEL_TOKEN = "vc_dummy";
    process.env.SUPABASE_ACCESS_TOKEN = "sb_dummy";
    mkdirSync(`${store.paths.audit}.lock`);

    const report = doctor(store, { project: "acme-crm", environment: "staging" });

    expect(report.status).toBe("fail");
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "project", status: "pass" }),
        expect.objectContaining({ id: "environment", status: "pass" }),
        expect.objectContaining({ id: "mapping.github", status: "pass" }),
        expect.objectContaining({ id: "env.github", status: "warn" }),
        expect.objectContaining({ id: "env.vercel", status: "pass" }),
        expect.objectContaining({ id: "audit.writable", status: "fail" }),
      ]),
    );
  });

  it("reports global provider credential checks when no project is selected", () => {
    const store = freshStore();
    process.env.GITHUB_TOKEN = "gh_dummy";
    delete process.env.VERCEL_TOKEN;
    delete process.env.STRIPE_LIVE_SECRET_KEY;
    delete process.env.QSTASH_TOKEN;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.NAMECHEAP_CLIENT_IP;

    const report = doctor(store);

    expect(report.status).toBe("warn");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "project", status: "warn" }),
        expect.objectContaining({ id: "env.github", status: "pass", message: expect.stringContaining("GITHUB_TOKEN") }),
        expect.objectContaining({ id: "env.vercel", status: "warn", message: expect.stringContaining("VERCEL_TOKEN") }),
        expect.objectContaining({ id: "env.stripe.stripe_live_secret_key", status: "warn", message: expect.stringContaining("STRIPE_LIVE_SECRET_KEY") }),
        expect.objectContaining({ id: "env.upstash.qstash_token", status: "warn", message: expect.stringContaining("QSTASH_TOKEN") }),
        expect.objectContaining({ id: "env.cloudflare_r2.r2_secret_access_key", status: "warn", message: expect.stringContaining("R2_SECRET_ACCESS_KEY") }),
        expect.objectContaining({ id: "env.namecheap.namecheap_client_ip", status: "warn", message: expect.stringContaining("NAMECHEAP_CLIENT_IP") }),
        expect.objectContaining({ id: "env.sentry", status: "warn", message: expect.stringContaining("SENTRY_AUTH_TOKEN") }),
      ]),
    );
  });

  it("reports mapped provider-specific credential env vars", () => {
    const store = freshStore();
    applyConfig(store, {
      projects: {
        "launch-app": {
          environments: {
            production: {
              kind: "production",
              stripe: { mode: "live" },
              upstash: { database_id: "redis-prod" },
              cloudflare_r2: { account_id: "cf_account", bucket_name: "assets" },
            },
          },
        },
      },
    });
    delete process.env.STRIPE_TEST_SECRET_KEY;
    process.env.STRIPE_LIVE_SECRET_KEY = "sk_live_dummy";
    process.env.UPSTASH_API_KEY = "upstash_dummy";
    delete process.env.UPSTASH_EMAIL;
    process.env.CLOUDFLARE_API_TOKEN = "cf_dummy";
    process.env.R2_ACCESS_KEY_ID = "r2_access";
    delete process.env.R2_SECRET_ACCESS_KEY;

    const report = doctor(store, { project: "launch-app", environment: "production" });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "env.stripe", status: "pass", message: expect.stringContaining("STRIPE_LIVE_SECRET_KEY") }),
        expect.objectContaining({ id: "env.upstash", status: "pass", message: expect.stringContaining("UPSTASH_API_KEY") }),
        expect.objectContaining({ id: "env.upstash.upstash_email", status: "warn", message: expect.stringContaining("UPSTASH_EMAIL") }),
        expect.objectContaining({ id: "env.cloudflare_r2", status: "pass", message: expect.stringContaining("CLOUDFLARE_API_TOKEN") }),
        expect.objectContaining({ id: "env.cloudflare_r2.r2_secret_access_key", status: "warn", message: expect.stringContaining("R2_SECRET_ACCESS_KEY") }),
      ]),
    );
  });

  it("reports every explicit provider connection independently", () => {
    const store = freshStore();
    const first = createConnection(store, { provider: "sentry", label: "org-a", envVar: "CUSTOM_SENTRY_A_TOKEN" });
    const second = createConnection(store, { provider: "sentry", label: "org-b", envVar: "CUSTOM_SENTRY_B_TOKEN" });
    process.env.CUSTOM_SENTRY_B_TOKEN = "sntrys_dummy";

    const report = doctor(store);

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `connection.${first.id}`, status: "pass" }),
        expect.objectContaining({ id: `connection.${second.id}`, status: "pass" }),
        expect.objectContaining({ id: `env.connection.${first.id}`, status: "warn", message: expect.stringContaining("CUSTOM_SENTRY_A_TOKEN") }),
        expect.objectContaining({ id: `env.connection.${second.id}`, status: "pass", message: expect.stringContaining("CUSTOM_SENTRY_B_TOKEN") }),
      ]),
    );
  });

  it("exports audit entries as jsonl, csv, and markdown", () => {
    const store = freshStore();
    seedAcme(store);
    store.appendAudit({
      timestamp: "2026-06-09T00:00:00.000Z",
      projectSlug: "acme-crm",
      environment: "staging",
      provider: "vercel",
      tool: "get_vercel_deployments",
      actionSummary: "deployments acme-preview",
      policyDecision: "allow",
      result: "success",
      providerResource: "acme-preview",
    });
    store.appendAudit({
      timestamp: "2026-06-09T00:00:01.000Z",
      projectSlug: "acme-crm",
      environment: "production",
      provider: "vercel",
      tool: "create_vercel_deployment",
      actionSummary: "deploy production",
      policyDecision: "approval_required",
      result: "not_executed",
      providerResource: "acme-prod",
      dashclawDecisionId: "gd_123",
      dashclawActionId: "act_123",
      dashclawOutcomeRecorded: false,
    });

    expect(exportAuditLog(store, { project: "acme-crm", format: "jsonl" })).toContain('"tool":"get_vercel_deployments"');
    expect(exportAuditLog(store, { project: "acme-crm", format: "csv" })).toContain("timestamp,project,environment,provider,tool");
    expect(exportAuditLog(store, { project: "acme-crm", format: "csv" })).toContain("dashclawDecisionId");
    expect(exportAuditLog(store, { project: "acme-crm", format: "csv" })).toContain("gd_123");
    expect(exportAuditLog(store, { project: "acme-crm", format: "markdown" })).toContain("| Timestamp | Project | Environment |");
    expect(exportAuditLog(store, { project: "acme-crm", format: "markdown" })).toContain("act_123");
  });

  it("exports context snapshots in machine and markdown formats", async () => {
    const store = freshStore();
    seedAcme(store);

    const json = await exportContextSnapshot(store, {
      project: "acme-crm",
      environment: "staging",
      format: "json",
    });
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe("dashclaw.context.snapshot.v1");
    expect(parsed.context.project.slug).toBe("acme-crm");
    expect(parsed.context.focusedEnvironment).toBe("staging");

    const markdown = await exportContextSnapshot(store, {
      project: "acme-crm",
      environment: "staging",
      format: "markdown",
    });
    expect(markdown).toContain("# dashclaw context snapshot: acme-crm");
    expect(markdown).toContain("Environment: staging");
  });
});

describe("DashClaw operations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DASHCLAW_URL;
    delete process.env.DASHCLAW_API_KEY;
  });

  it("reports DashClaw status", async () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    const report = await dashclawStatus();

    expect(report).toMatchObject({ configured: true, reachable: true, mode: "authoritative" });
  });

  it("falls back when DashClaw doctor is unavailable", async () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/doctor")) {
          return new Response(JSON.stringify({ error: "doctor down" }), { status: 500 });
        }
        return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      }),
    );

    const report = await dashclawStatus();

    expect(report).toMatchObject({ configured: true, reachable: true, mode: "authoritative" });
    expect(fetch).toHaveBeenCalledWith("https://dashclaw.example/api/agents", expect.any(Object));
  });

  it("fetches recent DashClaw decisions with scoped query parameters", async () => {
    const store = freshStore();
    seedAcme(store);
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ decisions: [{ id: "gd_1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const decisions = await dashclawRecentDecisions(store, {
      project: "acme-crm",
      environment: "production",
      limit: 5,
    });

    expect(decisions).toEqual({ decisions: [{ id: "gd_1" }] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashclaw.example/api/guard/decisions?project=acme-crm&environment=production&limit=5",
      expect.any(Object),
    );
  });

  it("exports local evidence linked to DashClaw ids", () => {
    const store = freshStore();
    seedAcme(store);
    store.appendAudit({
      timestamp: "2026-06-09T00:00:00.000Z",
      projectSlug: "acme-crm",
      environment: "production",
      provider: "vercel",
      tool: "create_vercel_deployment",
      actionSummary: "deploy prod",
      policyDecision: "approval_required",
      result: "not_executed",
      dashclawDecisionId: "gd_1",
      dashclawActionId: "act_1",
    });

    const evidence = exportDashclawEvidence(store, { project: "acme-crm", environment: "production" });

    expect(evidence).toMatchObject({
      schema: "dashclaw.evidence.v1",
      entries: [expect.objectContaining({ dashclawDecisionId: "gd_1", dashclawActionId: "act_1" })],
    });
  });

  it("explains action risk without executing a provider call", async () => {
    const store = freshStore();
    seedAcme(store);
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ decision: "require_approval", reason: "review" }), { status: 200 })));

    const explanation = await explainActionRisk(store, {
      project: "acme-crm",
      environment: "production",
      provider: "vercel",
      capability: "deploy",
      tool: "create_vercel_deployment",
      summary: "deploy prod",
      resourceLabel: "acme-prod",
    });

    expect(explanation).toMatchObject({
      risky: true,
      localPolicy: expect.objectContaining({ effect: "approval_required" }),
      dashclaw: expect.objectContaining({ decision: "require_approval" }),
    });
  });

  it("summarizes governed actions from local audit evidence", () => {
    const store = freshStore();
    seedAcme(store);
    store.appendAudit({
      timestamp: "2026-06-09T00:00:00.000Z",
      projectSlug: "acme-crm",
      environment: "production",
      provider: "vercel",
      tool: "create_vercel_deployment",
      actionSummary: "deploy prod",
      policyDecision: "approval_required",
      result: "not_executed",
      dashclawDecisionId: "gd_1",
      dashclawActionId: "act_1",
      dashclawOutcomeRecorded: false,
    });

    const summary = governedActionSummary(store, { project: "acme-crm", environment: "production" });

    expect(summary).toMatchObject({
      project: "acme-crm",
      environment: "production",
      entries: [
        {
          timestamp: "2026-06-09T00:00:00.000Z",
          tool: "create_vercel_deployment",
          result: "not_executed",
          policyDecision: "approval_required",
          dashclawDecisionId: "gd_1",
          dashclawActionId: "act_1",
          dashclawOutcomeRecorded: false,
        },
      ],
    });
  });
});

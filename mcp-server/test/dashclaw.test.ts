import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashclawConfigFromEnv, dashclawFetch } from "../src/dashclaw/client.js";
import {
  buildDashclawGuardPayload,
  guardWithDashclaw,
  isRiskyAction,
  localPolicyPreview,
  normalizeDashclawDecision,
  sanitizeDashclawText,
  sqlFingerprint,
} from "../src/dashclaw/guard.js";
import type { Store } from "../src/storage.js";
import type { ActionContext, PolicyDecision } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DASHCLAW_URL;
  delete process.env.DASHCLAW_API_KEY;
  delete process.env.DASHCLAW_TIMEOUT_MS;
  delete process.env.DASHCLAW_MODE;
  delete process.env.DASHCLAW_HTTP_TIMEOUT_MS;
});

describe("DashClaw client", () => {
  it("reads env config without storing secrets", () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_secret";

    const config = dashclawConfigFromEnv();

    expect(config).toMatchObject({
      baseUrl: "https://dashclaw.example",
      apiKey: "dc_secret",
      timeoutMs: 30000,
      mode: "authoritative",
    });
  });

  it("fails clearly when required env vars are missing", () => {
    expect(() => dashclawConfigFromEnv()).toThrow(/DASHCLAW_URL/i);
  });

  it("sends x-api-key and redacts secrets in HTTP errors", async () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "bad key dc_secret" }), {
          status: 403,
          statusText: "Forbidden",
        }),
      ),
    );

    await expect(dashclawFetch("/api/guard", { method: "POST", body: { action_type: "provider_deploy" } })).rejects.toThrow(
      /REDACTED/,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://dashclaw.example/api/guard",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "dc_secret" }),
      }),
    );
  });
});

describe("DashClaw decision normalization", () => {
  it.each([
    ["allow", "allow"],
    ["block", "block"],
    ["require_approval", "require_approval"],
    ["approval_required", "require_approval"],
  ] as const)("normalizes %s", (input, expected) => {
    expect(normalizeDashclawDecision(input)).toBe(expected);
  });

  it("rejects unknown decisions loudly", () => {
    expect(() => normalizeDashclawDecision("unsupported_decision")).toThrow(/unknown DashClaw decision/i);
  });
});

function actionContext(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    project: {
      id: "proj_1",
      workspaceId: "ws_1",
      slug: "acme-crm",
      name: "Acme CRM",
      createdAt: "2026-06-09T00:00:00.000Z",
    },
    environment: {
      id: "env_1",
      projectId: "proj_1",
      name: "production",
      kind: "production",
      isProduction: true,
      createdAt: "2026-06-09T00:00:00.000Z",
    },
    provider: "vercel",
    capability: "deploy",
    tool: "create_vercel_deployment",
    summary: "deploy acme-crm-prod",
    resourceLabel: "acme-crm-prod",
    ...overrides,
  };
}

const localPreview: PolicyDecision = {
  effect: "approval_required",
  reason: "Production deploys require approval by default.",
  source: "default",
};

describe("DashClaw guard payload mapping", () => {
  it("marks risky capabilities", () => {
    expect(isRiskyAction(actionContext({ capability: "read" }))).toBe(false);
    expect(isRiskyAction(actionContext({ capability: "write" }))).toBe(true);
    expect(isRiskyAction(actionContext({ capability: "deploy" }))).toBe(true);
    expect(isRiskyAction(actionContext({ capability: "env_change" }))).toBe(true);
    expect(isRiskyAction(actionContext({ capability: "delete" }))).toBe(true);
    expect(isRiskyAction(actionContext({ capability: "destructive_sql" }))).toBe(true);
    expect(isRiskyAction(actionContext({ capability: "purchase" }))).toBe(true);
    expect(isRiskyAction(actionContext({ capability: "read", live: true }))).toBe(true);
  });

  it("builds domain purchase guard payload with irreversible high-risk classification", () => {
    const payload = buildDashclawGuardPayload(
      actionContext({
        provider: "namecheap",
        capability: "purchase",
        tool: "purchase_domain",
        summary: "purchase example.com",
        resourceLabel: "example.com",
      }),
      localPreview,
      "audit_123",
    );

    expect(payload).toMatchObject({
      action_type: "provider_purchase",
      reversible: false,
      risk_score: 95,
      metadata: {
        provider: "namecheap",
        capability: "purchase",
        tool: "purchase_domain",
      },
    });
  });

  it("builds provider deploy guard payload", () => {
    const payload = buildDashclawGuardPayload(actionContext(), localPreview, "audit_123");

    expect(payload).toMatchObject({
      action_type: "provider_deploy",
      declared_goal: "deploy acme-crm-prod",
      reversible: false,
      risk_score: 85,
      systems_touched: ["vercel:acme-crm-prod", "project:acme-crm", "environment:production"],
      metadata: {
        provider: "vercel",
        capability: "deploy",
        tool: "create_vercel_deployment",
        local_policy_effect: "approval_required",
        audit_correlation_id: "audit_123",
      },
    });
  });

  it("does not include secret-looking metadata", () => {
    const payload = buildDashclawGuardPayload(
      actionContext({
        summary: "set TOKEN=sk_live_123 DATABASE_URL=postgres://user:pass@example.com/prod",
        resourceLabel: "project:DATABASE_URL",
      }),
      localPreview,
      "audit_123",
    );

    expect(JSON.stringify(payload)).not.toContain("postgres://");
    expect(JSON.stringify(payload)).not.toContain("sk_live");
    expect(JSON.stringify(payload)).not.toContain("TOKEN=");
    expect(JSON.stringify(payload)).toContain("[redacted]");
  });

  it("redacts webhook signing secrets from payloads", () => {
    // Built via concatenation so no secret-shaped literal sits in the repo.
    const fakeWebhookSecret = ["whsec", "testplaceholder123"].join("_");
    const payload = buildDashclawGuardPayload(
      actionContext({ summary: `created webhook endpoint with signing secret ${fakeWebhookSecret}` }),
      localPreview,
      "audit_123",
    );

    expect(JSON.stringify(payload)).not.toContain("whsec");
    expect(JSON.stringify(payload)).toContain("[redacted]");
  });

  it("fingerprints SQL without exposing raw SQL", () => {
    const sql = "DELETE FROM customers WHERE email = 'a@example.com'";
    const fp = sqlFingerprint(sql);

    expect(fp).toBe(createHash("sha256").update(sql).digest("hex").slice(0, 16));
    expect(fp).not.toContain("customers");
    expect(fp).not.toContain("example.com");
  });

  it("previews local policy from the store", () => {
    const store = { data: { policyRules: [] } } as Store;

    expect(localPolicyPreview(store, actionContext())).toMatchObject({
      effect: "approval_required",
      source: "default:production_write",
    });
  });

  it("calls DashClaw with mapped payload and normalizes response ids", async () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_secret";
    const store = { data: { policyRules: [] } } as Store;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            decision: "approval_required",
            reason: "Needs review",
            decision_id: "gd_1",
            actionId: "act_1",
            verification_status: "pending",
            signals: { risk: "production" },
          }),
          { status: 200 },
        ),
      ),
    );

    const decision = await guardWithDashclaw(store, actionContext(), "audit_123");

    expect(fetch).toHaveBeenCalledWith(
      "https://dashclaw.example/api/guard",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"audit_correlation_id":"audit_123"'),
      }),
    );
    expect(decision).toMatchObject({
      decision: "require_approval",
      reason: "Needs review",
      decisionId: "gd_1",
      actionId: "act_1",
      verificationStatus: "pending",
      signals: { risk: "production" },
    });
  });
});

describe("sanitizeDashclawText", () => {
  it("redacts all forms of secrets", () => {
    expect(sanitizeDashclawText("MY_API_KEY = abc123")).toBe("[redacted]");
    expect(sanitizeDashclawText("DATABASE_URL=postgres://u:p@host/db")).toBe("[redacted]");
    expect(sanitizeDashclawText("key sk_live_abcDEF123 leaked")).toBe("key [redacted] leaked");
    expect(sanitizeDashclawText("hook whsec_abc123 here")).toBe("hook [redacted] here");
    expect(sanitizeDashclawText("the ACCESS_TOKEN value")).toBe("the [redacted] value");
    expect(sanitizeDashclawText("nothing sensitive")).toBe("nothing sensitive");
  });

  it("handles adversarial input in linear time (no ReDoS backtracking)", () => {
    const evil = "A".repeat(100_000) + "TOKEN" + "A".repeat(100_000) + " !=";
    const start = Date.now();
    const result = sanitizeDashclawText(evil);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result).toContain("[redacted]");
  });
});

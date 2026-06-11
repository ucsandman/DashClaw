import { afterEach, describe, expect, it, vi } from "vitest";
import { runGuarded } from "../src/actions.js";
import { resolveEnvironment, resolveProject } from "../src/resolve.js";
import { freshStore, seedAcme } from "./helpers.js";

function stagingContext() {
  const store = freshStore();
  seedAcme(store);
  const project = resolveProject(store, "acme-crm");
  const environment = resolveEnvironment(store, project, "staging");
  return { store, project, environment };
}

describe("runGuarded invariants", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DASHCLAW_URL;
    delete process.env.DASHCLAW_API_KEY;
  });

  it("does not execute DashClaw-blocked actions and writes exactly one audit entry", async () => {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/guard")) {
          return new Response(
            JSON.stringify({ decision: "block", reason: "destructive SQL blocked", decision_id: "gd_block", action_id: "act_block" }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "unexpected route", url }), { status: 404 });
      }),
    );
    const { store, project, environment } = stagingContext();
    const exec = vi.fn(async () => ({ ok: true }));

    const res = await runGuarded(
      store,
      {
        project,
        environment,
        provider: "supabase",
        capability: "destructive_sql",
        tool: "mutation_test_blocked",
        summary: "drop table",
        resourceLabel: "sb_staging_ref",
      },
      exec,
    );

    expect(res.status).toBe("blocked");
    expect(exec).not.toHaveBeenCalled();
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({
      tool: "mutation_test_blocked",
      result: "not_executed",
      dashclawDecisionId: "gd_block",
      dashclawActionId: "act_block",
    });
  });

  it("executes allowed actions once and writes exactly one success audit entry", async () => {
    const { store, project, environment } = stagingContext();
    const exec = vi.fn(async () => ({ ok: true }));

    const res = await runGuarded(
      store,
      {
        project,
        environment,
        provider: "github",
        capability: "read",
        tool: "mutation_test_allowed",
        summary: "read repo",
      },
      exec,
    );

    expect(res.status).toBe("ok");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({ tool: "mutation_test_allowed", result: "success" });
  });

  it("records one error audit entry when an allowed provider call throws", async () => {
    const { store, project, environment } = stagingContext();
    const exec = vi.fn(async () => {
      throw new Error("provider failed");
    });

    const res = await runGuarded(
      store,
      {
        project,
        environment,
        provider: "github",
        capability: "read",
        tool: "mutation_test_error",
        summary: "read repo",
      },
      exec,
    );

    expect(res.status).toBe("error");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({ tool: "mutation_test_error", result: "error", errorMessage: "provider failed" });
  });
});

describe("runGuarded DashClaw authoritative mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DASHCLAW_URL;
    delete process.env.DASHCLAW_API_KEY;
  });

  function enableDashclaw(decision: Record<string, unknown>) {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/api/guard")) {
          return new Response(JSON.stringify(decision), { status: 200 });
        }
        if (url.includes("/api/actions/") && url.endsWith("/outcome")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "unexpected route", url, body: init?.body }), { status: 404 });
      }),
    );
  }

  function enableDashclawWithOutcomeFailure(decision: Record<string, unknown>) {
    process.env.DASHCLAW_URL = "https://dashclaw.example";
    process.env.DASHCLAW_API_KEY = "dc_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/guard")) {
          return new Response(JSON.stringify(decision), { status: 200 });
        }
        if (url.includes("/api/actions/") && url.endsWith("/outcome")) {
          return new Response(JSON.stringify({ error: "outcome down" }), { status: 503, statusText: "Service Unavailable" });
        }
        return new Response(JSON.stringify({ error: "unexpected route", url }), { status: 404 });
      }),
    );
  }

  function productionDeployContext() {
    const store = freshStore();
    seedAcme(store);
    const project = resolveProject(store, "acme-crm");
    const environment = resolveEnvironment(store, project, "production");
    return {
      store,
      ctx: {
        project,
        environment,
        provider: "vercel" as const,
        capability: "deploy" as const,
        tool: "create_vercel_deployment",
        summary: "deploy acme production",
        resourceLabel: "acme-prod",
      },
    };
  }

  it("allows risky action only after DashClaw allow", async () => {
    enableDashclaw({ decision: "allow", reason: "approved by policy", decision_id: "gd_1", action_id: "act_1" });
    const { store, ctx } = productionDeployContext();
    const exec = vi.fn(async () => ({ deploymentId: "dpl_1" }));

    const res = await runGuarded(store, ctx, exec);

    expect(res.status).toBe("ok");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://dashclaw.example/api/guard", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://dashclaw.example/api/actions/act_1/outcome", expect.any(Object));
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({
      result: "success",
      dashclawDecisionId: "gd_1",
      dashclawActionId: "act_1",
      auditCorrelationId: expect.stringMatching(/^audit_/),
    });
    expect((res as any).dashclaw).toMatchObject({ outcome_recorded: true });
  });

  it("records DashClaw error outcome for executed risky action failures", async () => {
    enableDashclaw({ decision: "allow", reason: "approved by policy", decision_id: "gd_err", action_id: "act_err" });
    const { store, ctx } = productionDeployContext();
    const exec = vi.fn(async () => {
      throw new Error("provider failed");
    });

    const res = await runGuarded(store, ctx, exec);

    expect(res.status).toBe("error");
    expect(res.executed).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://dashclaw.example/api/actions/act_err/outcome", expect.any(Object));
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({
      result: "error",
      errorMessage: "provider failed",
      dashclawDecisionId: "gd_err",
      dashclawActionId: "act_err",
      auditCorrelationId: expect.stringMatching(/^audit_/),
    });
    expect((res as any).dashclaw).toMatchObject({ outcome_recorded: true });
  });

  it("posts the platform terminal status 'completed' for successful executions", async () => {
    enableDashclaw({ decision: "allow", reason: "approved by policy", decision_id: "gd_ok", action_id: "act_ok" });
    const { store, ctx } = productionDeployContext();

    await runGuarded(store, ctx, vi.fn(async () => ({ ok: true })));

    const outcomeCall = (fetch as any).mock.calls.find(([url]: [string]) => url.endsWith("/api/actions/act_ok/outcome"));
    expect(JSON.parse(outcomeCall[1].body).status).toBe("completed");
  });

  it("posts the platform terminal status 'failed' for errored executions", async () => {
    enableDashclaw({ decision: "allow", reason: "approved by policy", decision_id: "gd_f", action_id: "act_f" });
    const { store, ctx } = productionDeployContext();

    await runGuarded(store, ctx, vi.fn(async () => {
      throw new Error("provider failed");
    }));

    const outcomeCall = (fetch as any).mock.calls.find(([url]: [string]) => url.endsWith("/api/actions/act_f/outcome"));
    expect(JSON.parse(outcomeCall[1].body).status).toBe("failed");
  });

  it("does not post an outcome for blocked (never-dispatched) actions", async () => {
    enableDashclaw({ decision: "block", reason: "window closed", decision_id: "gd_b", action_id: "act_b" });
    const { store, ctx } = productionDeployContext();

    const res = await runGuarded(store, ctx, vi.fn(async () => ({ ok: true })));

    expect(res.status).toBe("blocked");
    // The platform rejects outcomes for blocked/pending actions (R10) — nothing should be posted.
    const outcomeCall = (fetch as any).mock.calls.find(([url]: [string]) => url.endsWith("/outcome"));
    expect(outcomeCall).toBeUndefined();
  });

  it("preserves provider success and one audit entry when DashClaw outcome recording fails", async () => {
    enableDashclawWithOutcomeFailure({
      decision: "allow",
      reason: "approved by policy",
      decision_id: "gd_outcome_fail",
      action_id: "act_outcome_fail",
    });
    const { store, ctx } = productionDeployContext();
    const exec = vi.fn(async () => ({ deploymentId: "dpl_1" }));

    const res = await runGuarded(store, ctx, exec);

    expect(res.status).toBe("ok");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({
      result: "success",
      dashclawDecisionId: "gd_outcome_fail",
      dashclawActionId: "act_outcome_fail",
      auditCorrelationId: expect.stringMatching(/^audit_/),
    });
    expect((res as any).dashclaw).toMatchObject({
      outcome_recorded: false,
      error: expect.stringMatching(/outcome down|503/i),
    });
  });

  it("blocks risky action when DashClaw blocks", async () => {
    enableDashclaw({ decision: "block", reason: "deployment window closed", decision_id: "gd_2", action_id: "act_2" });
    const { store, ctx } = productionDeployContext();
    const exec = vi.fn(async () => ({ deploymentId: "dpl_1" }));

    const res = await runGuarded(store, ctx, exec);

    expect(res.status).toBe("blocked");
    expect(exec).not.toHaveBeenCalled();
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({
      result: "not_executed",
      policyDecision: "block",
      dashclawDecisionId: "gd_2",
      dashclawActionId: "act_2",
    });
  });

  it("returns approval required when DashClaw requires approval without creating local approval", async () => {
    enableDashclaw({ decision: "require_approval", reason: "human review", decision_id: "gd_3", action_id: "act_3" });
    const { store, ctx } = productionDeployContext();
    const exec = vi.fn(async () => ({ deploymentId: "dpl_1" }));

    const res = await runGuarded(store, ctx, exec);

    expect(res.status).toBe("approval_required");
    expect(exec).not.toHaveBeenCalled();
    expect(store.readAudit()).toHaveLength(1);
    expect(store.data.pendingApprovals).toHaveLength(0);
    expect((res as any).dashclaw).toMatchObject({ decision_id: "gd_3", action_id: "act_3" });
  });

  it("sanitizes DashClaw outcome payloads", async () => {
    enableDashclaw({ decision: "allow", reason: "approved by policy", decision_id: "gd_secret", action_id: "act_secret" });
    const { store, ctx } = productionDeployContext();
    const exec = vi.fn(async () => ({ ok: true }));

    await runGuarded(
      store,
      {
        ...ctx,
        summary: "deploy TOKEN=sk_live_123 DATABASE_URL=postgres://user:pass@example.com/prod",
        resourceLabel: "project:DATABASE_URL",
      },
      exec,
    );

    const outcomeCall = (fetch as any).mock.calls.find(([url]: [string]) => url.endsWith("/api/actions/act_secret/outcome"));
    const body = JSON.parse(outcomeCall[1].body);
    expect(JSON.stringify(body)).not.toContain("sk_live");
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(JSON.stringify(body)).not.toContain("TOKEN=");
    expect(JSON.stringify(body)).toContain("[redacted]");
  });

  it("fails closed for risky actions when DashClaw env is missing", async () => {
    const { store, ctx } = productionDeployContext();
    const exec = vi.fn(async () => ({ deploymentId: "dpl_1" }));

    const res = await runGuarded(store, ctx, exec);

    expect(res.status).toBe("error");
    expect(res.executed).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({
      result: "not_executed",
      dashclawError: expect.stringMatching(/DASHCLAW_URL/i),
    });
  });

  it("fails closed for purchase actions when DashClaw env is missing", async () => {
    const { store, project, environment } = stagingContext();
    const exec = vi.fn(async () => ({ domain: "example.com" }));

    const res = await runGuarded(
      store,
      {
        project,
        environment,
        provider: "namecheap",
        capability: "purchase",
        tool: "purchase_domain",
        summary: "purchase example.com",
        resourceLabel: "example.com",
      },
      exec,
    );

    expect(res.status).toBe("error");
    expect(res.executed).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(store.readAudit()).toHaveLength(1);
    expect(store.readAudit()[0]).toMatchObject({
      result: "not_executed",
      dashclawError: expect.stringMatching(/DASHCLAW_URL/i),
    });
  });

  it("allows reads to proceed when DashClaw env is missing", async () => {
    const { store, project, environment } = stagingContext();
    const exec = vi.fn(async () => ({ ok: true }));

    const res = await runGuarded(
      store,
      { project, environment, provider: "github", capability: "read", tool: "read_repo", summary: "read repo" },
      exec,
    );

    expect(res.status).toBe("ok");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(store.readAudit()).toHaveLength(1);
  });
});

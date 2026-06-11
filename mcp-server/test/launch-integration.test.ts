import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLaunchPlan, getLaunchStatus, preflightLaunch } from "../src/launch/index.js";
import * as pa from "../src/provider-actions.js";
import { composeServer } from "../src/server.js";
import { listAuditLog, listPendingApprovals } from "../src/service.js";
import { freshStore, seedAcme } from "./helpers.js";

/**
 * Integration: launch tooling rides the guarded-action path. With global
 * fetch mocked (no live network), these tests prove:
 *   - launch status/preflight reads EXECUTE through runGuarded (audited,
 *     policy-checked) and never issue a provider mutation;
 *   - a step whose underlying guarded tool is waiting on a human approval
 *     surfaces as blocked-on-approval in get_launch_status;
 *   - the four launch tools register on the stdio server unconditionally.
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

function setDashclawDecision(decision: "allow" | "block" | "require_approval", suffix = decision) {
  dashclawDecision = {
    decision,
    reason: `DashClaw ${decision}`,
    decision_id: `gd_${suffix}`,
    action_id: `act_${suffix}`,
  };
}

function providerCalls(): Array<{ url: string; method: string }> {
  return fetchMock.mock.calls
    .map(([url, init]: [string, RequestInit | undefined]) => ({
      url: String(url),
      method: String(init?.method ?? "GET").toUpperCase(),
    }))
    .filter((c) => !c.url.startsWith("https://dashclaw.example"));
}

beforeEach(() => {
  process.env.DASHCLAW_URL = "https://dashclaw.example";
  process.env.DASHCLAW_API_KEY = "dc_test";
  setDashclawDecision("allow");
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => dashclawRoute(String(url)) ?? mockOk({ data: [] }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.STRIPE_TEST_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_LIVE_SECRET_KEY = "sk_live_dummy";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STRIPE_TEST_SECRET_KEY;
  delete process.env.STRIPE_LIVE_SECRET_KEY;
  delete process.env.DASHCLAW_URL;
  delete process.env.DASHCLAW_API_KEY;
});

describe("launch plans through the guarded-action path", () => {
  it("evaluates status via guarded reads only — GETs, audited, zero mutations", async () => {
    const store = freshStore();
    seedAcme(store);
    const plan = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "production",
      declared_stack: ["stripe"],
    });

    const status = await getLaunchStatus(store, { plan_id: plan.id });

    // Reads executed (empty results -> steps pending), through real provider URLs.
    expect(status.steps.every((s) => s.status === "pending")).toBe(true);
    const calls = providerCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === "GET")).toBe(true);

    // Every read landed in the audit log as a guarded success; no approvals
    // were consumed or created by status evaluation.
    const audit = listAuditLog(store, {});
    const reads = audit.filter((e: any) => String(e.tool ?? "").startsWith("list_stripe_"));
    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(reads.every((e: any) => e.result === "success" && e.policyDecision === "allow")).toBe(true);
    expect(listPendingApprovals(store, {})).toHaveLength(0);
  });

  it("survives an approval interruption: require_approval -> tracked -> approved re-run -> done", async () => {
    const store = freshStore();
    seedAcme(store);
    const plan = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "production",
      declared_stack: ["stripe"],
    });

    // Stateful Stripe mock: products created by POST show up in later GETs.
    const products: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const routed = dashclawRoute(String(url));
      if (routed) return routed;
      const method = String(init?.method ?? "GET").toUpperCase();
      if (String(url).startsWith("https://api.stripe.com/v1/products")) {
        if (method === "POST") {
          products.push({ id: "prod_live_1", name: "Pro Plan", active: true, created: 1 });
          return mockOk(products[0]);
        }
        return mockOk({ data: products });
      }
      return mockOk({ data: [] });
    });

    // 1. The agent runs the step's underlying guarded tool; DashClaw requires
    //    approval, so nothing executes (the launch plan only OBSERVES this).
    setDashclawDecision("require_approval", "stripe_live");
    const attempt = await pa.stripeCreateProduct(store, { environment: "production", name: "Pro Plan" });
    expect(attempt.status).toBe("approval_required");
    expect(providerCalls().filter((c) => c.method !== "GET")).toHaveLength(0);
    // DashClaw-decided approvals live in Mission Control, not the local queue.
    expect(listPendingApprovals(store, { status: "pending" })).toHaveLength(0);

    // 2. Status still reports the step incomplete and names it as THE next
    //    action — the interruption did not produce a phantom done.
    const before = await getLaunchStatus(store, { plan_id: plan.id });
    expect(before.steps.find((s) => s.id === "stripe.product")!.status).toBe("pending");
    expect(before.next_action).toMatchObject({ step_id: "stripe.product", tool_hint: "create_stripe_product" });

    // 3. A human approves in Mission Control; the agent re-runs the SAME
    //    guarded tool (approval never executes anything by itself).
    setDashclawDecision("allow");
    const rerun = await pa.stripeCreateProduct(store, { environment: "production", name: "Pro Plan" });
    expect(rerun.status).toBe("ok");

    // 4. Reality moved, so status now reports the step done and advances.
    const callsBeforeStatus = fetchMock.mock.calls.length;
    const after = await getLaunchStatus(store, { plan_id: plan.id });
    expect(after.steps.find((s) => s.id === "stripe.product")!.status).toBe("done");
    expect(after.next_action).toMatchObject({ step_id: "stripe.price" });

    // The status evaluation itself issued reads only.
    const statusCalls = fetchMock.mock.calls
      .slice(callsBeforeStatus)
      .map(([url, init]: [string, RequestInit | undefined]) => ({
        url: String(url),
        method: String(init?.method ?? "GET").toUpperCase(),
      }))
      .filter((c) => !c.url.startsWith("https://dashclaw.example"));
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(statusCalls.every((c) => c.method === "GET")).toBe(true);
  });

  it("preflight token-validity reads also flow through the guarded path", async () => {
    const store = freshStore();
    seedAcme(store);
    const plan = createLaunchPlan(store, {
      project: "acme-crm",
      environment: "production",
      declared_stack: ["stripe"],
    });

    const result = await preflightLaunch(store, { plan_id: plan.id });

    expect(result.checks.find((c) => c.id === "token-validity:stripe")).toMatchObject({ status: "pass" });
    expect(providerCalls().every((c) => c.method === "GET")).toBe(true);
    const audit = listAuditLog(store, {});
    expect(audit.some((e: any) => e.tool === "list_stripe_products")).toBe(true);
  });

  it("registers the four launch tools unconditionally (no credentials required)", () => {
    delete process.env.DASHCLAW_URL;
    delete process.env.DASHCLAW_API_KEY;
    delete process.env.STRIPE_TEST_SECRET_KEY;
    delete process.env.STRIPE_LIVE_SECRET_KEY;

    const tools: string[] = [];
    const recorder = {
      registerTool: (name: string) => {
        tools.push(name);
      },
      registerResource: () => undefined,
    } as unknown as McpServer;

    composeServer(recorder, freshStore());

    expect(tools).toEqual(
      expect.arrayContaining(["create_launch_plan", "get_launch_status", "preflight_launch", "verify_launch"]),
    );
  });
});

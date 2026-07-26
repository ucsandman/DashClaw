import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DashClawClient } from "../src/client.js";
import { createToolHandlers, TOOL_DEFINITIONS } from "../src/tools.js";

function makeHandlers() {
  const client = new DashClawClient({ url: "http://dashclaw.test", apiKey: "oc_live_test", agentId: "claude-code" });
  return createToolHandlers(client);
}

describe("plan tools", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("registers dashclaw_plan_submit and dashclaw_plan_status in TOOL_DEFINITIONS", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("dashclaw_plan_submit");
    expect(names).toContain("dashclaw_plan_status");
  });

  it("dashclaw_plan_submit posts declared_goal/steps/ttl_minutes to /api/plans", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_plan_submit({
      declared_goal: "ship it",
      steps: [{ action_type: "deploy", step_goal: "deploy prod" }],
      ttl_minutes: 30,
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/plans");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.agent_id).toBe("claude-code");
    expect(body.declared_goal).toBe("ship it");
    expect(body.steps).toEqual([{ action_type: "deploy", step_goal: "deploy prod" }]);
    expect(body.ttl_minutes).toBe(30);
    expect(opts.headers["x-api-key"]).toBe("oc_live_test");
  });

  it("dashclaw_plan_status gets /api/plans/:planId with no stray query params (timeout must not leak into the querystring)", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_plan_status({ plan_id: "pa_1234" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://dashclaw.test/api/plans/pa_1234");
    expect(opts?.method ?? "GET").toBe("GET");
  });

  it("dashclaw_plan_status URL-encodes the plan id", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_plan_status({ plan_id: "pa/weird id" });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(encodeURIComponent("pa/weird id"));
  });
});

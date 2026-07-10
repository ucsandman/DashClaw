import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DashClawClient } from "../src/client.js";
import { createToolHandlers } from "../src/tools.js";

function makeHandlers() {
  const client = new DashClawClient({ url: "http://dashclaw.test", apiKey: "oc_live_test", agentId: "claude-code" });
  return createToolHandlers(client);
}

describe("team task tools", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("dashclaw_task_create posts to /api/team-tasks with id mapped from task_id", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_task_create({
      task_id: "team-20260710-0900-x", instruction: "i", origin: "telegram", lead_agent: "openclaw",
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/team-tasks");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.id).toBe("team-20260710-0900-x");
    expect(body.lead_agent).toBe("openclaw");
    expect(opts.headers["x-api-key"]).toBe("oc_live_test");
  });

  it("dashclaw_task_event posts to the task's events path", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_task_event({
      task_id: "team-20260710-0900-x", from_agent: "claude", to_agent: "wes", type: "done", summary: "s",
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/team-tasks/team-20260710-0900-x/events");
    expect(JSON.parse(opts.body).type).toBe("done");
  });

  it("dashclaw_task_update patches the task", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_task_update({ task_id: "team-20260710-0900-x", status: "done" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/team-tasks/team-20260710-0900-x");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body).status).toBe("done");
  });
});

/**
 * Guard/record tool fail-closed mapping + context enrichment (Organ 3, Phase 2).
 *
 * - Transport errors / non-2xx / malformed guard responses map to an explicit
 *   fail-closed decision (mirroring src/actions.ts "DashClaw unavailable;
 *   refusing risky action"), governed by DASHCLAW_GUARD_UNAVAILABLE_POLICY
 *   (default block; allow = self-hoster escape hatch — same contract as the
 *   Python hook).
 * - The guard payload is enriched toward hook parity (target / write_paths /
 *   content / tool name) so protected-path, secret-scan, and content policies
 *   can fire on MCP-originated calls.
 * - agent_id stays server-priority: the configured agent id beats tool input.
 * - dashclaw_record fails loud: a dropped audit write is surfaced, never
 *   silently returned as an opaque error blob.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DashClawClient } from "../src/client.js";
import { registerGovernance } from "../src/server.js";
import { createToolHandlers, TOOL_DEFINITIONS } from "../src/tools.js";

let fetchMock: ReturnType<typeof vi.fn>;

function mockOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockStatus(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeHandlers(agentId = "srv-agent") {
  const client = new DashClawClient({ url: "http://dashclaw.test", apiKey: "oc_live_test", agentId });
  return createToolHandlers(client);
}

function lastRequestBody(): any {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

function lastRequestUrl(): URL {
  const call = fetchMock.mock.calls.at(-1);
  return new URL(String(call?.[0]));
}

function registeredGovernanceHandlers() {
  const tools = new Map<string, (args: any) => Promise<any>>();
  const server = {
    registerTool(name: string, _config: unknown, handler: (args: any) => Promise<any>) {
      tools.set(name, handler);
    },
    registerResource() {},
  };
  registerGovernance(server as never, new DashClawClient({ url: "http://dashclaw.test", apiKey: "oc_live_test", agentId: "srv-agent" }));
  return tools;
}

const GUARD_INPUT = { action_type: "deploy", declared_goal: "ship it", risk_score: 70 };

beforeEach(() => {
  fetchMock = vi.fn(async () => mockOk({ decision: "allow" }));
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.DASHCLAW_GUARD_UNAVAILABLE_POLICY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DASHCLAW_GUARD_UNAVAILABLE_POLICY;
});

describe("dashclaw_guard fail-closed mapping", () => {
  it("maps a transport error to block by default (fail closed)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const out = JSON.parse(await makeHandlers().dashclaw_guard(GUARD_INPUT));
    expect(out.decision).toBe("block");
    expect(out.degraded).toBe(true);
    expect(out.reason).toContain("refusing risky action");
    expect(out.reason).toContain("ECONNREFUSED");
    expect(out.guidance).toContain("Do NOT proceed");
  });

  it("maps a non-2xx response without a decision to block", async () => {
    fetchMock.mockResolvedValue(mockStatus(500, { error: "internal" }));
    const out = JSON.parse(await makeHandlers().dashclaw_guard(GUARD_INPUT));
    expect(out.decision).toBe("block");
    expect(out.degraded).toBe(true);
  });

  it("maps a malformed 200 (no decision string) to block", async () => {
    fetchMock.mockResolvedValue(mockOk({ unexpected: true }));
    const out = JSON.parse(await makeHandlers().dashclaw_guard(GUARD_INPUT));
    expect(out.decision).toBe("block");
    expect(out.degraded).toBe(true);
  });

  it("DASHCLAW_GUARD_UNAVAILABLE_POLICY=allow restores fail-open (escape hatch)", async () => {
    process.env.DASHCLAW_GUARD_UNAVAILABLE_POLICY = "allow";
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const out = JSON.parse(await makeHandlers().dashclaw_guard(GUARD_INPUT));
    expect(out.decision).toBe("allow");
    expect(out.degraded).toBe(true);
    expect(out.reason).toContain("failing open");
  });

  it("passes a real guard decision through unchanged", async () => {
    fetchMock.mockResolvedValue(mockOk({ decision: "require_approval", reason: "policy hit", decision_id: "act_gd_x" }));
    const out = JSON.parse(await makeHandlers().dashclaw_guard(GUARD_INPUT));
    expect(out.decision).toBe("require_approval");
    expect(out.degraded).toBeUndefined();
  });

  it("passes an org-halt block through with the halt reason (kill switch honored on MCP)", async () => {
    fetchMock.mockResolvedValue(mockOk({ decision: "block", reason: "Org halted by alice: incident response" }));
    const out = JSON.parse(await makeHandlers().dashclaw_guard(GUARD_INPUT));
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("Org halted by alice");
  });
});

describe("dashclaw_guard context enrichment", () => {
  it("forwards target / write_paths / content / tool toward hook parity", async () => {
    await makeHandlers().dashclaw_guard({
      ...GUARD_INPUT,
      target: "app/lib/auth.ts",
      write_paths: ["app/lib/auth.ts", ".env"],
      content: "const KEY = 'sk-not-really';",
      tool_name: "Write",
    });
    const body = lastRequestBody();
    expect(body.target).toBe("app/lib/auth.ts");
    expect(body.write_paths).toEqual(["app/lib/auth.ts", ".env"]);
    expect(body.content).toContain("sk-not-really");
    expect(body.tool).toEqual({ name: "Write" });
  });

  it("omits enrichment fields when not supplied (no nulls in the payload)", async () => {
    await makeHandlers().dashclaw_guard(GUARD_INPUT);
    const body = lastRequestBody();
    expect("target" in body).toBe(false);
    expect("write_paths" in body).toBe(false);
    expect("content" in body).toBe(false);
    expect("tool" in body).toBe(false);
  });

  it("caps forwarded content to 20k chars", async () => {
    await makeHandlers().dashclaw_guard({ ...GUARD_INPUT, content: "x".repeat(30000) });
    expect(lastRequestBody().content.length).toBe(20000);
  });

  it("forwards act evidence for evidence-first guard (2026-07-05)", async () => {
    await makeHandlers().dashclaw_guard({
      ...GUARD_INPUT,
      act: { kind: "shell", command: "rm -rf /prod-data" },
    });
    const body = lastRequestBody();
    expect(body.act).toEqual({ kind: "shell", command: "rm -rf /prod-data" });
  });

  it("omits act when not supplied (no null in the payload)", async () => {
    await makeHandlers().dashclaw_guard(GUARD_INPUT);
    expect("act" in lastRequestBody()).toBe(false);
  });

  it("ignores a non-object act instead of forwarding garbage", async () => {
    await makeHandlers().dashclaw_guard({ ...GUARD_INPUT, act: "rm -rf /" });
    expect("act" in lastRequestBody()).toBe(false);
  });
});

// Act-content grant binding (drizzle/0056): dashclaw_record forwards the act
// so the server stamps act_content_hash on the row — a pending_approval
// record binds the operator's approval to that exact act.
describe("dashclaw_record act forwarding", () => {
  const RECORD_INPUT = { action_type: "deploy", declared_goal: "ship it", status: "pending_approval" };

  beforeEach(() => {
    fetchMock.mockResolvedValue(mockOk({ action: { action_id: "act_1" } }));
  });

  it("forwards act for grant binding on pending_approval records", async () => {
    await makeHandlers().dashclaw_record({
      ...RECORD_INPUT,
      act: { kind: "shell", command: "vercel deploy --prod" },
    });
    expect(lastRequestBody().act).toEqual({ kind: "shell", command: "vercel deploy --prod" });
  });

  it("omits act when not supplied (no null in the payload)", async () => {
    await makeHandlers().dashclaw_record(RECORD_INPUT);
    expect("act" in lastRequestBody()).toBe(false);
  });

  it("ignores a non-object act instead of forwarding garbage", async () => {
    await makeHandlers().dashclaw_record({ ...RECORD_INPUT, act: "vercel deploy" });
    expect("act" in lastRequestBody()).toBe(false);
  });
});

describe("idempotency keys (Organ 3 Phase 3)", () => {
  it("guard sends a derived idempotency key; identical calls derive identical keys", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_guard(GUARD_INPUT);
    const first = lastRequestBody().idempotency_key;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await handlers.dashclaw_guard(GUARD_INPUT);
    expect(lastRequestBody().idempotency_key).toBe(first);
  });

  it("distinct guard questions derive distinct keys", async () => {
    const handlers = makeHandlers();
    await handlers.dashclaw_guard(GUARD_INPUT);
    const first = lastRequestBody().idempotency_key;
    await handlers.dashclaw_guard({ ...GUARD_INPUT, declared_goal: "something else" });
    expect(lastRequestBody().idempotency_key).not.toBe(first);
  });

  it("record sends a derived idempotency key", async () => {
    fetchMock.mockResolvedValue(mockOk({ action: { action_id: "act_1" } }));
    await makeHandlers().dashclaw_record({ action_type: "deploy", declared_goal: "shipped", status: "completed" });
    expect(lastRequestBody().idempotency_key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("agent identity stays server-priority", () => {
  it("server-configured agent id beats tool-call input", async () => {
    await makeHandlers("srv-agent").dashclaw_guard({ ...GUARD_INPUT, agent_id: "llm-chosen-impostor" });
    expect(lastRequestBody().agent_id).toBe("srv-agent");
  });

  it("input agent_id is only a last-resort fallback when no server default exists", async () => {
    await makeHandlers("").dashclaw_guard({ ...GUARD_INPUT, agent_id: "explicit-config" });
    expect(lastRequestBody().agent_id).toBe("explicit-config");
  });
});

describe("dashclaw_record fails loud", () => {
  const RECORD_INPUT = { action_type: "deploy", declared_goal: "shipped", status: "completed" };

  it("surfaces a transport error as recorded:false with guidance", async () => {
    fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
    const out = JSON.parse(await makeHandlers().dashclaw_record(RECORD_INPUT));
    expect(out.recorded).toBe(false);
    expect(out.error).toContain("NOT written to the audit ledger");
    expect(out.error).toContain("ETIMEDOUT");
    expect(out.guidance).toContain("Retry dashclaw_record");
  });

  it("surfaces a non-2xx response as recorded:false", async () => {
    fetchMock.mockResolvedValue(mockStatus(401, { error: "Invalid or missing API key" }));
    const out = JSON.parse(await makeHandlers().dashclaw_record(RECORD_INPUT));
    expect(out.recorded).toBe(false);
    expect(out.error).toContain("Invalid or missing API key");
  });

  it("passes successful record responses through unchanged", async () => {
    fetchMock.mockResolvedValue(mockOk({ action: { action_id: "act_1" } }));
    const out = JSON.parse(await makeHandlers().dashclaw_record(RECORD_INPUT));
    expect(out.action.action_id).toBe("act_1");
    expect(out.recorded).toBeUndefined();
  });
});

describe("non-guard governance tools fail loud on transport errors", () => {
  it.each([
    ["dashclaw_invoke", { capability_id: "cap_1", declared_goal: "call capability" }],
    ["dashclaw_capabilities_list", {}],
    ["dashclaw_policies_list", {}],
  ])("%s returns an MCP isError result with a redacted transport message", async (tool, input) => {
    fetchMock.mockRejectedValue(new Error("connect ETIMEDOUT oc_live_test"));
    const handlers = registeredGovernanceHandlers();

    const result = await handlers.get(tool)!({ ...input });
    const body = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(body.error).toContain("DashClaw API unreachable");
    expect(body.error).toContain("***REDACTED***");
    expect(body.error).not.toContain("oc_live_test");
  });

  it.each([
    [401, { error: "Invalid or missing API key" }, /HTTP 401.*Invalid or missing API key/],
    [403, {
      success: false,
      error: "blocked_by_policy",
      guard_decision: { decision: "block", reasons: ["Capability denied by policy"] },
    }, /denied by policy.*Capability denied by policy/],
    [500, { error: "internal" }, /HTTP 500.*internal/],
  ])("dashclaw_invoke maps HTTP %s to a structural MCP error", async (status, response, message) => {
    fetchMock.mockResolvedValue(mockStatus(status, response));
    const handlers = registeredGovernanceHandlers();

    const result = await handlers.get("dashclaw_invoke")!({
      capability_id: "cap_1",
      declared_goal: "call capability",
    });
    const body = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(body.error).toMatch(message);
  });
});

describe("session transitions preserve honest ambient attribution", () => {
  it("failed session_start is structural and invalidates the previous ambient session", async () => {
    fetchMock
      .mockResolvedValueOnce(mockOk({ session: { id: "sess_A" } }))
      .mockResolvedValueOnce(mockStatus(500, { error: "session store unavailable" }))
      .mockResolvedValueOnce(mockOk({ action: { action_id: "act_1" } }));
    const handlers = makeHandlers();

    await handlers.dashclaw_session_start({ agent_id: "srv-agent", workspace: "A" });
    await expect(handlers.dashclaw_session_start({ agent_id: "srv-agent", workspace: "B" }))
      .rejects.toThrow(/dashclaw_session_start.*HTTP 500.*session store unavailable/);
    await handlers.dashclaw_record({ action_type: "research", declared_goal: "B work", status: "completed" });

    expect(lastRequestBody().session_id).toBeUndefined();
  });

  it("malformed session_start is structural and does not adopt an absent id", async () => {
    fetchMock.mockResolvedValueOnce(mockOk({ session: {} }));
    const handlers = registeredGovernanceHandlers();

    const result = await handlers.get("dashclaw_session_start")!({ agent_id: "srv-agent", workspace: "B" });
    const body = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(body.error).toMatch(/valid session id/);
  });

  it("failed session_end is structural and retains the still-open ambient session", async () => {
    fetchMock
      .mockResolvedValueOnce(mockOk({ session: { id: "sess_A" } }))
      .mockResolvedValueOnce(mockStatus(500, { error: "close failed" }))
      .mockResolvedValueOnce(mockOk({ action: { action_id: "act_1" } }));
    const handlers = makeHandlers();

    await handlers.dashclaw_session_start({ agent_id: "srv-agent", workspace: "A" });
    await expect(handlers.dashclaw_session_end({ session_id: "sess_A", status: "completed" }))
      .rejects.toThrow(/dashclaw_session_end.*HTTP 500.*close failed/);
    await handlers.dashclaw_record({ action_type: "research", declared_goal: "still A", status: "completed" });

    expect(lastRequestBody().session_id).toBe("sess_A");
  });
});

describe("governance tool guidance", () => {
  it("does not describe a guard decision id as a closable action record id", () => {
    const record = TOOL_DEFINITIONS.find((tool) => tool.name === "dashclaw_record");
    const actionId = record?.inputSchema.properties?.action_id?.description ?? "";

    expect(actionId).toContain("earlier dashclaw_record");
    expect(actionId).toContain("dashclaw_guard decision_id is not an action record");
    expect(actionId).not.toMatch(/returned by[^.]*dashclaw_guard/);
  });
});

describe("capabilities and policies list limits", () => {
  it("passes a requested capabilities limit and slices ignored server results", async () => {
    fetchMock.mockResolvedValue(mockOk({ capabilities: [{ id: 1 }, { id: 2 }, { id: 3 }] }));

    const out = JSON.parse(await makeHandlers().dashclaw_capabilities_list({ limit: 2 }));

    expect(lastRequestUrl().searchParams.get("limit")).toBe("2");
    expect(out.capabilities).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("passes a requested policies limit and slices ignored server results", async () => {
    fetchMock.mockResolvedValue(mockOk({ policies: [{ id: 1 }, { id: 2 }, { id: 3 }] }));

    const out = JSON.parse(await makeHandlers().dashclaw_policies_list({ limit: 2 }));

    expect(lastRequestUrl().searchParams.get("limit")).toBe("2");
    expect(out.policies).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("uses 50 as the default list limit", async () => {
    fetchMock.mockResolvedValue(mockOk({ capabilities: [] }));

    await makeHandlers().dashclaw_capabilities_list({});

    expect(lastRequestUrl().searchParams.get("limit")).toBe("50");
  });
});

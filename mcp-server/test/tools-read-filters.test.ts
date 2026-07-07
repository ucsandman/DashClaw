/**
 * Read-tool agent_id filter precedence.
 *
 * On query tools agent_id is a FILTER, not an identity claim: an explicit
 * tool-call filter must win over the server-configured agent id. (The old
 * behavior rewrote every cross-agent read to the server's own agent id, so
 * "show me moltfire's loops" silently returned the caller's rows.) Write
 * tools keep the opposite, server-priority precedence — covered in
 * tools-guard.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DashClawClient } from "../src/client.js";
import { createToolHandlers } from "../src/tools.js";

let fetchMock: ReturnType<typeof vi.fn>;

function mockOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeHandlers(agentId = "srv-agent") {
  const client = new DashClawClient({ url: "http://dashclaw.test", apiKey: "oc_live_test", agentId });
  return createToolHandlers(client);
}

function lastRequestUrl(): URL {
  const call = fetchMock.mock.calls.at(-1);
  return new URL(String(call?.[0]));
}

beforeEach(() => {
  fetchMock = vi.fn(async () => mockOk({ loops: [], decisions: [], messages: [] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const READ_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["dashclaw_decisions_recent", {}],
];

describe("read tools: explicit agent_id filter wins over configured id", () => {
  for (const [tool, extraArgs] of READ_TOOLS) {
    it(`${tool} sends the explicit filter`, async () => {
      const handlers = makeHandlers("srv-agent") as Record<string, (i: unknown) => Promise<string>>;
      await handlers[tool]({ ...extraArgs, agent_id: "other-agent" });
      expect(lastRequestUrl().searchParams.get("agent_id")).toBe("other-agent");
    });

    it(`${tool} defaults to the configured id when no filter is passed`, async () => {
      const handlers = makeHandlers("srv-agent") as Record<string, (i: unknown) => Promise<string>>;
      await handlers[tool]({ ...extraArgs });
      expect(lastRequestUrl().searchParams.get("agent_id")).toBe("srv-agent");
    });
  }
});

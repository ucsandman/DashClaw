import { afterEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { composeServer } from "../src/server.js";
import { DASHCLAW_GATED_TOOLS, governanceEnabled, governanceMisconfigured } from "../src/registration.js";
import { freshStore } from "./helpers.js";

/**
 * Records registration calls without a real McpServer — composeServer and
 * registerGovernance only ever call registerTool/registerResource.
 */
function recordingServer() {
  const tools: string[] = [];
  const resources: string[] = [];
  const server = {
    registerTool: (name: string) => {
      tools.push(name);
    },
    registerResource: (name: string) => {
      resources.push(name);
    },
  } as unknown as McpServer;
  return { server, tools, resources };
}

describe("conditional tool registration", () => {
  afterEach(() => {
    delete process.env.DASHCLAW_URL;
    delete process.env.DASHCLAW_API_KEY;
  });

  it("registers nothing without DashClaw credentials", () => {
    const { server, tools, resources } = recordingServer();
    const result = composeServer(server, freshStore());

    expect(result.governance).toBe(false);
    // The three DashClaw-gated tools gate on the same credentials as the
    // governance set, so with no credentials nothing registers.
    expect(tools).toEqual([]);
    expect(resources).toHaveLength(0);
  });

  it("registers the governance set and the DashClaw-gated tools when DASHCLAW_URL and DASHCLAW_API_KEY are present", () => {
    process.env.DASHCLAW_URL = "https://governed.example.com";
    process.env.DASHCLAW_API_KEY = "oc_live_test_dummy";

    const { server, tools, resources } = recordingServer();
    const result = composeServer(server, freshStore());

    expect(result.governance).toBe(true);
    expect(tools).toContain("dashclaw_guard");
    expect(tools).toContain("dashclaw_record");
    expect(tools).toContain("dashclaw_wait_for_approval");
    // The three env-config DashClaw tools gate on the same credentials.
    expect(tools).toContain("dashclaw_status");
    expect(tools).toContain("dashclaw_recent_decisions");
    expect(tools).toContain("export_dashclaw_evidence");
    expect([...DASHCLAW_GATED_TOOLS].every((name) => tools.includes(name))).toBe(true);
    expect(resources).toContain("DashClaw Policies");
    expect(resources).toContain("Agent Action History");
    expect(result.client.baseUrl).toBe("https://governed.example.com");
  });

  it("treats a half-configured pair as a misconfiguration", () => {
    expect(governanceEnabled()).toBe(false);
    expect(governanceMisconfigured()).toBeNull();

    process.env.DASHCLAW_URL = "https://governed.example.com";
    expect(governanceEnabled()).toBe(false);
    expect(governanceMisconfigured()).toBe("DASHCLAW_API_KEY");
  });
});

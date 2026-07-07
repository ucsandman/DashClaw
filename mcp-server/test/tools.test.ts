import { describe, expect, it } from "vitest";
import { registerTools } from "../src/tools/index.js";
import { freshStore } from "./helpers.js";

type RegisteredTool = {
  config: {
    description?: string;
    inputSchema: Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
  };
};

function registeredTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: RegisteredTool["config"]) {
      tools.set(name, { config });
    },
  };

  registerTools(server as never, freshStore());
  return tools;
}

function inputSchema(tool: string): RegisteredTool["config"]["inputSchema"] {
  const registered = registeredTools().get(tool);
  if (!registered) {
    throw new Error(`Tool ${tool} was not registered`);
  }
  return registered.config.inputSchema;
}

describe("DashClaw-gated MCP tools", () => {
  it("registers exactly the three DashClaw-gated tools", () => {
    const names = [...registeredTools().keys()].sort();
    expect(names).toEqual(["dashclaw_recent_decisions", "dashclaw_status", "export_dashclaw_evidence"]);
  });

  it("does not register any absorbed provider/launch/local-scaffolding tools", () => {
    const tools = registeredTools();
    for (const gone of [
      "list_projects",
      "create_project",
      "doctor",
      "simulate_action",
      "export_audit_log",
      "explain_action_risk",
      "list_github_branches",
      "create_vercel_deployment",
      "send_twilio_sms",
      "create_launch_plan",
      "map_provider_resource",
      "approve_action",
    ]) {
      expect(tools.has(gone)).toBe(false);
    }
  });

  it("validates numeric and provider options before handlers run", () => {
    expect(inputSchema("dashclaw_recent_decisions").limit.safeParse(0).success).toBe(false);
    expect(inputSchema("dashclaw_recent_decisions").limit.safeParse(1.5).success).toBe(false);
    expect(inputSchema("dashclaw_recent_decisions").limit.safeParse(5).success).toBe(true);
    expect(inputSchema("export_dashclaw_evidence").limit.safeParse(-1).success).toBe(false);
    expect(inputSchema("export_dashclaw_evidence").provider.safeParse("vercel").success).toBe(true);
    expect(inputSchema("export_dashclaw_evidence").provider.safeParse("not-a-provider").success).toBe(false);
    expect(inputSchema("export_dashclaw_evidence").project.safeParse("  ").success).toBe(false);
  });

  it("takes no input for dashclaw_status", () => {
    expect(Object.keys(inputSchema("dashclaw_status"))).toHaveLength(0);
  });
});

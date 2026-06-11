import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { composeServer } from "../src/server.js";
import { credentialEnvCandidates, enabledProviders, providerForTool } from "../src/registration.js";
import { createConnection } from "../src/service.js";
import { PROVIDER_IDS } from "../src/types.js";
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

const TOKEN_VARS = [
  "GITHUB_TOKEN",
  "VERCEL_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "STRIPE_TEST_SECRET_KEY",
  "STRIPE_LIVE_SECRET_KEY",
  "CUSTOM_SENTRY_TOKEN",
];

describe("conditional tool registration", () => {
  // The vitest setup file strips machine DASHCLAW_* env, but the developer
  // machine also exports real provider tokens (GITHUB_TOKEN, VERCEL_TOKEN, …)
  // that would silently enable providers here — strip every credential
  // candidate before each test, then set exactly what the test needs.
  beforeEach(() => {
    for (const provider of PROVIDER_IDS) {
      for (const envVar of credentialEnvCandidates(provider)) delete process.env[envVar];
    }
  });

  afterEach(() => {
    for (const name of TOKEN_VARS) delete process.env[name];
    delete process.env.DASHCLAW_URL;
    delete process.env.DASHCLAW_API_KEY;
  });

  it("registers no governance or provider tools without credentials", () => {
    const { server, tools, resources } = recordingServer();
    const result = composeServer(server, freshStore());

    expect(result.governance).toBe(false);
    expect(result.providers).toEqual([]);
    expect(tools).not.toContain("dashclaw_guard");
    expect(tools).not.toContain("dashclaw_status");
    expect(tools).not.toContain("dashclaw_work_order_submit");
    expect(tools).not.toContain("dashclaw_work_order_status");
    expect(tools).not.toContain("list_github_branches");
    expect(tools).not.toContain("create_vercel_deployment");
    expect(tools).not.toContain("list_stripe_products");
    expect(resources).toHaveLength(0);
    // Local context/state tools register regardless of credentials.
    expect(tools).toContain("list_projects");
    expect(tools).toContain("doctor");
    expect(tools).toContain("simulate_action");
  });

  it("registers the governance set when DASHCLAW_URL and DASHCLAW_API_KEY are present", () => {
    process.env.DASHCLAW_URL = "https://governed.example.com";
    process.env.DASHCLAW_API_KEY = "oc_live_test_dummy";

    const { server, tools, resources } = recordingServer();
    const result = composeServer(server, freshStore());

    expect(result.governance).toBe(true);
    expect(tools).toContain("dashclaw_guard");
    expect(tools).toContain("dashclaw_record");
    expect(tools).toContain("dashclaw_wait_for_approval");
    // Work Orders governance tools register alongside the rest of the governance set.
    expect(tools).toContain("dashclaw_work_order_submit");
    expect(tools).toContain("dashclaw_work_order_status");
    // env-config DashClaw tools gate on the same credentials.
    expect(tools).toContain("dashclaw_status");
    expect(resources).toContain("DashClaw Policies");
    expect(resources).toContain("Agent Action History");
    expect(result.client.baseUrl).toBe("https://governed.example.com");
  });

  it("registers a provider's tools only when its token env var is present", () => {
    process.env.GITHUB_TOKEN = "gh_dummy";

    const { server, tools } = recordingServer();
    const result = composeServer(server, freshStore());

    expect(result.providers).toEqual(["github"]);
    expect(tools).toContain("list_github_branches");
    expect(tools).toContain("rerun_github_workflow_run");
    expect(tools).not.toContain("create_vercel_deployment");
    expect(tools).not.toContain("create_sentry_release");
    expect(tools).not.toContain("purchase_domain");
  });

  it("registers only the matching sets under mixed env", () => {
    process.env.GITHUB_TOKEN = "gh_dummy";
    process.env.SENTRY_AUTH_TOKEN = "sentry_dummy";
    process.env.STRIPE_LIVE_SECRET_KEY = "sk_live_dummy";

    const { server, tools } = recordingServer();
    const result = composeServer(server, freshStore());

    expect(result.governance).toBe(false);
    expect(result.providers).toEqual(expect.arrayContaining(["github", "sentry", "stripe"]));
    expect(result.providers).not.toContain("vercel");
    expect(tools).toContain("list_github_pull_requests");
    expect(tools).toContain("create_sentry_deploy");
    // Either Stripe key (test or live) enables the Stripe set.
    expect(tools).toContain("list_stripe_products");
    expect(tools).not.toContain("get_vercel_deployments");
    expect(tools).not.toContain("dashclaw_guard");
  });

  it("enables a provider through a stored connection's custom env var", () => {
    const store = freshStore();
    createConnection(store, { provider: "sentry", label: "Org A", envVar: "CUSTOM_SENTRY_TOKEN" });

    expect(enabledProviders(store)).toEqual([]);
    process.env.CUSTOM_SENTRY_TOKEN = "sentry_custom_dummy";
    expect(enabledProviders(store)).toEqual(["sentry"]);
  });

  it("classifies domain/DNS tools as namecheap and dashclaw-prefixed local tools as local", () => {
    expect(providerForTool("purchase_domain")).toBe("namecheap");
    expect(providerForTool("get_dns_records")).toBe("namecheap");
    expect(providerForTool("list_github_branches")).toBe("github");
    expect(providerForTool("dashclaw_status")).toBeUndefined();
    expect(providerForTool("list_projects")).toBeUndefined();
  });
});

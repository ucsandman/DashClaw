#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store } from "./storage.js";
import { ensureDefaultWorkspace } from "./service.js";
import { composeServer, PACKAGE_VERSION } from "./server.js";
import { logEvent } from "./logger.js";

/**
 * @dashclaw/mcp-server — local stdio MCP server.
 *
 * One server, conditionally composed at startup: the governance tools/resources
 * and the three DashClaw-gated stdio tools register when DASHCLAW_URL +
 * DASHCLAW_API_KEY are set.
 *
 * IMPORTANT: never write to stdout outside the MCP transport — it corrupts the
 * JSON-RPC stream. All logging goes to stderr.
 */

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

const USAGE = `Usage: dashclaw-mcp [options]

Options:
  --url <url>          DashClaw instance URL (default: http://localhost:3000)
  --key <key>          API key (oc_live_ prefix)
  --agent-id <id>      Default agent ID
  --help               Show this help

Environment variables (fallback):
  DASHCLAW_URL         DashClaw instance URL
  DASHCLAW_API_KEY     API key
  DASHCLAW_AGENT_ID    Default agent ID`;

/** Parse --url/--key/--agent-id into the environment (args win over env). */
function applyCliArgs(argv: string[]): void {
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--url": {
        const value = argv[++i];
        if (value) process.env.DASHCLAW_URL = value;
        break;
      }
      case "--key": {
        const value = argv[++i];
        if (value) process.env.DASHCLAW_API_KEY = value;
        break;
      }
      case "--agent-id": {
        const value = argv[++i];
        if (value) process.env.DASHCLAW_AGENT_ID = value;
        break;
      }
      case "--help":
        console.error(USAGE);
        process.exit(0);
    }
  }
}

async function main(): Promise<void> {
  applyCliArgs(process.argv.slice(2));

  const store = new Store();
  ensureDefaultWorkspace(store);

  const server = new McpServer({
    name: "@dashclaw/mcp-server",
    version: PACKAGE_VERSION,
  });

  const { client, governance } = composeServer(server, store);

  // Auto-derive agent_id from the MCP `initialize` clientInfo when the user
  // hasn't supplied --agent-id or DASHCLAW_AGENT_ID. Without this, every call
  // from Claude Desktop, MCP Inspector, etc. arrives with an empty agent_id
  // and silently commingles with whatever default the server falls back to.
  // clientInfo.name identifies the connecting client (e.g. "claude-ai" for
  // Claude Desktop) — explicit configuration still wins, because we only set
  // it when client.agentId is empty.
  server.server.oninitialized = () => {
    const info = server.server.getClientVersion();
    if (!client.agentId && info?.name) {
      client.agentId = String(info.name);
      console.error(`[dashclaw] auto-derived agent_id from MCP clientInfo: ${client.agentId}`);
    }
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logEvent("info", "server.ready", {
    name: "@dashclaw/mcp-server",
    version: PACKAGE_VERSION,
    stateHome: store.paths.home,
    governance,
  });
  console.error("@dashclaw/mcp-server running on stdio");
}

main().catch((err) => {
  logEvent("error", "server.fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

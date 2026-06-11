#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store } from "./storage.js";
import { ensureDefaultWorkspace } from "./service.js";
import { registerTools } from "./tools/index.js";
import { logEvent } from "./logger.js";
/**
 * @dashclaw/mcp-server — local stdio MCP server.
 *
 * IMPORTANT: never write to stdout outside the MCP transport — it corrupts the
 * JSON-RPC stream. All logging goes to stderr.
 */
async function main() {
    const store = new Store();
    ensureDefaultWorkspace(store);
    const server = new McpServer({
        name: "@dashclaw/mcp-server",
        version: "0.0.1",
    });
    registerTools(server, store);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logEvent("info", "server.ready", { name: "@dashclaw/mcp-server", stateHome: store.paths.home });
}
main().catch((err) => {
    logEvent("error", "server.fatal", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
});
//# sourceMappingURL=index.js.map
/**
 * Server composition for @dashclaw/mcp-server.
 *
 * - createServer(config): v1-compatible factory — an McpServer with the full
 *   governance tool/resource set registered unconditionally (embedding API).
 * - composeServer(server, store): the stdio entry's composition — registers
 *   the governance set only when DashClaw credentials are present, and each
 *   provider's tools only when that provider's token env var(s) are set.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DashClawClient } from "./client.js";
import type { Store } from "./storage.js";
export declare const PACKAGE_VERSION: string;
export interface ServerConfig {
    /** DashClaw instance URL (default: http://localhost:3000) */
    url?: string;
    /** API key (oc_live_ prefix) */
    apiKey?: string;
    /** Default agent ID for tool calls */
    agentId?: string;
}
/**
 * Register the full governance tool + resource set on a server, bound to one
 * DashClawClient.
 */
export declare function registerGovernance(server: McpServer, client: DashClawClient): void;
/**
 * Create and configure an McpServer instance with all governance tools and
 * resources from TOOL_DEFINITIONS and RESOURCE_DEFINITIONS (v1-compatible
 * embedding API — registration is unconditional).
 */
export declare function createServer(config?: ServerConfig): {
    server: McpServer;
    client: DashClawClient;
};
export interface ComposeResult {
    client: DashClawClient;
    /** Whether the governance set was registered (DASHCLAW_URL + DASHCLAW_API_KEY). */
    governance: boolean;
}
/**
 * Conditional composition for the stdio server: the governance set and the
 * three DashClaw-gated stdio tools register iff DashClaw credentials are
 * present in the environment.
 */
export declare function composeServer(server: McpServer, store: Store): ComposeResult;

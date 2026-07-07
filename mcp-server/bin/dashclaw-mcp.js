#!/usr/bin/env node

/**
 * Thin launcher for the compiled @dashclaw/mcp-server package.
 *
 * Boots the stdio MCP server entry, which parses --url/--key/--agent-id/--help
 * flags. (The operational provider CLI was removed in the v5 governance cull.)
 */

await import('../lib/index.js');

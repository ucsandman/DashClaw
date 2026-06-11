#!/usr/bin/env node

/**
 * Thin launcher for the compiled @dashclaw/mcp-server package.
 *
 * - `dashclaw-mcp <subcommand> ...` routes to the operational CLI
 *   (init/project/env/connection/map/doctor/simulate/audit/snapshot/
 *   dashclaw/context — it reads process.argv itself).
 * - Anything else (bare, or --url/--key/--agent-id/--help flags) boots the
 *   stdio MCP server entry, which parses those flags.
 */

const CLI_COMMANDS = new Set([
  'init',
  'project',
  'select',
  'env',
  'connection',
  'map',
  'doctor',
  'simulate',
  'audit',
  'snapshot',
  'dashclaw',
  'context',
]);

const first = process.argv[2];

if (first && CLI_COMMANDS.has(first)) {
  await import('../lib/cli.js');
} else {
  await import('../lib/index.js');
}

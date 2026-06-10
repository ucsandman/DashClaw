// cli/lib/env.js
//
// `dashclaw env [--agent <id>] [-- <command...>]` — fetch the delivery-enabled
// managed-secret bundle from GET /api/secrets/env and inject it into a child
// process environment MEMORY-ONLY. Secret VALUES are never written to disk,
// never printed, and never echoed in error paths — only NAMES are ever shown.
// Fail-closed: if the bundle fetch fails, the child command is NOT run.

import { spawn } from 'node:child_process';
import { apiRequest } from './api.js';
import { dim } from './render.js';

/** GET /api/secrets/env for one agent. Returns { env, count, delivered }. */
export async function fetchAgentEnv(config, agentId) {
  return apiRequest(config, 'GET', '/api/secrets/env', { query: { agent_id: agentId } });
}

/**
 * Split the CLI argv at the `--` separator.
 * Tokens before `--` are flags for `dashclaw env`; tokens after are the
 * child command + its args (left untouched, including any `--print`).
 */
export function splitEnvArgv(argv) {
  const sep = argv.indexOf('--');
  if (sep === -1) return { flags: argv, command: [] };
  return { flags: argv.slice(0, sep), command: argv.slice(sep + 1) };
}

/** Names-only listing — never values. */
export function formatEnvNames(bundle) {
  const names = Array.isArray(bundle.delivered) ? bundle.delivered : Object.keys(bundle.env || {});
  const lines = [];
  if (names.length === 0) {
    lines.push(dim('  No delivery-enabled secrets for this agent.'));
  } else {
    for (const name of names) lines.push(`  ${name}`);
  }
  lines.push('');
  lines.push(dim(`  ${names.length} secret(s). Values are never printed — run: dashclaw env -- <command>`));
  return lines.join('\n');
}

/**
 * Spawn the child command with the secret bundle merged into its environment.
 * Memory-only: the merged env object lives only in this process and the
 * child's process table — nothing is written anywhere. Resolves with the
 * exit code to assign to process.exitCode (never calls process.exit — a hard
 * exit can trip a libuv teardown assert on Windows).
 */
export function runWithEnv(bundle, commandArgv) {
  const [cmd, ...cmdArgs] = commandArgv;
  // No shell: args pass through verbatim (shell:true concatenates them
  // unescaped — mangles quoted args and is deprecated, DEP0190).
  const child = spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...(bundle.env || {}) },
  });
  return new Promise((resolve) => {
    child.on('error', (err) => {
      // err.message is a spawn error (ENOENT/EINVAL etc.) — never contains values.
      console.error(`Error: could not start "${cmd}": ${err.message}`);
      if (process.platform === 'win32' && (err.code === 'EINVAL' || err.code === 'ENOENT')) {
        console.error(`Hint: Windows .cmd shims (npm, npx) cannot be spawned directly — try: dashclaw env -- cmd /c ${cmd} ...`);
      }
      resolve(1);
    });
    child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}

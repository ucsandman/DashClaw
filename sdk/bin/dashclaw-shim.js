#!/usr/bin/env node
// `npx dashclaw <args>` lands here (the SDK owns the bare npm name).
// Forward everything to @dashclaw/cli so there is exactly one real CLI.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export function resolveNpmCliPath({ execPath = process.execPath, npmExecPath = process.env.npm_execpath } = {}) {
  if (npmExecPath && npmExecPath.endsWith('npm-cli.js') && existsSync(npmExecPath)) {
    return npmExecPath;
  }
  const bundled = resolve(dirname(execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(bundled)) {
    throw new Error('Unable to locate npm-cli.js. Install npm alongside Node.js and retry.');
  }
  return bundled;
}

export function shimSpawnArgs(argv, options = {}) {
  const execPath = options.execPath || process.execPath;
  const npmCliPath = options.npmCliPath || resolveNpmCliPath({
    execPath,
    npmExecPath: options.npmExecPath,
  });
  return {
    cmd: execPath,
    args: [npmCliPath, 'exec', '--yes', '--', '@dashclaw/cli', ...argv],
  };
}

// Entry-check: normalize both paths to handle Windows case/slash differences.
const shimPath = resolve(fileURLToPath(import.meta.url));
const entryPath = resolve(process.argv[1] ?? '');
const isMain =
  process.platform === 'win32'
    ? shimPath.toLowerCase() === entryPath.toLowerCase()
    : shimPath === entryPath;

if (isMain) {
  const { cmd, args } = shimSpawnArgs(process.argv.slice(2));
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  process.exit(res.status ?? 1);
}

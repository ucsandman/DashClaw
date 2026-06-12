#!/usr/bin/env node
// `npx dashclaw <args>` lands here (the SDK owns the bare npm name).
// Forward everything to @dashclaw/cli so there is exactly one real CLI.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function shimSpawnArgs(argv) {
  return { cmd: 'npm', args: ['exec', '--yes', '--', '@dashclaw/cli', ...argv] };
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
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(res.status ?? 1);
}

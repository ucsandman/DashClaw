#!/usr/bin/env node
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMcpbManifest, readMcpServerVersion } from './lib/build-mcpb-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MCP = join(ROOT, 'mcp-server');
const STAGE = join(ROOT, 'dist', 'mcpb-build');
const OUT = join(ROOT, 'dist', 'dashclaw.mcpb');

// npm/npx are .cmd shims on Windows. On modern Node, spawning a .cmd directly
// (execFile/spawn) throws EINVAL — the CVE-2024-27980 hardening. Run through a
// shell instead (execSync), which also resolves `npm`/`npx` to their .cmd on
// Windows and `npm`/`npx` on POSIX/CI. Quote args with spaces (e.g. a repo path
// containing a space). All args here are build-time constants — no injection risk.
function run(cmd, args, opts = {}) {
  const line = [cmd, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
  execSync(line, { stdio: 'inherit', ...opts });
}

// 1. Fresh staging dir
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// 2. Copy the publishable server source + lockfile (needed for npm ci)
for (const f of ['bin', 'lib', 'package.json', 'package-lock.json', 'LICENSE', 'NOTICE', 'README.md']) {
  const src = join(MCP, f);
  if (existsSync(src)) cpSync(src, join(STAGE, f), { recursive: true });
}

// 3. Install production deps into the bundle
run('npm', ['ci', '--omit=dev'], { cwd: STAGE });

// 4. Generate manifest.json with the version from package.json (never hardcoded)
const version = readMcpServerVersion();
writeFileSync(
  join(STAGE, 'manifest.json'),
  JSON.stringify(buildMcpbManifest(version), null, 2) + '\n'
);

// 5. Pack the bundle
run('npx', ['--yes', '@anthropic-ai/mcpb@latest', 'pack', STAGE, OUT], { cwd: ROOT });

console.log(`\nBuilt ${OUT} (v${version})`);

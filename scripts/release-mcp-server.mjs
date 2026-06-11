import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Publishes @dashclaw/mcp-server to npm, then the same version to the official
// MCP Registry (registry.modelcontextprotocol.io). Idempotent: each step is
// skipped when the version is already live, so re-running is always safe.
//
// Prereqs (one-time, already done on this machine):
//   - npm login (publish uses your browser security key for the 2FA prompt)
//   - the official mcp-publisher binary from modelcontextprotocol/registry
//     releases. NOTE: `npm i -g mcp-publisher` is a SQUATTED unrelated package —
//     never install it from npm.

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(msg, color = '') {
  console.log(`${color}${msg}${RESET}`);
}

// Same idempotency-guard pattern as release-sdks.mjs: both values come from our
// own package.json, and the charset guards keep shell metacharacters out anyway.
function npmVersionExists(pkg, version) {
  if (!/^[A-Za-z0-9.+-]+$/.test(version || '')) return false;
  if (!/^[@A-Za-z0-9/._-]+$/.test(pkg || '')) return false;
  try {
    const out = execSync(`npm view ${pkg}@${version} version`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return out === version;
  } catch {
    return false;
  }
}

async function registryVersionExists(serverName, version) {
  try {
    const res = await fetch(
      `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(serverName)}`
    );
    if (!res.ok) return false;
    const data = await res.json();
    return (data.servers || []).some(
      (s) => s.server?.name === serverName && s.server?.version === version
    );
  } catch {
    return false;
  }
}

function resolvePublisher() {
  for (const candidate of [
    'mcp-publisher',
    path.join(os.homedir(), '.local', 'bin', 'mcp-publisher-bin', 'mcp-publisher.exe'),
  ]) {
    const probe = spawnSync(candidate, ['--help'], { stdio: 'ignore', shell: false });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function run(cmd, args, cwd) {
  // npm on Windows is a .cmd shim and needs a shell; everything else (the
  // mcp-publisher .exe) runs shell-free. All args here are static strings.
  const shell = process.platform === 'win32' && cmd === 'npm';
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd, shell });
  return result.status === 0;
}

async function release() {
  const rootDir = process.cwd();
  const mcpDir = path.join(rootDir, 'mcp-server');
  const pkgPath = path.join(mcpDir, 'package.json');
  const serverJsonPath = path.join(mcpDir, 'server.json');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;
  const serverName = pkg.mcpName;
  if (!serverName) {
    log(`❌ mcp-server/package.json is missing "mcpName" — the registry validates npm ownership through it.`, RED);
    process.exit(1);
  }
  log(`🚀 Releasing ${pkg.name}@${version} (registry: ${serverName})`, YELLOW);

  // --- 1. Sync server.json versions to package.json ---
  const serverJson = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
  let synced = false;
  if (serverJson.version !== version) {
    serverJson.version = version;
    synced = true;
  }
  for (const p of serverJson.packages || []) {
    if (p.identifier === pkg.name && p.version !== version) {
      p.version = version;
      synced = true;
    }
  }
  if (synced) {
    fs.writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n');
    log(`📝 server.json versions synced to ${version} — commit this change.`, YELLOW);
  }

  // --- 2. npm publish ---
  if (npmVersionExists(pkg.name, version)) {
    log(`⏭  npm ${pkg.name}@${version} already published — skipping.`, YELLOW);
  } else {
    try {
      execSync('npm whoami', { stdio: 'ignore' });
    } catch {
      log(`❌ Not logged into npm. Run "npm login" first.`, RED);
      process.exit(1);
    }
    log(`📦 Publishing to npm (browser may open for your security key)...`, YELLOW);
    if (!run('npm', ['publish', '--access', 'public'], mcpDir)) {
      log(`❌ npm publish failed.`, RED);
      process.exit(1);
    }
    log(`✅ npm ${pkg.name}@${version} published.`, GREEN);
  }

  // --- 3. MCP Registry publish ---
  if (await registryVersionExists(serverName, version)) {
    log(`⏭  Registry ${serverName}@${version} already published — skipping.`, YELLOW);
  } else {
    const publisher = resolvePublisher();
    if (!publisher) {
      log(`❌ mcp-publisher not found. Install the official binary from`, RED);
      log(`   https://github.com/modelcontextprotocol/registry/releases (do NOT use the npm package).`, RED);
      process.exit(1);
    }
    log(`🌐 Publishing to the MCP Registry...`, YELLOW);
    if (!run(publisher, ['publish'], mcpDir)) {
      // Most common failure: the GitHub-minted registry token expired (~15 min).
      log(`🔑 Publish failed — re-authenticating with GitHub (device flow)...`, YELLOW);
      if (!run(publisher, ['login', 'github'], mcpDir) || !run(publisher, ['publish'], mcpDir)) {
        log(`❌ Registry publish failed after re-login.`, RED);
        process.exit(1);
      }
    }
    log(`✅ Registry ${serverName}@${version} published.`, GREEN);
  }

  log(`\n✨ MCP server release complete.`, GREEN);
}

release();

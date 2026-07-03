#!/usr/bin/env node
/**
 * Build the DashClaw *Desktop* plugin: the two governance skills + a REMOTE
 * Streamable-HTTP `.mcp.json` pointing at your deployed `/api/mcp`.
 *
 * Why remote (not stdio / .mcpb): Claude Desktop's main chat runs local MCP
 * servers on its bundled Node, which crashes the DashClaw stdio server. A remote
 * `type: http` server has no local process, so it works in chat AND Cowork.
 *
 * Usage:
 *   node scripts/build-desktop-plugin.mjs --url https://your-instance.vercel.app
 *   node scripts/build-desktop-plugin.mjs --url https://... --key oc_live_xxx   # bake key (personal only)
 *
 * Output: dist/dashclaw-plugin.zip  (upload via Customize -> Plugins -> Upload plugin)
 */
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

// `--url` is your deployed DashClaw URL. `--key` defaults to an env-var
// reference (no secret in the file); pass a real oc_live_ key only for a
// personal build you will not commit or share.
const INSTANCE = arg('--url', 'https://YOUR-INSTANCE.vercel.app').replace(/\/$/, '');
const KEY = arg('--key', '${DASHCLAW_API_KEY}');

const PKG = join(ROOT, 'dist', 'desktop-plugin');
const STAGE = join(PKG, 'dashclaw');
const OUT = join(ROOT, 'dist', 'dashclaw-plugin.zip');

// Version follows the canonical Claude Code plugin manifest — never hardcode it
// here (the desktop build drifted a release behind before this).
const CANONICAL_PLUGIN = JSON.parse(
  readFileSync(join(ROOT, 'plugins', 'dashclaw', '.claude-plugin', 'plugin.json'), 'utf8'),
);

rmSync(PKG, { recursive: true, force: true });
mkdirSync(join(STAGE, '.claude-plugin'), { recursive: true });

// plugin.json — skills + the remote MCP server reference
writeFileSync(
  join(STAGE, '.claude-plugin', 'plugin.json'),
  JSON.stringify(
    {
      name: 'dashclaw',
      version: CANONICAL_PLUGIN.version,
      description:
        'DashClaw governance + platform intelligence: governed-agent protocol skills plus the live governance MCP tools (guard, record, invoke, approvals, sessions) over a remote connection to your DashClaw instance.',
      author: { name: 'DashClaw', email: 'team@dashclaw.io', url: 'https://dashclaw.io' },
      homepage: 'https://dashclaw.io/docs',
      repository: 'https://github.com/ucsandman/DashClaw',
      license: 'MIT',
      keywords: ['dashclaw', 'governance', 'mcp', 'agent-safety', 'approval', 'skills'],
      skills: './skills/',
      mcpServers: './.mcp.json',
    },
    null,
    2,
  ) + '\n',
);

// .mcp.json — REMOTE Streamable-HTTP server (reuses the working /api/mcp endpoint)
writeFileSync(
  join(STAGE, '.mcp.json'),
  JSON.stringify(
    {
      mcpServers: {
        dashclaw: {
          type: 'http',
          url: `${INSTANCE}/api/mcp`,
          headers: { 'x-api-key': KEY },
        },
      },
    },
    null,
    2,
  ) + '\n',
);

// skills (copy from the canonical plugin)
cpSync(join(ROOT, 'plugins', 'dashclaw', 'skills'), join(STAGE, 'skills'), { recursive: true });

// Trim the governance skill's description to the consumer app's ~200-char limit
// (the canonical SKILL.md uses a long folded description for Claude Code).
const govMd = join(STAGE, 'skills', 'dashclaw-governance', 'SKILL.md');
let md = readFileSync(govMd, 'utf8');
md = md.replace(
  /^description:[\s\S]*?(?=\n---)/m,
  'description: "DashClaw governed-agent protocol: guard by risk, interpret allow/warn/block/require_approval, record actions, wait for approvals, manage sessions. Triggers: governed agent, dashclaw, approvals."',
);
writeFileSync(govMd, md);

// Zip with forward-slash entries. Use the OS bsdtar (Win10+ System32 / macOS),
// which creates a spec-correct zip; Git Bash's GNU `tar` can't make zips and
// treats `C:` as a remote host, and PowerShell 5.1's Compress-Archive emits
// backslash entries that break the plugin loader. Run from ROOT with relative
// paths so no `drive:` colon reaches tar.
rmSync(OUT, { force: true });
const tarBin =
  process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
execFileSync(tarBin, ['-a', '-cf', 'dist/dashclaw-plugin.zip', '-C', 'dist/desktop-plugin', 'dashclaw'], {
  cwd: ROOT,
  stdio: 'inherit',
});

const masked = KEY.startsWith('oc_live_') ? 'BAKED-IN (personal build — do not commit/share)' : KEY;
console.log(`\nBuilt ${OUT}\n  instance: ${INSTANCE}/api/mcp\n  x-api-key: ${masked}`);

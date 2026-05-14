// __tests__/unit/plugins/plugin-parity.test.js
//
// Sanity-check that the Claude Code plugin manifest in
// plugins/dashclaw/.claude-plugin/ is well-formed and aligned with the
// Codex manifest (when present). The Codex manifest may not exist on
// every branch (the broader plugin tree is currently being built on
// another branch), so we test the Claude side hard and the Codex side
// only when the file is present.

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PLUGIN_DIR = path.join(REPO_ROOT, 'plugins', 'dashclaw');

const CLAUDE_MANIFEST = path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json');
const CODEX_MANIFEST  = path.join(PLUGIN_DIR, '.codex-plugin', 'plugin.json');
const CLAUDE_MCP      = path.join(PLUGIN_DIR, '.mcp-claude.json');
const CODEX_MCP       = path.join(PLUGIN_DIR, '.mcp.json');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('Claude plugin manifest', () => {
  it('exists and is valid JSON', () => {
    assert.equal(fs.existsSync(CLAUDE_MANIFEST), true,
      'plugins/dashclaw/.claude-plugin/plugin.json must exist');
    const manifest = loadJson(CLAUDE_MANIFEST);
    assert.equal(manifest.name, 'dashclaw');
  });

  it('declares the required Claude Code plugin manifest fields', () => {
    const manifest = loadJson(CLAUDE_MANIFEST);
    for (const required of ['name', 'version', 'description', 'license']) {
      assert.ok(manifest[required], `missing required field: ${required}`);
    }
  });

  it('references the Claude-specific MCP config (not the Codex one)', () => {
    const manifest = loadJson(CLAUDE_MANIFEST);
    assert.equal(manifest.mcpServers, './.mcp-claude.json');
  });

  it('uses kebab-case name (Claude plugin requirement)', () => {
    const manifest = loadJson(CLAUDE_MANIFEST);
    assert.match(manifest.name, /^[a-z][a-z0-9-]*$/);
  });
});

describe('Claude MCP config', () => {
  it('exists and is valid JSON', () => {
    assert.equal(fs.existsSync(CLAUDE_MCP), true,
      'plugins/dashclaw/.mcp-claude.json must exist');
    const cfg = loadJson(CLAUDE_MCP);
    assert.ok(cfg.mcpServers?.dashclaw);
  });

  it('records actions under the claude-code agent identity', () => {
    const cfg = loadJson(CLAUDE_MCP);
    const args = cfg.mcpServers.dashclaw.args;
    const idx = args.indexOf('--agent-id');
    assert.notEqual(idx, -1, '--agent-id flag must be present');
    assert.equal(args[idx + 1], 'claude-code');
  });

  it('points at the same MCP server binary as Codex would', () => {
    const cfg = loadJson(CLAUDE_MCP);
    const args = cfg.mcpServers.dashclaw.args;
    assert.match(args[0], /mcp-server[\/\\]bin[\/\\]dashclaw-mcp\.js$/);
  });
});

describe('Codex/Claude parity', () => {
  it('keeps name, repo, license, description theme in sync (when both exist)', () => {
    if (!fs.existsSync(CODEX_MANIFEST)) return; // Codex manifest in flight elsewhere; skip
    const claude = loadJson(CLAUDE_MANIFEST);
    const codex = loadJson(CODEX_MANIFEST);
    assert.equal(claude.name, codex.name);
    assert.equal(claude.repository, codex.repository);
    assert.equal(claude.license, codex.license);
    assert.deepEqual(claude.keywords?.slice().sort(), codex.keywords?.slice().sort());
  });

  it('keeps Codex MCP config pinned to the codex agent id (when present)', () => {
    if (!fs.existsSync(CODEX_MCP)) return;
    const cfg = loadJson(CODEX_MCP);
    const args = cfg.mcpServers.dashclaw.args;
    const idx = args.indexOf('--agent-id');
    assert.notEqual(idx, -1);
    assert.equal(args[idx + 1], 'codex');
  });
});

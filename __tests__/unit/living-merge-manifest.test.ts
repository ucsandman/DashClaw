import { describe, it, expect } from 'vitest';
import { isGenerated, isAuthored, GENERATED_PATTERNS } from '../../scripts/living-merge/manifest';

describe('living-merge manifest — generated projections', () => {
  const generated = [
    'public/downloads/dashclaw-governance.zip',
    'public/downloads/dashclaw-governance-plugin.zip',
    'public/downloads/dashclaw-claude-code-hooks.zip',
    'plugins/dashclaw/skills/dashclaw-governance/SKILL.md',
    'plugins/dashclaw/hooks/dashclaw_pretool.py',
    'plugins/dashclaw/hooks/dashclaw_agent_intel/session_tracker.py',
    'docs/api-inventory.json',
    'docs/api-inventory.md',
    'docs/openapi/critical-stable.openapi.json',
  ];
  it.each(generated)('treats %s as generated', (p) => {
    expect(isGenerated(p)).toBe(true);
    expect(isAuthored(p)).toBe(false);
  });
  it('normalizes Windows backslashes', () => {
    expect(isGenerated('docs\\api-inventory.json')).toBe(true);
  });
});

describe('living-merge manifest — AUTHORED files MUST stay protected', () => {
  // The load-bearing boundary: marking ANY of these merge=regenerate would
  // silently DISCARD hand edits on merge. Guard it with a test.
  const authored = [
    'sdk/dashclaw.js',
    'sdk/index.cjs',
    'sdk-python/dashclaw/client.py',
    'sdk/README.md',
    'cli/bin/dashclaw.js',
    'package-lock.json',
    '.claude/CODEBASE_MAP.md',
    'plugins/dashclaw/.claude-plugin/plugin.json',
    'plugins/dashclaw/hooks/hooks.json',
    'hooks/dashclaw_pretool.py', // canonical source, NOT the plugin mirror
    'public/downloads/dashclaw-governance/SKILL.md',
    'app/api/guard/route.ts',
    'middleware.js',
    'schema/schema.js',
  ];
  it.each(authored)('treats %s as authored (protected)', (p) => {
    expect(isAuthored(p)).toBe(true);
    expect(isGenerated(p)).toBe(false);
  });
});

describe('living-merge manifest — boundary invariants', () => {
  it('classifies the hooks/ source and its plugin mirror oppositely', () => {
    expect(isGenerated('plugins/dashclaw/hooks/dashclaw_pretool.py')).toBe(true); // mirror = generated
    expect(isGenerated('hooks/dashclaw_pretool.py')).toBe(false); // source = authored
  });
  it('generates the plugin governance-skill mirror but protects its canonical source', () => {
    expect(isGenerated('plugins/dashclaw/skills/dashclaw-governance/SKILL.md')).toBe(true);
    expect(isGenerated('public/downloads/dashclaw-governance/SKILL.md')).toBe(false);
  });
  it('has no empty patterns', () => {
    expect(GENERATED_PATTERNS.every((p) => p.length > 0)).toBe(true);
  });
});

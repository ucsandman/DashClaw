import { execFileSync } from 'node:child_process';

const STEPS = [
  {
    id: 'generate-api-inventory',
    label: 'Generate API inventory',
    command: [process.execPath, 'scripts/generate-api-inventory.mjs'],
    failHook: true,
  },
  {
    id: 'generate-openapi',
    label: 'Generate OpenAPI spec',
    command: [process.execPath, 'scripts/generate-openapi.mjs'],
    failHook: true,
  },
  {
    // Regenerate livingcode-derived artifacts (shape.json, SKILL.md, zip,
    // doctor checks) when staged files may have changed the shape. Script
    // exits fast when no relevant files are staged.
    id: 'livingcode-refresh',
    label: 'Refresh livingcode-derived artifacts',
    command: [process.execPath, 'scripts/livingcode-refresh.mjs', '--if-staged'],
    failHook: true,
  },
  {
    id: 'stage-artifacts',
    label: 'Stage generated artifacts',
    command: [
      'git',
      'add',
      'docs/api-inventory.json',
      'docs/api-inventory.md',
      'docs/openapi/critical-stable.openapi.json',
      'app/lib/doctor/generated',
      'public/downloads/dashclaw-platform-intelligence',
      'public/downloads/dashclaw-platform-intelligence.zip',
      'public/downloads/dashclaw-platform-intelligence.zip.manifest',
      // Bundle zips that livingcode-refresh regenerates from sources but were
      // previously NOT auto-staged — meaning every commit that touched
      // hooks/, plugins/dashclaw/, or governance source files left the zip
      // stale on origin (caught in 2026-05-15 audit, see commit 1eaff4c5).
      'public/downloads/dashclaw-claude-code-hooks.zip',
      'public/downloads/dashclaw-claude-code-hooks.zip.manifest',
      'public/downloads/dashclaw-governance.zip',
      'public/downloads/dashclaw-governance.zip.manifest',
      'public/downloads/dashclaw-governance-plugin.zip',
      'public/downloads/dashclaw-governance-plugin.zip.manifest',
      'plugins/dashclaw/skills/dashclaw-platform-intelligence',
      'plugins/dashclaw/skills/dashclaw-governance',
      // Plugin hook mirrors (PLUGIN_HOOK_SCRIPTS outputs + the agent_intel
      // module) — regenerated from canonical hooks/ on every refresh but
      // previously NOT auto-staged, so every hooks/ commit left the plugin
      // mirrors for a follow-up sync commit (e.g. ccac301e; recurred in the
      // organ-3 run). Scripts are listed individually so the AUTHORED
      // plugins/dashclaw/hooks/hooks.json is never swept in.
      'plugins/dashclaw/hooks/dashclaw_pretool.py',
      'plugins/dashclaw/hooks/dashclaw_posttool.py',
      'plugins/dashclaw/hooks/dashclaw_stop.py',
      'plugins/dashclaw/hooks/enforcement_liveness_probe.py',
      'plugins/dashclaw/hooks/dashclaw_agent_intel',
      // Platform-intelligence skill mirrors written by the refresh outside
      // public/downloads — same orphaning symptom, same fix.
      '.agents/skills/dashclaw-platform-intelligence',
      '.claude/skills/dashclaw-platform-intelligence',
      '.hermes/skills/dashclaw-platform-intelligence',
      'mcp-server/lib/routes-inventory.generated.json',
      'public/livingcode/index.html',
    ],
    failHook: true,
  },
  {
    // Block commits that introduce hardcoded version literals in user-facing
    // code. UI / SDK source must derive versions from package.json /
    // pyproject.toml / plugin.json — see scripts/check-version-hardcodes.mjs
    // for the canonical list and allowed-file allowlist.
    id: 'version-hardcodes',
    label: 'Check for hardcoded version literals',
    command: [process.execPath, 'scripts/check-version-hardcodes.mjs'],
    failHook: true,
  },
  {
    // Enforce ONE DashClaw version across the platform + both SDK manifests
    // (package.json, sdk/package.json, sdk-python/pyproject.toml). Bump them
    // together with `npm run version:set <x.y.z>`.
    id: 'version-sync',
    label: 'Check platform + SDK version sync',
    command: [process.execPath, 'scripts/check-version-sync.mjs'],
    failHook: true,
  },
  {
    id: 'contracts-check',
    label: 'Run contracts check (warn-only)',
    command: [process.execPath, 'scripts/check-contracts.mjs', '--mode=warn'],
    failHook: false,
  },
];

/**
 * Run all pre-commit checks in sequence.
 *
 * @param {{ execImpl?: Function }} options
 * @returns {{ success: boolean, steps: Array<{ id: string, label: string, success: boolean, error?: string }> }}
 */
export function runPreCommitChecks({ execImpl = execFileSync } = {}) {
  const steps = [];
  let success = true;

  for (const step of STEPS) {
    const [cmd, ...args] = step.command;
    try {
      execImpl(cmd, args, { stdio: 'inherit' });
      steps.push({ id: step.id, label: step.label, success: true });
    } catch (err) {
      const error = err.message || String(err);
      steps.push({ id: step.id, label: step.label, success: false, error });

      if (step.failHook) {
        success = false;
        break;
      }
      // warn-only steps don't set success = false
    }
  }

  return { success, steps };
}

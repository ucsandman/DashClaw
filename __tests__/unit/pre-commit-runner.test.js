import { describe, expect, it, vi } from 'vitest';
import { runPreCommitChecks } from '../../scripts/lib/run-pre-commit-checks.mjs';

describe('runPreCommitChecks', () => {
  it('returns success when all steps pass', () => {
    const execImpl = vi.fn();
    const result = runPreCommitChecks({ execImpl });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(9);
    expect(result.steps.every((s) => s.success)).toBe(true);

    // Verify the correct commands were invoked in order
    expect(execImpl).toHaveBeenCalledTimes(9);
    expect(execImpl.mock.calls[0][1]).toContain('scripts/precommit-lint-typecheck.mjs');
    expect(execImpl.mock.calls[1][1]).toContain('scripts/generate-api-inventory.mjs');
    expect(execImpl.mock.calls[2][1]).toContain('scripts/generate-openapi.mjs');
    expect(execImpl.mock.calls[3][1]).toContain('scripts/refresh-bundles.mjs');
    expect(execImpl.mock.calls[3][1]).toContain('--if-staged');
    expect(execImpl.mock.calls[4][1]).toContain('scripts/check-doc-counts.mjs');
    expect(execImpl.mock.calls[4][1]).toContain('--write');
    expect(execImpl.mock.calls[4][1]).toContain('--staged-only');
    expect(execImpl.mock.calls[5][1]).toEqual([
      'add',
      'docs/api-inventory.json',
      'docs/api-inventory.md',
      'docs/openapi/critical-stable.openapi.json',
      'public/downloads/dashclaw-claude-code-hooks.zip',
      'public/downloads/dashclaw-claude-code-hooks.zip.manifest',
      'public/downloads/dashclaw-governance.zip',
      'public/downloads/dashclaw-governance.zip.manifest',
      'public/downloads/dashclaw-governance-plugin.zip',
      'public/downloads/dashclaw-governance-plugin.zip.manifest',
      'plugins/dashclaw/skills/dashclaw-governance',
      'plugins/dashclaw/hooks/dashclaw_pretool.py',
      'plugins/dashclaw/hooks/dashclaw_posttool.py',
      'plugins/dashclaw/hooks/dashclaw_stop.py',
      'plugins/dashclaw/hooks/enforcement_liveness_probe.py',
      'plugins/dashclaw/hooks/dashclaw_agent_intel',
    ]);
    expect(execImpl.mock.calls[6][1]).toContain('scripts/check-version-hardcodes.mjs');
    expect(execImpl.mock.calls[7][1]).toContain('scripts/check-version-sync.mjs');
    expect(execImpl.mock.calls[8][1]).toContain('--mode=warn');
  });

  it('derives doc counts before staging, and a doc-counts failure never blocks the commit', () => {
    const execImpl = vi.fn().mockImplementation((cmd, args) => {
      if (args?.some((a) => a.includes('check-doc-counts'))) {
        throw new Error('doc-counts: 1 check(s) never ran');
      }
    });

    const result = runPreCommitChecks({ execImpl });

    // warn-only: CI's `--strict` run is the authoritative gate, so a reworded
    // doc must not stop a local commit.
    expect(result.success).toBe(true);
    const step = result.steps.find((s) => s.id === 'doc-counts-derive');
    expect(step.success).toBe(false);
    // ...and the run continued through staging rather than breaking early.
    expect(result.steps.find((s) => s.id === 'stage-artifacts').success).toBe(true);
  });

  it('succeeds when contracts check warns but does not fail the hook', () => {
    const execImpl = vi.fn().mockImplementation((cmd, args) => {
      if (args?.includes('--mode=warn')) {
        throw new Error('contracts warning: sdk-parity drift detected');
      }
    });

    const result = runPreCommitChecks({ execImpl });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(9);

    const contractsStep = result.steps.find((s) => s.id === 'contracts-check');
    expect(contractsStep.success).toBe(false);
    expect(contractsStep.error).toContain('contracts warning');
  });

  it('fails when API inventory generation fails', () => {
    const execImpl = vi.fn().mockImplementation((cmd, args) => {
      if (args?.some((a) => a.includes('generate-api-inventory'))) {
        throw new Error('inventory generation failed');
      }
    });

    const result = runPreCommitChecks({ execImpl });

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].id).toBe('lint-typecheck');
    expect(result.steps[1].id).toBe('generate-api-inventory');
    expect(result.steps[1].success).toBe(false);
    expect(result.steps[1].error).toContain('inventory generation failed');
  });

  it('fails when OpenAPI generation fails', () => {
    const execImpl = vi.fn().mockImplementation((cmd, args) => {
      if (args?.some((a) => a.includes('generate-openapi'))) {
        throw new Error('openapi generation failed');
      }
    });

    const result = runPreCommitChecks({ execImpl });

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1].success).toBe(true);
    expect(result.steps[2].id).toBe('generate-openapi');
    expect(result.steps[2].success).toBe(false);
  });

  it('fails when staging artifacts fails', () => {
    const execImpl = vi.fn().mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        throw new Error('git add failed');
      }
    });

    const result = runPreCommitChecks({ execImpl });

    expect(result.success).toBe(false);
    const stageStep = result.steps.find((s) => s.id === 'stage-artifacts');
    expect(stageStep.success).toBe(false);
    expect(stageStep.error).toContain('git add failed');
  });

  it('stops executing after a hard failure', () => {
    const execImpl = vi.fn().mockImplementation((cmd, args) => {
      if (args?.some((a) => a.includes('generate-api-inventory'))) {
        throw new Error('boom');
      }
    });

    const result = runPreCommitChecks({ execImpl });

    // Only 2 steps recorded because it broke on generate-api-inventory
    expect(result.steps).toHaveLength(2);
    // exec stopped at the failing step — subsequent steps were skipped
    expect(execImpl).toHaveBeenCalledTimes(2);
  });
});

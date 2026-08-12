import { execFileSync } from 'node:child_process';

const STEPS = [
  {
    // Lint staged JS/TS (and typecheck when a staged file is .ts/.tsx) BEFORE
    // regenerating artifacts, so a broken commit fails fast. Script exits
    // immediately when no lintable files are staged.
    id: 'lint-typecheck',
    label: 'Lint staged files + typecheck',
    command: [process.execPath, 'scripts/precommit-lint-typecheck.mjs'],
    failHook: true,
  },
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
    // Refresh the download bundle zips + plugin mirrors when staged files may
    // have changed them. Script exits fast when no relevant files are staged.
    id: 'bundles-refresh',
    label: 'Refresh download bundles',
    command: [process.execPath, 'scripts/refresh-bundles.mjs', '--if-staged'],
    failHook: true,
  },
  {
    // Derive the drift-prone counts (route totals, MCP tool/resource counts,
    // SDK method counts) from source-of-truth instead of leaving ~40 numbers
    // across 20 files for a human to retype after CI rejects the push. Runs
    // AFTER generate-api-inventory because it reads docs/api-inventory.json.
    //
    // --staged-only keeps it to files already in this commit and re-stages
    // exactly those, so it can never sweep an unrelated unstaged edit to
    // README.md into the commit. A drifted count in an unstaged file is
    // reported, never written. warn-only here: `--strict` in CI stays the
    // authoritative gate, and a reworded doc (DEAD guard) must not block a
    // local commit.
    id: 'doc-counts-derive',
    label: 'Derive doc counts from source-of-truth',
    command: [process.execPath, 'scripts/check-doc-counts.mjs', '--write', '--staged-only'],
    failHook: false,
  },
  {
    id: 'stage-artifacts',
    label: 'Stage generated artifacts',
    // ONLY the artifacts regenerated unconditionally above (generate-api-
    // inventory / generate-openapi). Those two steps always run, so whatever
    // is on disk now is correct for this commit and staging it can't sweep in
    // an unrelated edit.
    //
    // The bundle zips and plugin mirrors used to be listed here too. They are
    // NOT regenerated unconditionally — `refresh-bundles.mjs --if-staged`
    // skips entirely when no bundle source is staged — so a flat `git add`
    // swept hand-run-dirty zips into whichever commit ran first, regardless of
    // what that commit touched. Their staging now lives inside
    // refresh-bundles.mjs, gated on a bundle source actually being staged,
    // which keeps commit 1eaff4c5 (stale zips on origin) fixed. See
    // stageBundleArtifacts() there for why "source staged" beats "I wrote it".
    command: [
      'git',
      'add',
      '--',
      'docs/api-inventory.json',
      'docs/api-inventory.md',
      'docs/openapi/critical-stable.openapi.json',
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

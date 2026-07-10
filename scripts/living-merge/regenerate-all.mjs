#!/usr/bin/env node
/**
 * living-merge — the single "regenerate everything from source" entry point.
 *
 * Runs the THREE generators that produce committed projections, in dependency
 * order, failing LOUD on any error:
 *   1. generate-api-inventory.mjs  -> docs/api-inventory.{json,md}
 *   2. generate-openapi.mjs        -> docs/openapi/critical-stable.openapi.json
 *   3. refresh-bundles.mjs         -> skill / hook mirrors + bundle zips
 *
 * Invoked by the post-merge & post-rewrite git hooks and by the
 * rebase-onto-main helper, so whatever side a merge driver kept is immediately
 * overwritten by a correct regeneration of the MERGED source. Idempotent: a
 * second run produces zero diff (verified in STAGE 0).
 *
 * Plain Node + stdlib only (no npm deps, no tsx) so it is safe to run from a
 * git hook. Requires: Node 20+ and PowerShell (Windows) / zip (POSIX) for the
 * bundle steps — the same prerequisites refresh-bundles.mjs already needs.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const STEPS = [
  { label: 'api-inventory', command: [process.execPath, 'scripts/generate-api-inventory.mjs'] },
  { label: 'openapi', command: [process.execPath, 'scripts/generate-openapi.mjs'] },
  { label: 'bundles', command: [process.execPath, 'scripts/refresh-bundles.mjs'] },
];

function main() {
  const quiet = process.argv.includes('--quiet');
  for (const step of STEPS) {
    const [cmd, ...args] = step.command;
    if (!quiet) process.stdout.write(`[living-merge] regenerate: ${step.label}...\n`);
    const r = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit' });
    if (r.error) {
      process.stderr.write(`[living-merge] regenerate FAILED to spawn ${step.label}: ${r.error.message}\n`);
      process.exit(1);
    }
    if (r.status !== 0) {
      process.stderr.write(`[living-merge] regenerate FAILED at ${step.label} (exit ${r.status ?? r.signal})\n`);
      process.exit(typeof r.status === 'number' ? r.status : 1);
    }
  }
  if (!quiet) process.stdout.write('[living-merge] regenerate complete\n');
}

main();

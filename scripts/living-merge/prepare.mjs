#!/usr/bin/env node
/**
 * living-merge — npm `prepare` hook (best-effort auto-install).
 *
 * Wired into package.json so `npm install` / `npm ci` on a fresh clone or new
 * worktree automatically registers the merge driver, relative hooks path,
 * .gitattributes block, and SessionStart hook — closing the bootstrap gap where
 * a clone that never ran install.ts would fall back to git's default merge and
 * produce conflict markers in generated files.
 *
 * NEVER fails the install: if tsx is unavailable (e.g. `npm ci --omit=dev`), or
 * this isn't a git repo, or install.ts errors, we swallow it and exit 0. Running
 * install.ts directly remains the explicit, idempotent path.
 *
 * The one case this file cannot self-guard is its own absence: a Docker `deps`
 * stage that copies only package*.json then runs `npm ci` has no `scripts/` dir,
 * so node would fail with MODULE_NOT_FOUND before this code loads. The package.json
 * `prepare` entry therefore wraps this in an `fs.existsSync` guard (cross-platform;
 * `2>/dev/null` would break Windows) so npm skips it cleanly — keep that guard, or
 * that build breaks. Run install.ts directly to bootstrap when scripts ARE present.
 */
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/living-merge/install.ts'], { stdio: 'inherit' });
if (r.error || r.status !== 0) {
  process.stderr.write('[living-merge] prepare: auto-install skipped — run `node --import tsx scripts/living-merge/install.ts` manually.\n');
}
process.exit(0);

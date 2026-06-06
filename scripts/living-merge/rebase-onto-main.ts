#!/usr/bin/env node
/**
 * living-merge — rebase-edges helper. Run at START-OF-WORK and RIGHT-BEFORE
 * LANDING (not continuously):
 *
 *   node --import tsx scripts/living-merge/rebase-onto-main.ts [--main <branch>] [--remote <name>] [--no-fetch]
 *
 * Rebases the current branch onto the latest main and regenerates all
 * projections, so the branch carries a correct, conflict-free set of generated
 * files into its landing commit. Generated files never block the rebase — the
 * merge=regenerate driver keeps one side, the post-rewrite hook regenerates —
 * and this helper then runs a full regenerate and `git add`s the projections so
 * they are staged for the landing commit. Does NOT commit or push: the human
 * lands.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GENERATED_PATTERNS } from './manifest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN_PATHSPECS = GENERATED_PATTERNS.map((p) => (p.endsWith('/**') ? p.slice(0, -3) : p));

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const MAIN = argValue('--main', 'main');
const REMOTE = argValue('--remote', 'origin');
const NO_FETCH = process.argv.includes('--no-fetch');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}
function refExists(ref: string): boolean {
  try { execFileSync('git', ['rev-parse', '--verify', ref], { cwd: REPO_ROOT, stdio: 'ignore' }); return true; } catch { return false; }
}
function run(cmd: string, args: string[], label: string): void {
  process.stdout.write(`[living-merge] ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    process.stderr.write(`[living-merge] FAILED: ${label} (exit ${r.status ?? r.signal})\n`);
    process.exit(typeof r.status === 'number' ? r.status : 1);
  }
}

function main(): void {
  if (git(['status', '--porcelain']).trim()) {
    process.stderr.write('[living-merge] working tree not clean — commit or stash first.\n');
    process.exit(2);
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch === MAIN) {
    process.stderr.write(`[living-merge] already on ${MAIN}; nothing to rebase.\n`);
    process.exit(0);
  }
  if (!NO_FETCH) run('git', ['fetch', REMOTE, MAIN], `fetch ${REMOTE}/${MAIN}`);
  const onto = refExists(`${REMOTE}/${MAIN}`) ? `${REMOTE}/${MAIN}` : MAIN;
  run('git', ['rebase', onto], `rebase ${branch} onto ${onto}`);
  run('node', ['scripts/living-merge/regenerate-all.mjs'], 'regenerate projections');
  try { execFileSync('git', ['add', '--', ...GEN_PATHSPECS], { cwd: REPO_ROOT, stdio: 'ignore' }); } catch { /* nothing to stage */ }
  process.stdout.write(`[living-merge] done — ${branch} rebased onto ${onto}, projections regenerated and staged.\n`);
  process.stdout.write('[living-merge] review, commit, and push to land.\n');
}

main();

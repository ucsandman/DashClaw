#!/usr/bin/env node
/**
 * living-merge — automated merge + self-heal test (success criteria #2 and #3).
 *
 *   node --import tsx scripts/living-merge/selftest-merge.ts
 *
 * Creates two scratch branches that edit the SAME generated file divergently,
 * merges them (a real 3-way merge that WOULD conflict without the driver), then:
 *   #2  asserts the merge commit contains ZERO conflict markers in any generated
 *       path (the merge=regenerate driver kept one side, exit 0) — isolated from
 *       the hook by grepping the COMMIT, not the post-hook working tree.
 *   #3  asserts the post-merge hook ran the regenerators (the divergent
 *       sentinel is gone) and that the regenerated working tree equals a fresh
 *       regenerate (idempotent self-heal).
 *
 * Requires: a clean working tree, the installer already run (driver + hooks),
 * Node + PowerShell (for the regenerate the hook triggers).
 * Always restores the original branch and deletes the scratch branches.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { GENERATED_PATTERNS } from './manifest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN_FILE = 'docs/api-inventory.json';
const SENTINEL = '_lm_selftest_divergent_marker';
const PFX = 'lm-selftest';

/** gitattributes patterns -> grep pathspecs (strip the trailing /**). */
const GEN_PATHSPECS = GENERATED_PATTERNS.map((p) => (p.endsWith('/**') ? p.slice(0, -3) : p));

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}
function gitQuiet(args: string[]): void {
  execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'ignore' });
}
function tryGit(args: string[]): void {
  try { gitQuiet(args); } catch { /* best-effort */ }
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
  if (!ok) failures.push(name);
}

function conflictMarkerCount(ref: string): number {
  try {
    const out = git(['grep', '-I', '-F', '--count', '<<<<<<<', ref, '--', ...GEN_PATHSPECS]);
    return out.trim().split('\n').filter(Boolean).reduce((n, line) => n + Number(line.split(':').pop() || 0), 0);
  } catch {
    return 0; // git grep exits 1 when there are no matches
  }
}

function main(): void {
  const status = git(['status', '--porcelain']).trim();
  if (status) {
    process.stderr.write('[selftest] working tree not clean — aborting.\n' + status + '\n');
    process.exit(2);
  }
  const orig = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const base = git(['rev-parse', 'HEAD']).trim();

  try {
    // ── branch A: divergent generated-file content ──────────────────────────
    gitQuiet(['checkout', '-b', `${PFX}/a`, base]);
    writeFileSync(join(REPO_ROOT, GEN_FILE), JSON.stringify({ [SENTINEL]: 'SIDE-A', a: true }, null, 2) + '\n');
    gitQuiet(['add', GEN_FILE]);
    gitQuiet(['commit', '-m', 'selftest: side A diverges a generated file', '--no-verify']);

    // ── branch B: a DIFFERENT divergent content (guaranteed conflict) ───────
    gitQuiet(['checkout', '-b', `${PFX}/b`, base]);
    writeFileSync(join(REPO_ROOT, GEN_FILE), JSON.stringify({ [SENTINEL]: 'SIDE-B', b: 99 }, null, 2) + '\n');
    gitQuiet(['add', GEN_FILE]);
    gitQuiet(['commit', '-m', 'selftest: side B diverges a generated file', '--no-verify']);

    // ── merge B into A (3-way; conflicts without the driver) — post-merge hook
    //    fires here and regenerates (this call blocks until the hook finishes) ─
    gitQuiet(['checkout', `${PFX}/a`]);
    let mergeExit = 0;
    try { git(['merge', '--no-edit', `${PFX}/b`]); } catch (e: any) { mergeExit = e?.status ?? 1; }
    const mergeCommit = git(['rev-parse', 'HEAD']).trim();

    // ── CHECK #2: the MERGE COMMIT has no conflict markers in generated paths ─
    check('#2 merge completed without aborting (exit 0)', mergeExit === 0, `(exit ${mergeExit})`);
    const markers = conflictMarkerCount(mergeCommit);
    check('#2 zero conflict markers in generated paths of the merge commit', markers === 0, `(found ${markers})`);
    check('#2 a true merge commit was produced (2 parents)', git(['rev-list', '--parents', '-n', '1', mergeCommit]).trim().split(/\s+/).length === 3);

    // ── CHECK #3a: the post-merge hook ran the regenerators -> sentinel regenerated away
    const afterHook = readFileSync(join(REPO_ROOT, GEN_FILE), 'utf8');
    check('#3 post-merge hook regenerated the file (divergent sentinel gone)', !afterHook.includes(SENTINEL));

    // ── CHECK #3b: hook output == a fresh regenerate (idempotent self-heal) ──
    tryGit(['add', '-A', '--', ...GEN_PATHSPECS]); // stage the hook's regenerated output as baseline
    execFileSync('node', ['scripts/living-merge/regenerate-all.mjs', '--quiet'], { cwd: REPO_ROOT, stdio: 'inherit' });
    let healed = true;
    try { gitQuiet(['diff', '--quiet', '--', ...GEN_PATHSPECS]); } catch { healed = false; }
    check('#3 generated files match a fresh regenerate (zero further diff)', healed);
  } finally {
    tryGit(['merge', '--abort']);
    tryGit(['checkout', '-f', orig]);
    tryGit(['reset', '--hard', base]);
    tryGit(['branch', '-D', `${PFX}/a`]);
    tryGit(['branch', '-D', `${PFX}/b`]);
  }

  process.stdout.write(
    failures.length === 0
      ? '\n[selftest] ALL MERGE/SELF-HEAL CHECKS PASSED\n'
      : `\n[selftest] ${failures.length} FAILED: ${failures.join(', ')}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();

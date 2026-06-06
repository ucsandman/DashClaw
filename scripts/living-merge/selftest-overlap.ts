#!/usr/bin/env node
/**
 * living-merge — automated overlap-signal e2e test (success criterion #4).
 *
 *   node --import tsx scripts/living-merge/selftest-overlap.ts
 *
 * Exercises the REAL overlap-signal hook (state-dir I/O + `git worktree list`
 * filtering + rendering) against a planted sibling-worktree state:
 *   #4a  a sibling editing an AUTHORED file this worktree also changed ->
 *        the hook emits a factual signal naming that file.
 *   #4b  a sibling editing only a GENERATED file (which this worktree is also
 *        dirtying) -> the hook stays SILENT (generated files are filtered).
 *
 * Cleans up the planted state and the temporary generated-file edit.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { stateDir, worktreeId } from './state';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTHORED = 'scripts/living-merge/manifest.ts'; // this worktree changed it vs main
const GENERATED = 'docs/api-inventory.json'; // a generated projection

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function runSignal(): string {
  try {
    return execFileSync('node', ['--import', 'tsx', 'scripts/living-merge/overlap-signal.ts'], {
      cwd: REPO_ROOT, encoding: 'utf8',
    });
  } catch (e: any) {
    return e?.stdout ?? '';
  }
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
  if (!ok) failures.push(name);
}

function main(): void {
  const remote = git(['remote', 'get-url', 'origin']);
  const dir = stateDir(remote);
  mkdirSync(dir, { recursive: true });
  const myPath = git(['rev-parse', '--show-toplevel']);
  const canon = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

  const wtPaths = git(['worktree', 'list', '--porcelain'])
    .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length).trim());
  const sibling = wtPaths.find((p) => canon(p) !== canon(myPath));
  if (!sibling) {
    process.stderr.write('[selftest-overlap] need a second registered worktree — aborting.\n');
    process.exit(2);
  }

  const siblingFile = join(dir, `${worktreeId(sibling)}.json`);
  const myStateFile = join(dir, `${worktreeId(myPath)}.json`);
  const genAbs = join(REPO_ROOT, GENERATED);
  function plant(changedFiles: string[]): void {
    writeFileSync(siblingFile, JSON.stringify({ worktreePath: sibling, branch: 'sibling-branch', changedFiles, updatedAt: 'x' }, null, 2));
  }

  try {
    // #4a — sibling shares an AUTHORED file this worktree changed -> signal.
    plant([AUTHORED, GENERATED]);
    const outA = runSignal();
    check('#4 emits a signal for a shared AUTHORED file', outA.includes(AUTHORED) && outA.includes(sibling), `(got: ${JSON.stringify(outA.slice(0, 120))})`);
    check('#4 the signal does NOT name the shared GENERATED file', !outA.includes(GENERATED));

    // #4b — both sides share ONLY a GENERATED file -> SILENT (filter works e2e).
    appendFileSync(genAbs, '\n'); // dirty the generated file so it enters this worktree's changed set
    plant([GENERATED]);
    const outB = runSignal();
    check('#4 stays SILENT when the only shared file is generated', outB.trim() === '', `(got: ${JSON.stringify(outB.trim().slice(0, 120))})`);
  } finally {
    for (const f of [siblingFile, myStateFile]) { try { if (existsSync(f)) rmSync(f); } catch { /* ignore */ } }
    try { git(['checkout', '--', GENERATED]); } catch { /* ignore */ }
  }

  process.stdout.write(
    failures.length === 0
      ? '\n[selftest-overlap] ALL OVERLAP CHECKS PASSED\n'
      : `\n[selftest-overlap] ${failures.length} FAILED: ${failures.join(', ')}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();

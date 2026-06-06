#!/usr/bin/env node
/**
 * living-merge — idempotent setup script. Run ONCE per clone/worktree:
 *
 *   node --import tsx scripts/living-merge/install.ts
 *
 * Configures the parts git/Claude can't carry in committed files:
 *   1. `merge.regenerate.driver` git config — the no-op driver that keeps the
 *      target side so `merge=regenerate` paths never produce conflict markers.
 *   2. `core.hooksPath` -> `.husky` (relative) so EACH worktree runs its own
 *      committed hooks (the repo currently pins it to an absolute path, which
 *      would make every worktree run the main checkout's hooks).
 *   3. The `.gitattributes` managed block (regenerated from manifest.ts).
 *   4. A Claude Code SessionStart hook (in the gitignored .claude/settings.json)
 *      that runs the cross-worktree overlap signal.
 *
 * Fully idempotent: a second run makes ZERO changes and reports `0 changed`.
 * `--check` reports drift without writing (exit 1 if anything would change).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { GENERATED_PATTERNS } from './manifest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK_ONLY = process.argv.includes('--check');

const MERGE_DRIVER_CMD = 'node scripts/living-merge/merge-driver.mjs %O %A %B %P';
const MERGE_DRIVER_NAME = 'living-merge: keep target side; hooks regenerate the file';
const SESSION_HOOK_CMD = 'node --import tsx "$CLAUDE_PROJECT_DIR/scripts/living-merge/overlap-signal.ts"';
const GA_BEGIN = '# >>> living-merge (managed: generated projections) >>>';
const GA_END = '# <<< living-merge <<<';

let changed = 0;
const report: string[] = [];
function note(action: 'set' | 'already' | 'would-set', what: string): void {
  if (action !== 'already') changed++;
  report.push(`  [${action === 'already' ? 'ok ' : action === 'would-set' ? 'drift' : 'set'}] ${what}`);
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
function gitSet(key: string, value: string): void {
  if (CHECK_ONLY) return;
  execFileSync('git', ['config', key, value], { cwd: REPO_ROOT, stdio: 'ignore' });
}

// 1 + 2 — git config -------------------------------------------------------
function ensureGitConfig(key: string, value: string, label: string): void {
  const current = git(['config', '--get', key]);
  if (current === value) return note('already', label);
  note(CHECK_ONLY ? 'would-set' : 'set', `${label} (${current ? `was '${current}'` : 'was unset'} -> '${value}')`);
  gitSet(key, value);
}

// 3 — .gitattributes managed block ----------------------------------------
function desiredGitAttributesBlock(): string {
  const lines = [
    GA_BEGIN,
    '# Generated from scripts/living-merge/manifest.ts — do not edit by hand.',
    '# These paths are projections of source: never hand-merged, always regenerated.',
    ...GENERATED_PATTERNS.map((p) => `${p} merge=regenerate`),
    GA_END,
  ];
  return lines.join('\n');
}
function ensureGitAttributes(): void {
  const file = join(REPO_ROOT, '.gitattributes');
  const desired = desiredGitAttributesBlock();
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const blockRe = new RegExp(`${escapeRe(GA_BEGIN)}[\\s\\S]*?${escapeRe(GA_END)}`);
  let next: string;
  if (blockRe.test(existing)) {
    next = existing.replace(blockRe, desired);
  } else {
    next = (existing.trimEnd() + (existing.trim() ? '\n\n' : '') + desired + '\n').replace(/^\n+/, '');
  }
  if (next === existing) return note('already', '.gitattributes managed block');
  note(CHECK_ONLY ? 'would-set' : 'set', '.gitattributes managed block');
  if (!CHECK_ONLY) writeFileSync(file, next);
}

// 4 — SessionStart hook in .claude/settings.json ---------------------------
function ensureSessionHook(): void {
  const dir = join(REPO_ROOT, '.claude');
  const file = join(dir, 'settings.json');
  let settings: any = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // Never clobber an existing settings.json we can't parse — that would
      // silently destroy the user's other hooks. Abort loudly instead.
      process.stderr.write(`[living-merge] ${file} is not valid JSON — fix it before running install (refusing to overwrite).\n`);
      process.exit(1);
    }
  }
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  const groups: any[] = settings.hooks.SessionStart;
  const already = groups.some((g) =>
    Array.isArray(g?.hooks) && g.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes('living-merge/overlap-signal')),
  );
  if (already) return note('already', 'SessionStart overlap-signal hook (.claude/settings.json)');
  note(CHECK_ONLY ? 'would-set' : 'set', 'SessionStart overlap-signal hook (.claude/settings.json)');
  if (CHECK_ONLY) return;
  groups.push({ hooks: [{ type: 'command', command: SESSION_HOOK_CMD }] });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main(): void {
  if (!git(['rev-parse', '--git-dir'])) {
    process.stderr.write('[living-merge] not a git repository — aborting.\n');
    process.exit(1);
  }
  process.stdout.write(`[living-merge] ${CHECK_ONLY ? 'checking' : 'installing'} (repo: ${REPO_ROOT})\n`);
  ensureGitConfig('merge.regenerate.name', MERGE_DRIVER_NAME, 'merge.regenerate.name');
  ensureGitConfig('merge.regenerate.driver', MERGE_DRIVER_CMD, 'merge.regenerate.driver');
  ensureGitConfig('core.hooksPath', '.husky', 'core.hooksPath -> .husky (per-worktree hooks)');
  ensureGitAttributes();
  ensureSessionHook();
  process.stdout.write(report.join('\n') + '\n');
  process.stdout.write(`[living-merge] ${changed} changed.\n`);
  if (CHECK_ONLY && changed > 0) process.exit(1);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * Refresh the hand-authored download bundles and their plugin mirrors.
 *
 * Run manually: `npm run bundles:refresh`
 * Run automatically: pre-commit hook (via scripts/lib/run-pre-commit-checks.mjs)
 *
 * Outputs:
 *   - public/downloads/dashclaw-governance.zip                 (hand-authored skill, zipped)
 *   - public/downloads/dashclaw-governance-plugin.zip          (full plugin bundle — Claude
 *                                                               Code / Codex / Hermes manifests,
 *                                                               MCP configs, mirrored skills)
 *   - public/downloads/dashclaw-claude-code-hooks.zip          (PreToolUse / PostToolUse / Stop
 *                                                               hooks + dashclaw_agent_intel/ —
 *                                                               drop into .claude/hooks/)
 *   - plugins/dashclaw/skills/dashclaw-governance/             (mirror of the canonical skill)
 *   - plugins/dashclaw/hooks/*.py + dashclaw_agent_intel/      (mirror of canonical hooks/)
 *
 * Everything here is hand-authored source being mirrored/zipped — nothing is
 * generated from code analysis. (The livingcode organism that used to share
 * this script was retired in v5.3.0.)
 *
 * Idempotence: each zip is only rebuilt when the directory hash disagrees
 * with the committed `.manifest` sibling, so git doesn't churn on re-runs.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
// dashclaw-governance is hand-authored; the directory is the source of truth
// and this script keeps the zip fresh against directory contents.
const GOVERNANCE_SKILL_DIR = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-governance');
const GOVERNANCE_SKILL_ZIP = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-governance.zip');
const GOVERNANCE_SKILL_MANIFEST = `${GOVERNANCE_SKILL_ZIP}.manifest`;
// Plugin bundle — the full plugins/dashclaw/ tree (three plugin manifests for
// Claude Code / Codex / Hermes, MCP configs, mirrored skills, assets). Zipped
// for ClawHub / direct distribution so users don't need to clone the whole
// repo to install the plugin.
const PLUGIN_BUNDLE_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw');
const PLUGIN_BUNDLE_ZIP = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-governance-plugin.zip');
const PLUGIN_BUNDLE_MANIFEST = `${PLUGIN_BUNDLE_ZIP}.manifest`;
// Hooks bundle — Claude Code PreToolUse / PostToolUse / Stop hooks plus the
// dashclaw_agent_intel/ tool-classification module. Drops into .claude/hooks/.
const HOOKS_BUNDLE_DIR = resolve(REPO_ROOT, 'hooks');
const HOOKS_BUNDLE_ZIP = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-claude-code-hooks.zip');
const HOOKS_BUNDLE_MANIFEST = `${HOOKS_BUNDLE_ZIP}.manifest`;
// Exclude patterns for the hooks bundle — Python's __pycache__ and pytest's
// .pytest_cache rewrite themselves on every test run, which would otherwise
// thrash the bundle hash and re-zip on every refresh.
const BUNDLE_EXCLUDE_RE = /(^|[\\/])(__pycache__|\.pytest_cache)([\\/]|$)/;
// Governance skill plugin mirror — hand-authored source lives under
// public/downloads/dashclaw-governance/ (canonical). The plugin copy is kept
// in lockstep so the committed plugin distribution always carries the latest
// governance protocol text.
const PLUGIN_GOVERNANCE_SKILL_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw', 'skills', 'dashclaw-governance');
// Plugin hooks mirror — the canonical Claude Code hook scripts live in
// hooks/ (HOOKS_BUNDLE_DIR). The plugin ships firing governance hooks
// (PreToolUse / PostToolUse / Stop) via plugins/dashclaw/hooks/, so the six
// .py scripts plus the dashclaw_agent_intel/ module are mirrored from the
// canonical source here on every refresh. The authored hooks.json (which
// references ${CLAUDE_PLUGIN_ROOT}) is NOT generated — it's left untouched.
const PLUGIN_HOOKS_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw', 'hooks');
const PLUGIN_HOOK_SCRIPTS = [
  'dashclaw_pretool.py',
  'dashclaw_posttool.py',
  'dashclaw_stop.py',
  'dashclaw_db_containment.py',
  'enforcement_liveness_probe.py',
  'dashclaw_scope_sync.py',
];

// Source file patterns that imply a bundle may have changed. If pre-commit
// (--if-staged) sees none of these staged, it skips the refresh.
const SOURCE_PATH_RE = /^(public\/downloads\/dashclaw-governance\/|plugins\/dashclaw\/(\.claude-plugin|\.codex-plugin|\.hermes-plugin|assets|\.mcp\.json$|\.mcp-claude\.json$|PLUGIN_PARITY\.md$)|hooks\/(?!\.pytest_cache|__pycache__))/;
// Paths that are themselves generated output — staging these doesn't count as
// a source change that should trigger a refresh.
const GENERATED_PATH_RE = /^(public\/downloads\/dashclaw-governance\.zip(\.manifest)?$|public\/downloads\/dashclaw-governance-plugin\.zip(\.manifest)?$|public\/downloads\/dashclaw-claude-code-hooks\.zip(\.manifest)?$|plugins\/dashclaw\/skills\/dashclaw-governance\/)/;

function isSourceChange(path) {
  const normalised = path.replace(/\\/g, '/');
  if (GENERATED_PATH_RE.test(normalised)) return false;
  return SOURCE_PATH_RE.test(normalised);
}

function log(msg) {
  process.stdout.write(`[bundles] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[bundles] WARN: ${msg}\n`);
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function writeIfChanged(path, content, label) {
  ensureDir(dirname(path));
  if (existsSync(path) && readFileSync(path, 'utf8') === content) {
    log(`${label} unchanged`);
    return false;
  }
  writeFileSync(path, content, 'utf8');
  log(`${label} -> ${relative(REPO_ROOT, path)}`);
  return true;
}

/**
 * Mirror a source subdirectory into a destination dir, using writeIfChanged
 * per file so the output is idempotent. Removes stale files in the destination
 * that no longer exist in the source.
 */
function mirrorSubdir(srcRoot, dstRoot, subdir, label, excludeRe = null) {
  const src = join(srcRoot, subdir);
  const dst = join(dstRoot, subdir);
  if (!existsSync(src)) return;

  try {
    ensureDir(dst);
  } catch (err) {
    warn(`could not create ${label} dir (${err.message})`);
    return;
  }

  const srcFiles = new Set();
  const walk = (relative_ = '') => {
    const current = relative_ ? join(src, relative_) : src;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relative_ ? join(relative_, entry.name) : entry.name;
      if (excludeRe && excludeRe.test(rel)) continue;
      const srcPath = join(src, rel);
      const dstPath = join(dst, rel);
      if (entry.isDirectory()) {
        ensureDir(dstPath);
        walk(rel);
      } else if (entry.isFile()) {
        srcFiles.add(rel);
        const content = readFileSync(srcPath, 'utf8');
        writeIfChanged(dstPath, content, `${label}/${rel.replace(/\\/g, '/')}`);
      }
    }
  };

  try {
    walk();
  } catch (err) {
    warn(`could not mirror ${label} (${err.message})`);
    return;
  }

  // Remove destination files that no longer exist in source.
  const prune = (relative_ = '') => {
    const current = relative_ ? join(dst, relative_) : dst;
    if (!existsSync(current)) return;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relative_ ? join(relative_, entry.name) : entry.name;
      const dstPath = join(dst, rel);
      if (entry.isDirectory()) {
        prune(rel);
      } else if (entry.isFile() && !srcFiles.has(rel)) {
        rmSync(dstPath, { force: true });
        log(`${label}/${rel.replace(/\\/g, '/')} removed (no longer in source)`);
      }
    }
  };
  prune();
}

function hashDirectory(dir, excludeRe = null) {
  const hash = createHash('sha256');
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = relative(dir, full);
      if (excludeRe && excludeRe.test(rel)) continue;
      if (entry.isDirectory()) {
        hash.update(`D|${rel}\n`);
        walk(full);
      } else if (entry.isFile()) {
        hash.update(`F|${rel}|${statSync(full).size}\n`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function readManifest(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Stage a source directory's contents (minus excluded paths) into a temp dir.
 * Used when the bundle has paths we don't want in the zip (e.g. Python
 * __pycache__) — the non-Windows `zip` command has no native exclude flag,
 * so we copy the filtered tree first and zip the copy (one code path for
 * both platforms rather than a bsdtar-only `--exclude`). Returns the staged
 * dir path.
 */
function stageFiltered(srcDir, excludeRe) {
  const stagingRoot = join(tmpdir(), `dashclaw-bundle-${process.pid}-${Date.now()}`);
  const name = srcDir.split(/[\\/]/).pop();
  const stagingDir = join(stagingRoot, name);
  rmSync(stagingRoot, { recursive: true, force: true });
  ensureDir(stagingDir);

  const walk = (current, relPath = '') => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relPath ? join(relPath, entry.name) : entry.name;
      if (excludeRe && excludeRe.test(rel)) continue;
      const src = join(current, entry.name);
      const dst = join(stagingDir, rel);
      if (entry.isDirectory()) {
        ensureDir(dst);
        walk(src, rel);
      } else if (entry.isFile()) {
        ensureDir(dirname(dst));
        copyFileSync(src, dst);
      }
    }
  };
  walk(srcDir);
  return { stagingRoot, stagingDir };
}

/**
 * Count plain files (not directories) under a tree. Used to assert a built
 * zip's file-entry count against what was actually staged for it — `dir` is
 * always the already-filtered tree (`toZip`), so no excludeRe is needed here.
 */
function countFiles(dir) {
  let count = 0;
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  };
  walk(dir);
  return count;
}

/**
 * List a zip's entry names by reading its central directory directly —
 * dependency-free and platform-uniform. bsdtar's `-tf` listing NORMALIZES
 * backslash entry names to forward slashes on the way out, so shelling out to
 * it here would make the backslash-entry regression guard below unable to
 * ever observe the bug it exists to catch (bsdtar reads the raw entry bytes
 * fine — it's only the *display* that's normalized). Reading the central
 * directory's raw name bytes avoids that normalization and also drops the
 * `unzip` binary dependency the non-Windows branch previously introduced.
 */
function listZipEntries(zipPath) {
  const buf = readFileSync(zipPath);
  const names = [];
  for (let o = 0; o + 46 <= buf.length; o += 1) {
    if (buf.readUInt32LE(o) !== 0x02014b50) continue;
    names.push(buf.toString('utf8', o + 46, o + 46 + buf.readUInt16LE(o + 28)));
  }
  return names;
}

/**
 * Rebuild a bundle zip only when the directory hash disagrees with the
 * manifest. The manifest is committed alongside the zip so re-runs stay
 * idempotent — the zip format embeds timestamps, so naive re-packaging would
 * produce a byte-different archive every invocation.
 *
 * When `excludeRe` is set, paths matching it are dropped from BOTH the hash
 * and the zip — staging happens into a temp dir first because the non-Windows
 * `zip` command has no native exclude flag.
 *
 * @param {string} srcDir       Source directory to package
 * @param {string} zipPath      Output zip path
 * @param {string} manifestPath Sibling `.manifest` JSON path (idempotence marker)
 * @param {RegExp|null} excludeRe Optional path-relative regex of files to skip
 */
function refreshBundleZip(srcDir, zipPath, manifestPath, excludeRe = null) {
  if (!existsSync(srcDir)) {
    warn(`bundle dir missing, cannot zip: ${srcDir}`);
    return;
  }

  const hash = hashDirectory(srcDir, excludeRe);
  const manifest = readManifest(manifestPath);
  if (manifest && manifest.hash === hash && existsSync(zipPath)) {
    log(`zip unchanged (hash ${hash.slice(0, 12)}…) -> ${relative(REPO_ROOT, zipPath)}`);
    return;
  }

  let toZip = srcDir;
  let cleanup = null;
  if (excludeRe) {
    const { stagingRoot, stagingDir } = stageFiltered(srcDir, excludeRe);
    toZip = stagingDir;
    cleanup = stagingRoot;
  }

  // Build to a temp file and only swap it into place on a verified, non-empty,
  // structurally-correct success. The old behaviour deleted the destination
  // zip FIRST, so any build failure left a 0-byte/corrupt artifact committed.
  const tmpZip = zipPath.replace(/\.zip$/, '') + '.tmp.zip';
  rmSync(tmpZip, { force: true });

  const isWindows = platform() === 'win32';
  // bsdtar (Windows' own System32/tar.exe), not PowerShell's Compress-Archive.
  // Compress-Archive emitted backslash-separated entry names — corrupt for
  // any unzip tool expecting POSIX paths — and dragged in whatever cruft
  // (e.g. __pycache__) sat in the source tree it was pointed at, since it has
  // no exclude flag of its own (see ERRORS.md). It also silently exited 0 on
  // a locked source file via a non-terminating error. bsdtar always writes
  // forward-slash entries and fails loudly on error, so both defects are
  // fixed at the source rather than papered over. Args are relative to
  // REPO_ROOT (via cwd), which keeps `drive:` colons out of the tar command
  // as long as os.tmpdir() and the repo share a drive — bsdtar itself
  // accepts absolute paths fine, so a tmpdir on another drive is not a
  // correctness problem, just outside what the relative form covers. The
  // same relative approach is already proven in scripts/build-desktop-plugin.mjs.
  const tarBin = isWindows
    ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : null;
  let status;
  if (isWindows) {
    const relParent = relative(REPO_ROOT, dirname(toZip)) || '.';
    const name = toZip.split(/[\\/]/).pop();
    const relTmpZip = relative(REPO_ROOT, tmpZip);
    const result = spawnSync(tarBin, ['-a', '-cf', relTmpZip, '-C', relParent, name], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    status = result.status;
  } else {
    const parent = dirname(toZip);
    const name = toZip.split(/[\\/]/).pop();
    const result = spawnSync('zip', ['-r', tmpZip, name], {
      cwd: parent,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    status = result.status;
  }

  // A locked source (or any zip failure) must NOT clobber the existing zip.
  if (status !== 0 || !existsSync(tmpZip) || statSync(tmpZip).size === 0) {
    if (cleanup) rmSync(cleanup, { recursive: true, force: true });
    rmSync(tmpZip, { force: true });
    warn(
      `zip build failed for ${relative(REPO_ROOT, zipPath)} — keeping the existing artifact. ` +
        'A source file is likely locked by another process (close any app holding the skill’s SKILL.md open).',
    );
    return;
  }

  // Post-build assertion: the zip's file-entry count must equal the filtered
  // source file count, and no entry name may contain a backslash. This is
  // the regression guard for the corruption class fixed above — a mismatch
  // here means a backslash-entry or extra-file bug slipped back in, on any
  // platform, before the artifact ever reaches disk. Counted BEFORE cleanup
  // wipes the staging dir, since `toZip` lives inside it when excludeRe is set.
  const sourceFileCount = countFiles(toZip);
  const entries = listZipEntries(tmpZip);
  const fileEntries = entries.filter((entry) => !entry.endsWith('/'));
  const backslashCount = entries.filter((entry) => entry.includes('\\')).length;
  log(
    `bundle assertion (${relative(REPO_ROOT, zipPath)}): entries=${fileEntries.length} sourceFiles=${sourceFileCount} backslashEntries=${backslashCount}`,
  );
  if (fileEntries.length !== sourceFileCount || backslashCount > 0) {
    if (cleanup) rmSync(cleanup, { recursive: true, force: true });
    rmSync(tmpZip, { force: true });
    throw new Error(
      `bundle assertion failed for ${relative(REPO_ROOT, zipPath)}: entries=${fileEntries.length} sourceFiles=${sourceFileCount} backslashEntries=${backslashCount}`,
    );
  }

  if (cleanup) rmSync(cleanup, { recursive: true, force: true });

  rmSync(zipPath, { force: true });
  renameSync(tmpZip, zipPath);

  writeFileSync(
    manifestPath,
    JSON.stringify({ hash, generatedBy: 'refresh-bundles' }, null, 2) + '\n',
    'utf8',
  );
  log(`zip -> ${relative(REPO_ROOT, zipPath)} (manifest updated)`);
}

function stagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function hasRelevantStagedFiles() {
  return stagedFiles().some(isSourceChange);
}

// Every artifact this script owns, derived from the consts above so the list
// can't drift from what actually gets written.
function bundleArtifactPaths() {
  return [
    GOVERNANCE_SKILL_ZIP,
    GOVERNANCE_SKILL_MANIFEST,
    PLUGIN_BUNDLE_ZIP,
    PLUGIN_BUNDLE_MANIFEST,
    HOOKS_BUNDLE_ZIP,
    HOOKS_BUNDLE_MANIFEST,
    PLUGIN_GOVERNANCE_SKILL_DIR,
    ...PLUGIN_HOOK_SCRIPTS.map((script) => join(PLUGIN_HOOKS_DIR, script)),
    join(PLUGIN_HOOKS_DIR, 'dashclaw_agent_intel'),
  ].map((path) => relative(REPO_ROOT, path).replace(/\\/g, '/'));
}

// Stage the artifacts, but ONLY in --if-staged (pre-commit) mode and only
// once we know a bundle SOURCE is staged in this commit.
//
// The predicate is deliberately "is this artifact's source part of this
// commit", NOT "did this process just rewrite the file". Those differ, and the
// difference is the whole bug:
//
//   - Staging on "I wrote it" reintroduces commit 1eaff4c5 (stale zips on
//     origin): a human who runs `npm run bundles:refresh` by hand leaves the
//     artifacts correct-but-unstaged, so the hook's own refresh is a no-op,
//     writes nothing, stages nothing, and the commit ships the old zip.
//   - Staging unconditionally is what this replaced: dirty artifacts from a
//     hand-run got swept into whichever unrelated commit happened to run
//     first.
//
// Source-staged is right for both. `git add` on a file identical to HEAD is a
// no-op, so the coarse list never manufactures a diff.
function stageBundleArtifacts() {
  const paths = bundleArtifactPaths().filter((path) => existsSync(resolve(REPO_ROOT, path)));
  if (paths.length === 0) return;

  const result = spawnSync('git', ['add', '--', ...paths], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`git add failed for bundle artifacts (exit ${result.status})`);
  }
  log(`staged ${paths.length} bundle artifact path(s)`);
}

async function main() {
  const ifStaged = process.argv.includes('--if-staged');
  if (ifStaged && !hasRelevantStagedFiles()) {
    log('no staged changes affect bundles — skipping refresh');
    return;
  }

  log(`refreshing download bundles (cwd=${REPO_ROOT})`);

  // Mirror dashclaw-governance to plugins/ so the plugin distribution always
  // carries the latest governance protocol text. Failures ARE surfaced
  // because the plugin copy is committed — drift here would land in users'
  // installs.
  if (existsSync(GOVERNANCE_SKILL_DIR)) {
    const govSkillContent = readFileSync(join(GOVERNANCE_SKILL_DIR, 'SKILL.md'), 'utf8');
    writeIfChanged(
      join(PLUGIN_GOVERNANCE_SKILL_DIR, 'SKILL.md'),
      govSkillContent,
      'governance-skill (plugin)',
    );
    mirrorSubdir(
      GOVERNANCE_SKILL_DIR,
      PLUGIN_GOVERNANCE_SKILL_DIR,
      'references',
      'governance-references (plugin)',
    );
  }

  // Mirror the canonical Claude Code hook scripts into the plugin so the
  // committed plugin distribution ships firing governance hooks. The four
  // top-level .py scripts and the dashclaw_agent_intel/ module are copied
  // from hooks/ (the source of truth); the authored hooks.json is left
  // untouched.
  if (existsSync(HOOKS_BUNDLE_DIR)) {
    ensureDir(PLUGIN_HOOKS_DIR);
    for (const script of PLUGIN_HOOK_SCRIPTS) {
      const src = join(HOOKS_BUNDLE_DIR, script);
      if (existsSync(src)) {
        writeIfChanged(join(PLUGIN_HOOKS_DIR, script), readFileSync(src, 'utf8'), `hook (plugin)/${script}`);
      }
    }
    mirrorSubdir(HOOKS_BUNDLE_DIR, PLUGIN_HOOKS_DIR, 'dashclaw_agent_intel', 'hook-agent-intel (plugin)', BUNDLE_EXCLUDE_RE);
  }

  // Zip the hand-authored governance skill so the /docs and /downloads
  // download links resolve. Hash-vs-manifest idempotent — only rebuilds when
  // the directory contents actually changed.
  if (existsSync(GOVERNANCE_SKILL_DIR)) {
    refreshBundleZip(GOVERNANCE_SKILL_DIR, GOVERNANCE_SKILL_ZIP, GOVERNANCE_SKILL_MANIFEST);
  }

  // Plugin bundle — the entire plugins/dashclaw/ tree as a single uploadable
  // artifact for ClawHub / direct distribution. Includes the mirrored skill,
  // so this MUST run after the skill mirroring above to capture the latest
  // SKILL.md content. Excludes __pycache__/.pytest_cache: mirrorSubdir already
  // keeps those out of the *mirrored* hook scripts, but plugins/dashclaw/hooks/
  // is a real directory a developer can run pytest against directly, which
  // regenerates __pycache__ there independent of any mirror step.
  refreshBundleZip(PLUGIN_BUNDLE_DIR, PLUGIN_BUNDLE_ZIP, PLUGIN_BUNDLE_MANIFEST, BUNDLE_EXCLUDE_RE);

  // Claude Code hooks bundle — drops into .claude/hooks/. Excludes
  // __pycache__ and .pytest_cache so the bundle hash is stable across test
  // runs (otherwise every `pytest` invocation would trigger a zip rebuild).
  if (existsSync(HOOKS_BUNDLE_DIR)) {
    refreshBundleZip(HOOKS_BUNDLE_DIR, HOOKS_BUNDLE_ZIP, HOOKS_BUNDLE_MANIFEST, BUNDLE_EXCLUDE_RE);
  }

  // Pre-commit only. A manual `npm run bundles:refresh` must never touch the
  // index — the human decides what goes in their commit.
  if (ifStaged) {
    stageBundleArtifacts();
  }

  log('refresh complete');
}

main().catch((err) => {
  console.error(`[bundles] refresh failed: ${err.message}`);
  process.exit(1);
});

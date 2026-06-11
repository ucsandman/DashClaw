#!/usr/bin/env node
/**
 * Refresh all derivative artifacts from the livingcode shape model.
 *
 * Run manually: `npm run livingcode:refresh`
 * Run automatically: pre-commit hook (via scripts/lib/run-pre-commit-checks.mjs)
 *
 * Outputs:
 *   - app/lib/doctor/generated/shape.json            (committed, JS reads at runtime)
 *   - app/lib/doctor/generated/last-snapshot.json    (drift-check baseline)
 *   - app/lib/doctor/generated/checks-from-shape.mjs (generated doctor checks)
 *   - mcp-server/lib/routes-inventory.generated.json
 *   - public/downloads/dashclaw-platform-intelligence/SKILL.md (website — source of truth)
 *   - public/downloads/dashclaw-platform-intelligence.zip      (website download)
 *   - public/downloads/dashclaw-platform-intelligence.zip.manifest (zip-idempotence marker)
 *   - public/downloads/dashclaw-governance.zip                 (hand-authored skill, zipped)
 *   - public/downloads/dashclaw-governance-plugin.zip          (full plugin bundle — Claude
 *                                                               Code / Codex / Hermes manifests,
 *                                                               MCP configs, mirrored skills)
 *   - public/downloads/dashclaw-claude-code-hooks.zip          (PreToolUse / PostToolUse / Stop
 *                                                               hooks + dashclaw_agent_intel/ —
 *                                                               drop into .claude/hooks/)
 *   - ${USERPROFILE}/.claude/skills/dashclaw-platform-intelligence/   (global Claude Code skill)
 *   - .claude/skills/dashclaw-platform-intelligence/                   (project-local, gitignored)
 *   - plugins/dashclaw/skills/dashclaw-platform-intelligence/          (committed plugin distribution)
 *
 * The website copy is the source of truth. Global, project-local, and plugin
 * copies mirror SKILL.md + references/ + scripts/ via mirrorSubdir
 * (idempotent, prunes deleted files). The plugin copy is committed so users
 * installing the DashClaw plugin from this repo get the latest skill content
 * without a separate publish step.
 *
 * Zero new npm deps — relies on Python being on PATH (livingcode) and Node stdlib.
 * Production reads only the committed JSON, so Vercel never needs Python.
 *
 * Idempotence:
 *   - shape.json emitter substitutes a content-hash signature for the
 *     wall-clock timestamp, so re-runs produce byte-identical JSON.
 *   - SKILL.md gets the same signature spliced in place of its live timestamp.
 *   - The zip is only regenerated when the manifest hash disagrees with the
 *     skill directory contents, so git doesn't churn on every refresh.
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
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const GENERATED_DIR = resolve(REPO_ROOT, 'app', 'lib', 'doctor', 'generated');
const WEBSITE_SKILL_DIR = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-platform-intelligence');
const WEBSITE_SKILL_ZIP = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-platform-intelligence.zip');
const WEBSITE_SKILL_MANIFEST = `${WEBSITE_SKILL_ZIP}.manifest`;
// dashclaw-governance is hand-authored (not livingcode-generated) but still
// gets zipped here so /docs and /downloads have a working download link. The
// directory itself is the source of truth; this just keeps the zip fresh
// against directory contents via hash-vs-manifest comparison.
const GOVERNANCE_SKILL_DIR = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-governance');
const GOVERNANCE_SKILL_ZIP = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-governance.zip');
const GOVERNANCE_SKILL_MANIFEST = `${GOVERNANCE_SKILL_ZIP}.manifest`;
// Plugin bundle — the full plugins/dashclaw/ tree (three plugin manifests for
// Claude Code / Codex / Hermes, MCP configs, mirrored skills, assets). Zipped
// for ClawHub / direct distribution so users don't need to clone the whole
// repo to install the plugin. Hash-vs-manifest idempotent like the skill zips.
const PLUGIN_BUNDLE_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw');
const PLUGIN_BUNDLE_ZIP = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-governance-plugin.zip');
const PLUGIN_BUNDLE_MANIFEST = `${PLUGIN_BUNDLE_ZIP}.manifest`;
// Hooks bundle — Claude Code PreToolUse / PostToolUse / Stop hooks plus the
// dashclaw_agent_intel/ tool-classification module. Drops into .claude/hooks/.
// Excludes Python bytecode and pytest caches so the bundle is reproducible.
const HOOKS_BUNDLE_DIR = resolve(REPO_ROOT, 'hooks');
const HOOKS_BUNDLE_ZIP = resolve(REPO_ROOT, 'public', 'downloads', 'dashclaw-claude-code-hooks.zip');
const HOOKS_BUNDLE_MANIFEST = `${HOOKS_BUNDLE_ZIP}.manifest`;
// Exclude patterns for the hooks bundle — Python's __pycache__ and pytest's
// .pytest_cache rewrite themselves on every test run, which would otherwise
// thrash the bundle hash and re-zip on every refresh.
const BUNDLE_EXCLUDE_RE = /(^|[\\/])(__pycache__|\.pytest_cache)([\\/]|$)/;
const GLOBAL_SKILL_DIR = resolve(homedir(), '.claude', 'skills', 'dashclaw-platform-intelligence');
// Project-local skill dir. `.claude/` is gitignored at the repo level, so this
// stays on the developer's machine — it's the in-repo Claude Code skill that
// auto-loads when working in this project. Kept in sync with the website copy
// (public/downloads/...) which is the source of truth.
const PROJECT_SKILL_DIR = resolve(REPO_ROOT, '.claude', 'skills', 'dashclaw-platform-intelligence');
// Plugin distribution skill dir. Committed alongside the rest of the
// plugins/dashclaw/ tree so `dashclaw install` / `hermes plugin install`
// pick up the live livingcode-derived SKILL.md and companion files. Treated
// as a regen target — never edit by hand; edit the website source instead.
const PLUGIN_SKILL_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw', 'skills', 'dashclaw-platform-intelligence');
// Governance skill plugin mirror — hand-authored source lives under
// public/downloads/dashclaw-governance/ (treated as canonical). The plugin
// copy is kept in lockstep so the committed plugin distribution always
// carries the latest governance protocol text.
const PLUGIN_GOVERNANCE_SKILL_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw', 'skills', 'dashclaw-governance');
// Plugin hooks mirror — the canonical Claude Code hook scripts live in
// hooks/ (HOOKS_BUNDLE_DIR). The plugin now ships firing governance hooks
// (PreToolUse / PostToolUse / Stop) via plugins/dashclaw/hooks/, so the four
// .py scripts plus the dashclaw_agent_intel/ module are mirrored from the
// canonical source here on every refresh. The authored hooks.json (which
// references ${CLAUDE_PLUGIN_ROOT}) is NOT generated — it's left untouched.
const PLUGIN_HOOKS_DIR = resolve(REPO_ROOT, 'plugins', 'dashclaw', 'hooks');
const PLUGIN_HOOK_SCRIPTS = [
  'dashclaw_pretool.py',
  'dashclaw_posttool.py',
  'dashclaw_stop.py',
  'dashclaw_code_session_reporter.py',
  'dashclaw_session_digest.py',
];
const MCP_INVENTORY_PATH = resolve(REPO_ROOT, 'mcp-server', 'lib', 'routes-inventory.generated.json');
const DASHBOARD_PATH = resolve(REPO_ROOT, 'public', 'livingcode', 'index.html');

const PY = process.env.PYTHON || 'python';
const SKILL_TIMESTAMP_LINE = /^(\*\*Shape snapshot:\*\*\s+`)[^`]+(`)/m;
const DASHBOARD_SIG_LINE = /^(<div class="sig" id="sig">Shape signature: )([^<]+)(<\/div>)/m;

// Source file patterns that imply a generated artifact may have changed. If
// pre-commit (--if-staged) sees none of these staged, it skips the refresh.
// Hand-authored bundle sources count as source too: edits under
// `plugins/dashclaw/` (manifests, MCP configs, assets) or `hooks/` (the Python
// pretool/posttool/stop scripts) re-trigger a refresh so the bundle zips stay
// in sync. We deliberately do NOT include `plugins/dashclaw/skills/` here —
// the skill mirrors under that path are themselves generated output and live
// in GENERATED_PATH_RE below.
const SOURCE_PATH_RE = /^(app\/api\/|app\/lib\/|schema\/schema\.js$|middleware\.js$|livingcode\/|public\/downloads\/dashclaw-platform-intelligence\/(references|scripts)\/|public\/downloads\/dashclaw-governance\/|plugins\/dashclaw\/(\.claude-plugin|\.codex-plugin|\.hermes-plugin|assets|\.mcp\.json$|\.mcp-claude\.json$|PLUGIN_PARITY\.md$)|hooks\/(?!\.pytest_cache|__pycache__))/;
// Paths that are themselves generated output — staging these doesn't count as
// a source change that should trigger a refresh.
const GENERATED_PATH_RE = /^(app\/lib\/doctor\/generated\/|public\/downloads\/dashclaw-platform-intelligence\/SKILL\.md$|public\/downloads\/dashclaw-platform-intelligence\.zip(\.manifest)?$|public\/downloads\/dashclaw-governance\.zip(\.manifest)?$|public\/downloads\/dashclaw-governance-plugin\.zip(\.manifest)?$|public\/downloads\/dashclaw-claude-code-hooks\.zip(\.manifest)?$|plugins\/dashclaw\/skills\/dashclaw-platform-intelligence\/|plugins\/dashclaw\/skills\/dashclaw-governance\/)/;

function isSourceChange(path) {
  const normalised = path.replace(/\\/g, '/');
  if (GENERATED_PATH_RE.test(normalised)) return false;
  return SOURCE_PATH_RE.test(normalised);
}

function log(msg) {
  process.stdout.write(`[livingcode] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[livingcode] WARN: ${msg}\n`);
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function runPython(args, { cwd = REPO_ROOT } = {}) {
  const result = spawnSync(PY, ['-m', 'livingcode', ...args], {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`livingcode ${args.join(' ')} exited with code ${result.status}`);
  }
}

function emitShapeJson() {
  ensureDir(GENERATED_DIR);
  const out = join(GENERATED_DIR, 'shape.json');
  runPython(['emit', 'shape-json', '--output', out]);
  log(`shape.json -> ${relative(REPO_ROOT, out)}`);
  return out;
}

function emitDoctorChecks() {
  ensureDir(GENERATED_DIR);
  const out = join(GENERATED_DIR, 'checks-from-shape.mjs');
  runPython(['emit', 'doctor-checks', '--output', out]);
  log(`checks-from-shape.mjs -> ${relative(REPO_ROOT, out)}`);
  return out;
}

function emitMcpInventory() {
  // mcp-server/ is optional; only emit if the directory exists.
  const mcpDir = dirname(MCP_INVENTORY_PATH);
  if (!existsSync(mcpDir)) {
    log('mcp-server/ absent — skipping MCP inventory');
    return null;
  }
  runPython(['emit', 'mcp-tools', '--output', MCP_INVENTORY_PATH]);
  log(`routes-inventory.generated.json -> ${relative(REPO_ROOT, MCP_INVENTORY_PATH)}`);
  return MCP_INVENTORY_PATH;
}

function emitDashboard(signature) {
  ensureDir(dirname(DASHBOARD_PATH));
  const tempOut = join(tmpdir(), `dashclaw-dashboard-${process.pid}.html`);
  runPython(['emit', 'dashboard', '--with-context', '--output', tempOut]);
  const raw = readFileSync(tempOut, 'utf8');
  rmSync(tempOut, { force: true });
  const normalised = raw.replace(DASHBOARD_SIG_LINE, `$1${signature} · signature-stable$3`);
  if (normalised === raw) {
    warn('dashboard emitter output did not match expected signature line — dashboard may be non-idempotent');
  }
  writeIfChanged(DASHBOARD_PATH, normalised, 'dashboard');
  return DASHBOARD_PATH;
}

function writeLastSnapshot(shapeJsonPath) {
  const out = join(GENERATED_DIR, 'last-snapshot.json');
  copyFileSync(shapeJsonPath, out);
  log(`last-snapshot.json -> ${relative(REPO_ROOT, out)}`);
  return out;
}

function loadShapeSignature(shapeJsonPath) {
  const parsed = JSON.parse(readFileSync(shapeJsonPath, 'utf8'));
  if (typeof parsed.timestamp !== 'string' || parsed.timestamp.length === 0) {
    throw new Error('shape.json is missing a timestamp/signature');
  }
  return parsed.timestamp;
}

/**
 * Emit the livingcode skill and splice in the content-hash signature so the
 * output is byte-identical across runs with unchanged source.
 */
function emitSkill(signature) {
  const tempOut = join(tmpdir(), `dashclaw-skill-${process.pid}.md`);
  runPython(['emit', 'skill', '--output', tempOut]);
  const raw = readFileSync(tempOut, 'utf8');
  rmSync(tempOut, { force: true });

  const normalised = raw.replace(SKILL_TIMESTAMP_LINE, `$1${signature}$2`);
  if (normalised === raw) {
    warn('skill emitter output did not match expected timestamp line — SKILL.md may be non-idempotent');
  }
  return normalised;
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
 * Mirror a source subdirectory into the global skill dir, using writeIfChanged
 * per file so the output is idempotent. Removes stale files in the destination
 * that no longer exist in the source. Skips quietly if the global dir is not
 * writable (CI / non-dev machines).
 */
function mirrorSubdir(srcRoot, dstRoot, subdir, label, excludeRe = null) {
  const src = join(srcRoot, subdir);
  const dst = join(dstRoot, subdir);
  if (!existsSync(src)) return;

  try {
    ensureDir(dst);
  } catch (err) {
    warn(`could not create ${label} dir (${err.message}) — fine on CI/non-dev machines`);
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
    warn(`could not mirror ${label} (${err.message}) — fine on CI/non-dev machines`);
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
 * __pycache__) — Compress-Archive has no native exclude flag, so we copy the
 * filtered tree first and zip the copy. Returns the staged dir path.
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
 * Rebuild a bundle zip only when the directory hash disagrees with the
 * manifest. The manifest is committed alongside the zip so re-runs stay
 * idempotent — the zip format embeds timestamps, so naive re-packaging would
 * produce a byte-different archive every invocation.
 *
 * When `excludeRe` is set, paths matching it are dropped from BOTH the hash
 * and the zip — staging happens into a temp dir first because PowerShell's
 * Compress-Archive has no native exclude flag.
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

  // Build to a temp file and only swap it into place on a verified, non-empty
  // success. The old behaviour deleted the destination zip FIRST, so any build
  // failure left a 0-byte/corrupt artifact committed. The common trigger on
  // Windows is a locked source file — an editor or the Claude Desktop app
  // holding a skill's SKILL.md open — where Compress-Archive emits a
  // *non-terminating* error yet still exits 0; $ErrorActionPreference='Stop'
  // promotes it to a real failure so we can detect it and keep the prior zip.
  const tmpZip = zipPath.replace(/\.zip$/, '') + '.tmp.zip';
  rmSync(tmpZip, { force: true });

  const isWindows = platform() === 'win32';
  let status;
  if (isWindows) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$ErrorActionPreference='Stop'; Compress-Archive -Path "${toZip}" -DestinationPath "${tmpZip}" -Force`,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
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

  if (cleanup) {
    rmSync(cleanup, { recursive: true, force: true });
  }

  // A locked source (or any zip failure) must NOT clobber the existing zip.
  if (status !== 0 || !existsSync(tmpZip) || statSync(tmpZip).size === 0) {
    rmSync(tmpZip, { force: true });
    warn(
      `zip build failed for ${relative(REPO_ROOT, zipPath)} — keeping the existing artifact. ` +
        'A source file is likely locked by another process (close any app holding the skill’s SKILL.md open).',
    );
    return;
  }

  rmSync(zipPath, { force: true });
  renameSync(tmpZip, zipPath);

  writeFileSync(
    manifestPath,
    JSON.stringify({ hash, generatedBy: 'livingcode-refresh' }, null, 2) + '\n',
    'utf8',
  );
  log(`zip -> ${relative(REPO_ROOT, zipPath)} (manifest updated)`);
}

// Back-compat alias — older code paths still call refreshSkillZip.
const refreshSkillZip = (skillDir, zipPath, manifestPath) =>
  refreshBundleZip(skillDir, zipPath, manifestPath);

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

async function main() {
  const ifStaged = process.argv.includes('--if-staged');
  if (ifStaged && !hasRelevantStagedFiles()) {
    log('no staged changes affect shape — skipping refresh');
    return;
  }

  log(`refreshing derivative artifacts from livingcode (cwd=${REPO_ROOT})`);

  const shapeJsonPath = emitShapeJson();
  writeLastSnapshot(shapeJsonPath);
  emitDoctorChecks();
  emitMcpInventory();
  const signature = loadShapeSignature(shapeJsonPath);

  emitDashboard(signature);

  const skillContent = emitSkill(signature);
  writeIfChanged(join(WEBSITE_SKILL_DIR, 'SKILL.md'), skillContent, 'skill (website)');

  try {
    writeIfChanged(join(GLOBAL_SKILL_DIR, 'SKILL.md'), skillContent, 'skill (global)');
  } catch (err) {
    warn(`could not write global skill (${err.message}) — fine on CI/non-dev machines`);
  }

  // Mirror hand-authored companion files (references/, scripts/) from the website
  // source of truth to the global skill dir. Keeps the global copy in sync
  // whenever references prose or diagnostic scripts change.
  mirrorSubdir(WEBSITE_SKILL_DIR, GLOBAL_SKILL_DIR, 'references', 'skill-references (global)');
  mirrorSubdir(WEBSITE_SKILL_DIR, GLOBAL_SKILL_DIR, 'scripts', 'skill-scripts (global)');

  // Mirror the same content to the project-local .claude/skills/ dir so the
  // in-repo Claude Code skill stays fresh alongside the global one. This is
  // gitignored — it's purely for local developer experience.
  try {
    writeIfChanged(join(PROJECT_SKILL_DIR, 'SKILL.md'), skillContent, 'skill (project)');
  } catch (err) {
    warn(`could not write project skill (${err.message}) — fine on CI`);
  }
  mirrorSubdir(WEBSITE_SKILL_DIR, PROJECT_SKILL_DIR, 'references', 'skill-references (project)');
  mirrorSubdir(WEBSITE_SKILL_DIR, PROJECT_SKILL_DIR, 'scripts', 'skill-scripts (project)');

  // Mirror to plugins/dashclaw/skills/dashclaw-platform-intelligence/ so the
  // committed plugin distribution stays in lockstep with the website source
  // of truth. Failures here ARE surfaced (unlike the global/project mirrors)
  // because the plugin copy is committed — a drift here would land in users'
  // installs.
  writeIfChanged(join(PLUGIN_SKILL_DIR, 'SKILL.md'), skillContent, 'skill (plugin)');
  mirrorSubdir(WEBSITE_SKILL_DIR, PLUGIN_SKILL_DIR, 'references', 'skill-references (plugin)');
  mirrorSubdir(WEBSITE_SKILL_DIR, PLUGIN_SKILL_DIR, 'scripts', 'skill-scripts (plugin)');

  // Mirror dashclaw-governance to plugins/ (hand-authored — not livingcode-
  // generated — but we keep the plugin copy in sync with the website canonical
  // copy so the plugin distribution always carries the latest governance
  // protocol text).
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
  // untouched. Failures ARE surfaced because the plugin copy is committed —
  // drift here would land in users' installs.
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

  refreshBundleZip(WEBSITE_SKILL_DIR, WEBSITE_SKILL_ZIP, WEBSITE_SKILL_MANIFEST);

  // Zip the hand-authored governance skill so the /docs and /downloads
  // download links resolve. Same hash-vs-manifest idempotence as the
  // platform-intelligence zip — only rebuilds when the directory contents
  // actually changed.
  if (existsSync(GOVERNANCE_SKILL_DIR)) {
    refreshBundleZip(GOVERNANCE_SKILL_DIR, GOVERNANCE_SKILL_ZIP, GOVERNANCE_SKILL_MANIFEST);
  }

  // Plugin bundle — the entire plugins/dashclaw/ tree as a single uploadable
  // artifact for ClawHub / direct distribution. Includes both mirrored skills,
  // so this MUST run after the skill mirroring above to capture the latest
  // SKILL.md content. No excludes; everything under plugins/dashclaw/ is
  // intended to ship.
  refreshBundleZip(PLUGIN_BUNDLE_DIR, PLUGIN_BUNDLE_ZIP, PLUGIN_BUNDLE_MANIFEST);

  // Claude Code hooks bundle — drops into .claude/hooks/. Excludes
  // __pycache__ and .pytest_cache so the bundle hash is stable across test
  // runs (otherwise every `pytest` invocation would trigger a zip rebuild).
  if (existsSync(HOOKS_BUNDLE_DIR)) {
    refreshBundleZip(HOOKS_BUNDLE_DIR, HOOKS_BUNDLE_ZIP, HOOKS_BUNDLE_MANIFEST, BUNDLE_EXCLUDE_RE);
  }

  log('refresh complete');
}

main().catch((err) => {
  console.error(`[livingcode] refresh failed: ${err.message}`);
  process.exit(1);
});

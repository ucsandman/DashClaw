import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(msg, color = '') {
  console.log(`${color}${msg}${RESET}`);
}

// Idempotency guards. These return true ONLY when we can confirm the version is
// already on the registry. On any error/uncertainty they return false so the
// publish proceeds (the registry still rejects true duplicates) — they can never
// block a legitimate release, only skip a redundant one.
function npmVersionExists(pkg, version) {
  // Version comes from our own package.json, but guard the interpolation anyway:
  // refuse anything outside a safe semver charset so no shell metacharacters reach
  // the command. A malformed version falls through to publish (registry arbitrates).
  if (!/^[A-Za-z0-9.+-]+$/.test(version || '')) return false;
  try {
    const out = execSync(`npm view ${pkg}@${version} version`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return out === version;
  } catch {
    return false;
  }
}

async function pypiVersionExists(pkg, version) {
  try {
    const res = await fetch(`https://pypi.org/pypi/${pkg}/${version}/json`, { method: 'GET' });
    return res.status === 200;
  } catch {
    return false;
  }
}

function readJsonVersion(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function readPyprojectVersion(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  return m ? m[1] : null;
}

async function release() {
  const rootDir = process.cwd();

  // --- 1. Node.js SDK (npm) ---
  try {
    log(`\n📦 Step 1: Publishing Node.js SDK to npm...`, YELLOW);
    process.chdir(path.join(rootDir, 'sdk'));

    const nodeVersion = readJsonVersion(path.join(rootDir, 'sdk', 'package.json'));
    log(`🚀 Starting Unified SDK Release (${nodeVersion})...`, YELLOW);
    if (npmVersionExists('dashclaw', nodeVersion)) {
      log(`⏭  npm dashclaw@${nodeVersion} already published — skipping (nothing to release).`, YELLOW);
    } else {
      // Check if we are logged in
      try {
        execSync('npm whoami', { stdio: 'ignore' });
      } catch {
        log(`❌ Error: You are not logged into npm. Run "npm login" first.`, RED);
        process.exit(1);
      }

      execSync('npm publish --access public', { stdio: 'inherit' });
      log(`✅ Node.js SDK published successfully!`, GREEN);
    }
  } catch (err) {
    log(`❌ Failed to publish Node.js SDK: ${err.message}`, RED);
    process.exitCode = 1;
    return;
  }

  // --- 2. Python SDK (PyPI) ---
  try {
    log(`\n🐍 Step 2: Publishing Python SDK to PyPI...`, YELLOW);
    process.chdir(path.join(rootDir, 'sdk-python'));

    const pyVersion = readPyprojectVersion(path.join(rootDir, 'sdk-python', 'pyproject.toml'));
    if (pyVersion && await pypiVersionExists('dashclaw', pyVersion)) {
      log(`⏭  PyPI dashclaw==${pyVersion} already published — skipping (nothing to release).`, YELLOW);
    } else {
      // Clean old builds
      const distPath = path.join(process.cwd(), 'dist');
      if (fs.existsSync(distPath)) {
        log(`  Cleaning old builds...`, RESET);
        fs.rmSync(distPath, { recursive: true, force: true });
      }

      log(`  Building wheel and sdist...`, RESET);
      execSync('python -m build', { stdio: 'inherit' });

      log(`  Uploading to PyPI via Twine...`, RESET);
      log(`  (You will be prompted for your PyPI token if not set in environment)`, YELLOW);
      execSync('python -m twine upload dist/*', { stdio: 'inherit' });

      log(`✅ Python SDK published successfully!`, GREEN);
    }
  } catch (err) {
    log(`❌ Failed to publish Python SDK: ${err.message}`, RED);
    process.exitCode = 1;
    return;
  }

  // --- 3. CLI (npm, versions independently of the SDKs) ---
  try {
    log(`\n🔧 Step 3: Publishing @dashclaw/cli to npm...`, YELLOW);
    process.chdir(path.join(rootDir, 'cli'));

    const cliVersion = readJsonVersion(path.join(rootDir, 'cli', 'package.json'));
    if (npmVersionExists('@dashclaw/cli', cliVersion)) {
      log(`⏭  npm @dashclaw/cli@${cliVersion} already published — skipping (nothing to release).`, YELLOW);
    } else {
      try {
        execSync('npm whoami', { stdio: 'ignore' });
      } catch {
        log(`❌ Error: You are not logged into npm. Run "npm login" first.`, RED);
        process.exit(1);
      }

      execSync('npm publish --access public', { stdio: 'inherit' });
      log(`✅ CLI published successfully!`, GREEN);
    }
  } catch (err) {
    log(`❌ Failed to publish CLI: ${err.message}`, RED);
    process.exitCode = 1;
    return;
  }

  process.chdir(rootDir);
  log(`\n✨ Unified Release Complete!`, GREEN);
}

release();

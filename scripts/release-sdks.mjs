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

async function release() {
  const rootDir = process.cwd();
  
  log(`🚀 Starting Unified SDK Release (v2.0.0)...`, YELLOW);

  // --- 1. Node.js SDK (npm) ---
  try {
    log(`\n📦 Step 1: Publishing Node.js SDK to npm...`, YELLOW);
    process.chdir(path.join(rootDir, 'sdk'));
    
    // Check if we are logged in
    try {
      execSync('npm whoami', { stdio: 'ignore' });
    } catch {
      log(`❌ Error: You are not logged into npm. Run "npm login" first.`, RED);
      process.exit(1);
    }

    execSync('npm publish --access public', { stdio: 'inherit' });
    log(`✅ Node.js SDK published successfully!`, GREEN);
  } catch (err) {
    log(`❌ Failed to publish Node.js SDK: ${err.message}`, RED);
  }

  // --- 2. Python SDK (PyPI) ---
  try {
    log(`\n🐍 Step 2: Publishing Python SDK to PyPI...`, YELLOW);
    process.chdir(path.join(rootDir, 'sdk-python'));

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
  } catch (err) {
    log(`❌ Failed to publish Python SDK: ${err.message}`, RED);
  }

  process.chdir(rootDir);
  log(`\n✨ Unified Release Complete!`, GREEN);
}

release();

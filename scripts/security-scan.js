#!/usr/bin/env node

/**
 * DashClaw Dashboard Security Scanner
 * 
 * Scans your codebase for common security issues before deployment.
 * Run with: node scripts/security-scan.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ANSI colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

const CRITICAL = `${RED}[CRITICAL]${RESET}`;
const WARNING = `${YELLOW}[WARNING]${RESET}`;
const OK = `${GREEN}[OK]${RESET}`;
const INFO = `${BLUE}[INFO]${RESET}`;

// Patterns that indicate hardcoded secrets
const SECRET_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/, name: 'OpenAI API Key' },
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/, name: 'Anthropic API Key' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Personal Access Token' },
  { pattern: /gho_[a-zA-Z0-9]{36}/, name: 'GitHub OAuth Token' },
  { pattern: /postgres(ql)?:\/\/[^:]+:[^@]+@/, name: 'Database Connection String' },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/, name: 'Bearer Token' },
  { pattern: /api[_-]?key\s*[=:]\s*["'][a-zA-Z0-9]{16,}["']/, name: 'Generic API Key' },
  { pattern: /password\s*[=:]\s*["'][^"']{8,}["']/, name: 'Hardcoded Password' },
  { pattern: /secret\s*[=:]\s*["'][^"']{8,}["']/, name: 'Hardcoded Secret' },
];

// Files/directories to skip. Test suites ('__tests__' at the root,
// 'test' in the packages, e.g. mcp-server/test) hold dummy-credential
// fixtures for redaction/env-bundle assertions — not deployable secrets.
const SKIP_DIRS = ['node_modules', '.next', '.git', 'dist', 'build', '.vercel', '.claude', '__tests__', 'test'];
const SKIP_FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
const SKIP_EXTENSIONS = ['.md']; // Docs often contain examples

// Strings that indicate placeholder/example values (not real secrets)
const PLACEHOLDER_PATTERNS = [
  'user:pass@',
  'user:password@',
  'username:password@',
  'postgresql://username:password@',
  // localhost / 127.0.0.1 connection strings are local dev-DB defaults
  // (e.g. the `dashclaw up` installer's embedded/docker Postgres), not
  // deployable secrets — a real leaked credential points at a remote host.
  '@localhost',
  '@127.0.0.1',
  'your-api-key',
  'your_api_key',
  'xxx',
  'placeholder',
  'example',
  '<your',
  '[your',
];

// Files that should NEVER be tracked in git
const SENSITIVE_FILE_PATTERNS = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.staging',
  '*.pem',
  '*.key',
  '*.db',
  '*.sqlite*',
  'secrets/*',
];

let issues = { critical: 0, warning: 0, ok: 0 };

function log(level, message) {
  console.log(`${level} ${message}`);
}

function isPlaceholder(line) {
  const lowerLine = line.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lowerLine.includes(p));
}

function scanFile(filePath) {
  // Local env files (.env, .env.local) are gitignored and expected to hold
  // real secrets on every machine — content-scanning them only yields false
  // positives. checkGitTracking() catches any that are committed.
  const base = path.basename(filePath);
  if (base === '.env' || base === '.env.local') return;
  const ext = path.extname(filePath);
  const validExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.env'];
  
  // Skip documentation files (they contain examples by design)
  if (SKIP_EXTENSIONS.includes(ext)) return;
  if (!validExtensions.includes(ext) && !filePath.includes('.env')) return;
  if (SKIP_FILES.includes(path.basename(filePath))) return;
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('#')) return;
      
      // Skip placeholder/example values
      if (isPlaceholder(line)) return;
      
      SECRET_PATTERNS.forEach(({ pattern, name }) => {
        if (pattern.test(line)) {
          // Check if it's actually using env var (false positive)
          if (line.includes('process.env') || line.includes('import.meta.env')) return;
          
          // Check if it's in a placeholder attribute
          if (line.includes('placeholder=') || line.includes('placeholder:')) return;
          
          log(CRITICAL, `${name} found in ${filePath}:${index + 1}`);
          issues.critical++;
        }
      });
    });
  } catch (err) {
    // Skip files we can't read
  }
}

function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.includes(entry.name)) {
        scanDirectory(fullPath);
      }
    } else {
      scanFile(fullPath);
    }
  }
}

function checkGitTracking() {
  console.log('\n📁 Checking git-tracked files...\n');
  
  try {
    const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
    
    tracked.forEach(file => {
      // .env.example is meant to be committed (template only)
      if (file === '.env.example') return;

      SENSITIVE_FILE_PATTERNS.forEach(pattern => {
        // Make a simple glob -> regex, anchored to avoid matching ".env" inside ".env.example"
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const regex = new RegExp(`^${escaped}$`);
        if (regex.test(file)) {
          log(CRITICAL, `Sensitive file tracked in git: ${file}`);
          issues.critical++;
        }
      });
    });
    
    if (issues.critical === 0) {
      log(OK, 'No sensitive files tracked in git');
      issues.ok++;
    }
  } catch (err) {
    log(INFO, 'Not a git repository or git not available');
  }
}

function checkGitignore() {
  console.log('\n📋 Checking .gitignore coverage...\n');
  
  const required = ['.env', '.env.*', '.env.local', '*.db', 'secrets/', 'node_modules/'];
  const gitignorePath = '.gitignore';
  
  if (!fs.existsSync(gitignorePath)) {
    log(CRITICAL, 'No .gitignore file found!');
    issues.critical++;
    return;
  }
  
  const content = fs.readFileSync(gitignorePath, 'utf8');
  
  required.forEach(pattern => {
    // Check for exact match or equivalent coverage
    if (content.includes(pattern) || content.includes(pattern.replace(/\*/g, ''))) {
      log(OK, `${pattern} is gitignored`);
      issues.ok++;
    } else {
      log(WARNING, `${pattern} may not be covered in .gitignore`);
      issues.warning++;
    }
  });
}

function checkEnvExample() {
  console.log('\n📝 Checking environment documentation...\n');
  
  if (fs.existsSync('.env.example')) {
    const content = fs.readFileSync('.env.example', 'utf8');
    const lines = content.split('\n');

    // Make sure .env.example doesn't have real values.
    // Scan line-by-line so comments and placeholders don't trigger false positives.
    lines.forEach((line, index) => {
      // Skip comments
      if (line.trim().startsWith('#')) return;
      // Skip placeholder/example values
      if (isPlaceholder(line)) return;

      SECRET_PATTERNS.forEach(({ pattern, name }) => {
        if (pattern.test(line)) {
          log(CRITICAL, `.env.example contains real ${name} at line ${index + 1}!`);
          issues.critical++;
        }
      });
    });
    
    if (issues.critical === 0) {
      log(OK, '.env.example exists and contains no real secrets');
      issues.ok++;
    }
  } else {
    log(INFO, 'No .env.example found (optional but recommended)');
  }
}

function checkDependencies() {
  console.log('\n📦 Checking dependencies...\n');
  
  try {
    // Cross-platform: avoid bash redirects like `2>/dev/null || true`.
    // Use `--audit-level=high` so moderate/low issues don't fail the scan.
    const result = execSync('npm audit --json --audit-level=high', { encoding: 'utf8' });
    const audit = JSON.parse(result || '{}');
    
    if (audit.metadata) {
      const { vulnerabilities } = audit.metadata;
      if (vulnerabilities) {
        if (vulnerabilities.critical > 0) {
          log(CRITICAL, `${vulnerabilities.critical} critical vulnerabilities in dependencies`);
          issues.critical += vulnerabilities.critical;
        }
        if (vulnerabilities.high > 0) {
          log(WARNING, `${vulnerabilities.high} high vulnerabilities in dependencies`);
          issues.warning += vulnerabilities.high;
        }
        if (vulnerabilities.critical === 0 && vulnerabilities.high === 0) {
          log(OK, 'No critical or high vulnerabilities in dependencies');
          issues.ok++;
        }
      }
    }
  } catch (err) {
    // Note: npm audit may fail if networking is restricted.
    log(INFO, `Could not run npm audit (${err?.message || 'unknown error'})`);
  }
}

// Main execution
console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🔒 DashClaw Dashboard Security Scanner 🔒            ║
╚═══════════════════════════════════════════════════════════════╝
`);

console.log('🔍 Scanning source files for hardcoded secrets...\n');
scanDirectory('.');

checkGitTracking();
checkGitignore();
checkEnvExample();
checkDependencies();

// Summary
console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                        SCAN SUMMARY                           ║
╠═══════════════════════════════════════════════════════════════╣
║  ${RED}Critical Issues:${RESET} ${issues.critical.toString().padStart(3)}                                       ║
║  ${YELLOW}Warnings:${RESET}        ${issues.warning.toString().padStart(3)}                                       ║
║  ${GREEN}Passed Checks:${RESET}   ${issues.ok.toString().padStart(3)}                                       ║
╚═══════════════════════════════════════════════════════════════╝
`);

if (issues.critical > 0) {
  console.log(`${RED}❌ FAILED: ${issues.critical} critical issue(s) must be fixed before deployment!${RESET}\n`);
  process.exit(1);
} else if (issues.warning > 0) {
  console.log(`${YELLOW}⚠️  PASSED WITH WARNINGS: Review ${issues.warning} warning(s) before deployment.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${GREEN}✅ PASSED: Your codebase looks secure!${RESET}\n`);
  process.exit(0);
}

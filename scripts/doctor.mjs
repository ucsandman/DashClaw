// scripts/doctor.mjs
/**
 * DashClaw Doctor — local mode.
 * Imports the doctor engine directly for full filesystem + DB access.
 *
 * Usage:
 *   npm run doctor
 *   npm run doctor -- --json
 *   npm run doctor -- --no-fix
 *   npm run doctor -- --strict
 *   npm run doctor -- --category database,config
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';
import { doctorExitCode } from './lib/doctor-cli.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Load .env into process.env for local mode
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const { parseEnv } = await import('../app/lib/doctor/fixes/env-writer.mjs');
  const envVars = parseEnv(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(envVars)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

const { runDoctor } = await import('../app/lib/doctor/engine.mjs');
const { applyFix } = await import('../app/lib/doctor/fixes/index.mjs');
const { formatDoctorResult, formatFixResult, formatManualSummary } = await import(
  '../app/lib/doctor/format.mjs'
);

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const noFix = args.includes('--no-fix');
const strict = args.includes('--strict');
const categoryIdx = args.indexOf('--category');
const categories =
  categoryIdx !== -1 && args[categoryIdx + 1]
    ? args[categoryIdx + 1].split(',').map((c) => c.trim())
    : null;

// --- Local-only checks ---
const localChecks = [];

if (!existsSync(envPath)) {
  localChecks.push({
    id: 'local_env_exists',
    category: 'config',
    status: 'fail',
    title: '.env File',
    message: '.env file does not exist — create one or run npm run setup',
    fix: null,
  });
}

const gitignorePath = resolve(process.cwd(), '.gitignore');
if (existsSync(gitignorePath)) {
  const gitignore = readFileSync(gitignorePath, 'utf8');
  if (!gitignore.split(/\r?\n/).some((line) => line.trim() === '.env')) {
    localChecks.push({
      id: 'local_env_gitignore',
      category: 'config',
      status: 'fail',
      title: '.env in .gitignore',
      message: '.env is not listed in .gitignore — secrets may be committed',
      fix: null,
    });
  }
}

if (!existsSync(resolve(process.cwd(), 'node_modules'))) {
  localChecks.push({
    id: 'local_deps',
    category: 'config',
    status: 'fail',
    title: 'Dependencies',
    message: 'node_modules/ not found — run npm install',
    fix: null,
  });
}

// --- Run doctor engine ---
const result = await runDoctor({ categories, includeFixes: !noFix });

// Merge local checks into result
result.checks = [...localChecks, ...result.checks];
for (const c of localChecks) {
  if (c.status === 'fail') result.summary.fail++;
  else if (c.status === 'warn') result.summary.warn++;
  else result.summary.pass++;
}
if (result.summary.fail > 0) result.status = 'unhealthy';
else if (result.summary.warn > 0 && result.status === 'healthy') result.status = 'needs_attention';

// --- JSON mode ---
if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(doctorExitCode(result, { strict }));
}

// --- Rich mode + auto-fix ---
console.log(formatDoctorResult(result));

if (!noFix) {
  const fixable = result.checks.filter((c) => c.status === 'fail' && c.fix?.type === 'auto');
  const manual = result.checks.filter(
    (c) => (c.status === 'fail' || c.status === 'warn') && (!c.fix || c.fix.type === 'manual'),
  );

  let fixCount = 0;

  for (const check of fixable) {
    const fixResult = await applyFix(check.fix.action, {}, { allowLocal: true });
    console.log(formatFixResult(fixResult));
    if (fixResult.applied) fixCount++;
  }

  if (fixCount > 0) {
    console.log(`\n ${fixCount} issue${fixCount !== 1 ? 's' : ''} auto-fixed this run\n`);
    // Re-run to show updated state
    const updated = await runDoctor({ categories });
    console.log(formatDoctorResult(updated));
  }

  console.log(formatManualSummary(manual));
}

process.exit(doctorExitCode(result, { strict }));

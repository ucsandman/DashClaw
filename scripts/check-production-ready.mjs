#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const npmExecPath = process.env.npm_execpath;
const npmCmd = npmExecPath ? process.execPath : 'npm';
const npmPrefix = npmExecPath ? [npmExecPath] : [];
const npxCmd = npmExecPath ? process.execPath : 'npx';
const npxPrefix = npmExecPath ? [npmExecPath, 'exec', '--'] : [];

const STEPS = [
  ['lint', npmCmd, [...npmPrefix, 'run', 'lint']],
  ['typecheck', npmCmd, [...npmPrefix, 'run', 'typecheck']],
  ['vitest', npxCmd, [...npxPrefix, 'vitest', 'run']],
  ['build', npmCmd, [...npmPrefix, 'run', 'build']],
  ['contracts', npmCmd, [...npmPrefix, 'run', 'contracts:check']],
  ['docs', npmCmd, [...npmPrefix, 'run', 'docs:check']],
  ['openapi', npmCmd, [...npmPrefix, 'run', 'openapi:check']],
  ['api-inventory', npmCmd, [...npmPrefix, 'run', 'api:inventory:check']],
  ['route-sql', npmCmd, [...npmPrefix, 'run', 'route-sql:check']],
  ['version-hardcodes', npmCmd, [...npmPrefix, 'run', 'version:check']],
  ['version-sync', npmCmd, [...npmPrefix, 'run', 'version:sync:check']],
  ['script-syntax', npmCmd, [...npmPrefix, 'run', 'scripts:check-syntax']],
  ['smoke', npmCmd, [...npmPrefix, 'run', 'test:smoke']],
  ['prod-audit', npmCmd, [...npmPrefix, 'audit', '--omit=dev', '--audit-level=moderate']],
];

for (const [label, command, args] of STEPS) {
  process.stdout.write(`[production:check] ${label}: ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.error) {
    process.stderr.write(`[production:check] ${label} failed to start: ${result.error.message}\n`);
    process.exit(1);
  }

  if (result.signal) {
    process.stderr.write(`[production:check] ${label} terminated by signal ${result.signal}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.stderr.write(`[production:check] ${label} failed with exit code ${result.status}\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('[production:check] all production readiness gates passed.\n');

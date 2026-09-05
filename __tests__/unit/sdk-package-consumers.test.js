import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

function npmCliPath() {
  const configured = process.env.npm_execpath;
  if (configured && configured.endsWith('.js') && existsSync(configured)) return configured;
  return resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
}

function runNode(args, cwd) {
  return execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('packed Node SDK consumers', () => {
  const scratch = [];

  afterEach(() => {
    for (const path of scratch) rmSync(path, { recursive: true, force: true });
  });

  it('supports strict TypeScript plus ESM and CommonJS exports from the tarball', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dashclaw-sdk-consumer-'));
    scratch.push(dir);
    const packageJson = JSON.parse(readFileSync(resolve('sdk/package.json'), 'utf8'));

    runNode([npmCliPath(), 'pack', resolve('sdk'), '--pack-destination', dir, '--ignore-scripts'], process.cwd());
    const tarball = join(dir, `dashclaw-${packageJson.version}.tgz`);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    runNode([npmCliPath(), 'install', '--ignore-scripts', '--no-package-lock', tarball], dir);

    writeFileSync(join(dir, 'esm.mjs'), [
      "import * as sdk from 'dashclaw';",
      "const expected = ['DashClaw','ApprovalDeniedError','ApprovalPendingError','GuardBlockedError','OutcomeConfirmationError','ExecutionClaimError','scrubAct'];",
      "for (const key of expected) if (typeof sdk[key] !== 'function') throw new Error(`missing ESM export ${key}`);",
    ].join('\n'));
    writeFileSync(join(dir, 'cjs.cjs'), [
      "const sdk = require('dashclaw');",
      "const expected = ['DashClaw','ApprovalDeniedError','ApprovalPendingError','GuardBlockedError','OutcomeConfirmationError','ExecutionClaimError','scrubAct'];",
      "for (const key of expected) if (typeof sdk[key] !== 'function') throw new Error(`missing CJS export ${key}`);",
      "const clean = sdk.scrubAct({ kind: 'shell', command: 'echo token=oc_live_fixture' });",
      "if (clean.command !== 'echo token=[REDACTED]') throw new Error('CJS scrubAct differs from ESM contract');",
      "sdk.DashClaw.create({ baseUrl: 'https://example.test', apiKey: 'k', agentId: 'a' }).then((client) => {",
      "  if (typeof client.runGoverned !== 'function') throw new Error('CJS DashClaw bridge is not usable');",
      "});",
    ].join('\n'));
    runNode(['esm.mjs'], dir);
    runNode(['cjs.cjs'], dir);

    writeFileSync(join(dir, 'consumer.ts'), [
      "import { DashClaw, ExecutionClaimError, OutcomeConfirmationError, scrubAct, type Act, type GuardDecision } from 'dashclaw';",
      "const act: Act = { kind: 'shell', command: 'echo ok' };",
      "const clean: Act = scrubAct(act);",
      "const claw = new DashClaw({ baseUrl: 'https://example.test', apiKey: 'k', agentId: 'a' });",
      "const pending: Promise<GuardDecision> = claw.guard({ action_type: 'other', declared_goal: 'g', act: clean });",
      "void pending; void ExecutionClaimError; void OutcomeConfirmationError;",
    ].join('\n'));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        skipLibCheck: false,
      },
      include: ['consumer.ts'],
    }));
    runNode([resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], dir);
  }, 30000);
});

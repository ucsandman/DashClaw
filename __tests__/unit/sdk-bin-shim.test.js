import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { shimSpawnArgs } from '../../sdk/bin/dashclaw-shim.js';

const TEST_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const TEST_NPM_CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';

describe('sdk bin shim', () => {
  it('forwards argv to @dashclaw/cli via npm exec', () => {
    expect(shimSpawnArgs(['up', '--yes'], { execPath: TEST_NODE, npmCliPath: TEST_NPM_CLI })).toEqual({
      cmd: TEST_NODE,
      args: [TEST_NPM_CLI, 'exec', '--yes', '--', '@dashclaw/cli', 'up', '--yes'],
    });
  });
  it('forwards empty argv (bare npx dashclaw shows the CLI help)', () => {
    expect(shimSpawnArgs([], { execPath: TEST_NODE, npmCliPath: TEST_NPM_CLI })).toEqual({
      cmd: TEST_NODE,
      args: [TEST_NPM_CLI, 'exec', '--yes', '--', '@dashclaw/cli'],
    });
  });

  it.runIf(process.platform === 'win32')('passes metacharacters literally through the real child-process boundary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dashclaw-shim-'));
    try {
      const probe = join(dir, 'npm-cli-probe.cjs');
      writeFileSync(probe, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      const forwarded = ['safe&echo injected', 'pipe|value', '%PATH%', '(group)', '"quoted value"'];
      const { cmd, args } = shimSpawnArgs(forwarded, {
        execPath: process.execPath,
        npmCliPath: probe,
      });
      const result = spawnSync(cmd, args, { encoding: 'utf8', shell: false });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual([
        'exec', '--yes', '--', '@dashclaw/cli', ...forwarded,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

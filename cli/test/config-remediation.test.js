import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliBin = join(cliDir, 'bin', 'dashclaw.js');

describe('missing configuration remediation', () => {
  it('names only supported environment or saved-config setup paths', () => {
    const isolatedHome = mkdtempSync(join(tmpdir(), 'dashclaw-cli-config-test-'));
    const env = { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome };
    delete env.DASHCLAW_BASE_URL;
    delete env.DASHCLAW_API_KEY;

    const result = spawnSync(process.execPath, [cliBin, 'approvals'], {
      cwd: cliDir,
      env,
      encoding: 'utf8',
      input: '',
    });

    assert.strictEqual(result.status, 1, result.stderr);
    assert.match(result.stderr, /DASHCLAW_BASE_URL.*DASHCLAW_API_KEY/s);
    assert.match(result.stderr, /interactive first run|config\.json/i);
    assert.doesNotMatch(result.stderr, /\.env file/i);
  });
});

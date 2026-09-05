import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const smokeScripts = ['policy-smoke.mjs', 'cross-org-smoke.mjs'];

describe('F47 smoke-script environment isolation', () => {
  it.each(smokeScripts)('%s uses the canonical loader without deleting or parsing process configuration', async (script) => {
    const source = await readFile(join(process.cwd(), 'scripts', script), 'utf8');
    expect(source).toContain("import './_load-env.mjs';");
    expect(source).not.toContain("readFileSync(resolve(process.cwd(), '.env.local')");
    expect(source).not.toMatch(/delete process\.env\[k\]/);
  });

  it('disabled file loading preserves the inherited disposable database and operator key', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'dashclaw-smoke-env-'));
    const scriptsDir = join(fixtureRoot, 'scripts');
    await mkdir(scriptsDir);
    await copyFile(join(process.cwd(), 'scripts', '_load-env.mjs'), join(scriptsDir, '_load-env.mjs'));
    await writeFile(
      join(fixtureRoot, '.env.local'),
      'DATABASE_URL=postgres://file-database\nDASHCLAW_API_KEY=file-key\n',
      'utf8',
    );
    await writeFile(
      join(scriptsDir, 'probe.mjs'),
      "import './_load-env.mjs'; console.log(JSON.stringify({ db: process.env.DATABASE_URL, key: process.env.DASHCLAW_API_KEY }));\n",
      'utf8',
    );

    const probe = spawnSync(process.execPath, ['scripts/probe.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://inherited-disposable',
        DASHCLAW_API_KEY: 'inherited-local-key',
        DASHCLAW_ENV_FILE_DISABLE: '1',
        DASHCLAW_ENV_FILE_OVERRIDE: '',
      },
    });

    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout.trim())).toEqual({
      db: 'postgres://inherited-disposable',
      key: 'inherited-local-key',
    });
  });
});

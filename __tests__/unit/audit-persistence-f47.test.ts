import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('F47 script environment precedence', () => {
  it('keeps an explicitly selected process database unless file override is deliberate', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'dashclaw-env-precedence-'));
    const scriptsDir = join(fixtureRoot, 'scripts');
    await mkdir(scriptsDir);
    await copyFile(join(process.cwd(), 'scripts', '_load-env.mjs'), join(scriptsDir, '_load-env.mjs'));
    await writeFile(join(fixtureRoot, '.env'), 'DATABASE_URL=postgres://file-default\n', 'utf8');
    await writeFile(join(fixtureRoot, '.env.local'), 'DATABASE_URL=postgres://file-local\n', 'utf8');

    const probe = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('./scripts/_load-env.mjs'); console.log(process.env.DATABASE_URL)"],
      {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: 'postgres://explicit-process', DASHCLAW_ENV_FILE_OVERRIDE: '' },
      },
    );

    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout.trim()).toBe('postgres://explicit-process');
  });

  it('can disable repository env-file reads for an isolated migration run', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'dashclaw-env-disabled-'));
    const scriptsDir = join(fixtureRoot, 'scripts');
    await mkdir(scriptsDir);
    await copyFile(join(process.cwd(), 'scripts', '_load-env.mjs'), join(scriptsDir, '_load-env.mjs'));
    await mkdir(join(fixtureRoot, '.env'));
    await mkdir(join(fixtureRoot, '.env.local'));

    const probe = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', "const loaded = await import('./scripts/_load-env.mjs'); console.log(JSON.stringify(loaded.ENV_LOAD_REPORT))"],
      {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'postgres://explicit-process',
          DASHCLAW_ENV_FILE_DISABLE: '1',
        },
      },
    );

    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout.trim())).toMatchObject({
      databaseSource: 'process',
      filesDisabled: true,
    });
  });
});

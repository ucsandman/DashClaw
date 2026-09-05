import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

describe('agent key onboarding generator', () => {
  const scratch = [];

  afterEach(() => {
    for (const path of scratch) rmSync(path, { recursive: true, force: true });
  });

  it('writes the documented Python PEM artifacts without advertising unsupported Node RSA signing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dashclaw-agent-key-'));
    scratch.push(dir);
    const stdout = execFileSync(process.execPath, [
      resolve('scripts/generate-agent-keys.mjs'),
      'test-agent',
      '--output-dir',
      dir,
    ], { encoding: 'utf8' });

    const privatePem = readFileSync(join(dir, 'private_key.pem'), 'utf8');
    const publicPem = readFileSync(join(dir, 'public_key.pem'), 'utf8');
    expect(privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(publicPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    const payload = Buffer.from('dashclaw-key-onboarding-proof');
    const signature = sign('sha256', payload, createPrivateKey(privatePem));
    expect(verify('sha256', payload, createPublicKey(publicPem), signature)).toBe(true);
    expect(stdout).toContain('authToken');
    expect(stdout).not.toContain('privateKey\n');
    expect(stdout).not.toContain('AGENT_PRIVATE_KEY=');
    expect(stdout).not.toContain('"d":');
  });
});

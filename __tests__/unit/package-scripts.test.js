import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

describe('package scripts', () => {
  it('runs smoke dev server through the same webpack path as local dev', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    expect(pkg.scripts.dev).toContain('next dev --webpack');
    expect(pkg.scripts['dev:smoke']).toContain('next dev --webpack');
    expect(pkg.scripts.start).toBe('next start');
  });
});

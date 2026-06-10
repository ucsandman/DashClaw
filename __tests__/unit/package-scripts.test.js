import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

describe('package scripts', () => {
  it('runs smoke dev server through the same bundler path as local dev (Turbopack since the extensionless codemod)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    // The --webpack opt-out was dropped once the mismatched .js specifiers
    // were codemodded away — dev, smoke-dev, and build all run Turbopack.
    expect(pkg.scripts.dev).toBe('next dev -p 3000');
    expect(pkg.scripts['dev:smoke']).toBe('next dev -p 3099');
    expect(pkg.scripts.build).toBe('next build');
    expect(pkg.scripts.start).toBe('next start');
  });

  it('vercel buildCommand uses the same bundler as npm run build', () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    expect(vercel.buildCommand).toBe('node scripts/auto-migrate.mjs && next build');
  });
});

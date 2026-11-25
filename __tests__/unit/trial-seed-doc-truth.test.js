import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reverse-check pin: the docs must describe the seed the code creates.
// Hosted trial provisioning seeds the catastrophe-only Short List, which
// holds for approval and never blocks.
const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const DOCS = ['QUICK-START.md', 'docs/integrations/claude-code.md', 'docs/operations.md'];

describe('trial seed docs match the code', () => {
  it('hosted trial provisioning still seeds the catastrophe-only pack', () => {
    expect(read('app/lib/repositories/hosted-workspace.repository.ts')).toMatch(/await\s+seedCatastrophePack\(/);
  });

  for (const file of DOCS) {
    it(`${file} never pairs the trial or a pre-seed with claude-code-starter`, () => {
      const offenders = read(file)
        .split(/\r?\n/)
        .filter((line) => (line.includes('claude-code-starter') && /\btrial\b|pre-seeded/i.test(line))
          || /\bstarter\b[^.]*pre-seeded/i.test(line));
      expect(offenders).toEqual([]);
    });

    it(`${file} never says the catastrophe pack blocks`, () => {
      const offenders = read(file)
        .split(/\r?\n/)
        .filter((line) => /catastrophe/i.test(line) && /\bblock(s|ed)\b/i.test(line));
      expect(offenders).toEqual([]);
    });
  }
});

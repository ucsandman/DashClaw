import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('runnable SDK governance examples', () => {
  it.each([
    ['examples/openai-governed-agent/index.js', '.runGoverned('],
    ['examples/vercel-ai-governed/index.mjs', '.runGoverned('],
    ['examples/crewai-governed/main.py', '.run_governed('],
  ])('%s uses the canonical persisted-action helper', (path, helper) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain(helper);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const skill = readFileSync(
  path.resolve('public/downloads/dashclaw-governance/SKILL.md'),
  'utf8'
);

describe('dashclaw-governance skill — toolkit-into-runtime sections', () => {
  it('teaches dashclaw_secret_due before acting on credentials', () => {
    expect(skill).toMatch(/dashclaw_secret_due/);
    expect(skill).toMatch(/before acting on credentials/i);
  });

  it('teaches dashclaw_decisions_recent for in-session retrospection', () => {
    expect(skill).toMatch(/dashclaw_decisions_recent/);
  });
});

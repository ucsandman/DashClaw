import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const skill = readFileSync(
  path.resolve('public/downloads/dashclaw-governance/SKILL.md'),
  'utf8'
);

describe('dashclaw-governance skill — toolkit-into-runtime sections', () => {
  it('teaches dashclaw_handoff_create on session end', () => {
    expect(skill).toMatch(/dashclaw_handoff_create/);
    expect(skill).toMatch(/concluding a session/i);
  });

  it('teaches dashclaw_handoff_latest on session start', () => {
    expect(skill).toMatch(/dashclaw_handoff_latest/);
  });

  it('teaches dashclaw_skill_scan before loading unknown skill', () => {
    expect(skill).toMatch(/dashclaw_skill_scan/);
    expect(skill).toMatch(/before loading an unknown skill/i);
  });

  it('teaches dashclaw_secret_due before acting on credentials', () => {
    expect(skill).toMatch(/dashclaw_secret_due/);
    expect(skill).toMatch(/before acting on credentials/i);
  });

  it('teaches dashclaw_loop_add for in-conversation commitments', () => {
    expect(skill).toMatch(/dashclaw_loop_add/);
  });

  it('teaches dashclaw_decisions_recent for in-session retrospection', () => {
    expect(skill).toMatch(/dashclaw_decisions_recent/);
  });
});

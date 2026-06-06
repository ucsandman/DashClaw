import { describe, it, expect } from 'vitest';
import { POLICY_MODE_CATALOG, AVAILABLE_MODES } from '@/lib/policy-modes';
import type { PolicyMode } from '@/lib/policy-modes';

const REQUIRED_MODES = [
  'claude-code',
  'openclaw',
  'custom-agent',
  'enterprise-strict',
  'soc2',
  'research',
  'autonomous-overnight',
  'deploy',
];

describe('POLICY_MODE_CATALOG', () => {
  it('contains exactly the 8 required modes', () => {
    expect([...AVAILABLE_MODES].sort()).toEqual([...REQUIRED_MODES].sort());
  });

  it('every mode has all required fields with valid types', () => {
    for (const [id, m] of Object.entries(POLICY_MODE_CATALOG) as [string, PolicyMode][]) {
      expect(m.id).toBe(id);
      expect(typeof m.name).toBe('string');
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.purpose.length).toBeGreaterThan(0);
      expect(m.uxPromise.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(m.interruptionLevel);
      for (const arr of [m.allows, m.warns, m.requiresApproval, m.blocks, m.toolVisibilityNotes]) {
        expect(Array.isArray(arr)).toBe(true);
        for (const item of arr) expect(typeof item).toBe('string');
      }
      // Every mode must be honest about visibility.
      expect(m.toolVisibilityNotes.length).toBeGreaterThan(0);
    }
  });

  it('claude-code is present, low interruption, with the "won\'t interrupt" promise', () => {
    const m = POLICY_MODE_CATALOG['claude-code'];
    expect(m).toBeTruthy();
    if (!m) return;
    expect(m.interruptionLevel).toBe('low');
    expect(m.uxPromise.toLowerCase()).toContain('interrupt');
    // Routine coding is in `allows`, not in `requiresApproval`.
    const allowsBlob = m.allows.join(' ').toLowerCase();
    expect(allowsBlob).toContain('bash');
    expect(allowsBlob).toContain('test');
    const approvalBlob = m.requiresApproval.join(' ').toLowerCase();
    expect(approvalBlob).not.toContain('linting');
  });

  it('soc2 uses honest language — no positive compliance/guarantee claim, disclaimer present', () => {
    const m = POLICY_MODE_CATALOG['soc2'];
    expect(m).toBeTruthy();
    if (!m) return;
    const blob = JSON.stringify(m).toLowerCase();
    // No fake guarantee.
    expect(blob).not.toContain('guarantee');
    // No POSITIVE "you are SOC 2 compliant" claim.
    expect(blob).not.toMatch(/(makes you|fully|now|become|are|is)\s+soc[\s-]?2[\s-]?compliant/);
    expect(blob).not.toMatch(/ensures?\s+compliance/);
    // Honest disclaimer IS present.
    expect(blob).toContain('does not');
    expect(blob).toContain('soc 2 compliant');
  });
});

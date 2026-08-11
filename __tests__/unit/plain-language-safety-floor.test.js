import { describe, it, expect } from 'vitest';
import { applySafetyFloor, unknownDescription } from '@/lib/plain-language/types';

function calm() {
  return {
    headline: 'Lists the files in a folder.',
    warnings: ['Reads only, changes nothing.'],
    confidence: 'high',
    reversible: true,
    ruleId: 'bash.read',
  };
}

describe('applySafetyFloor', () => {
  it('replaces a calm sentence when the risk score is high', () => {
    const out = applySafetyFloor(calm(), 85);
    expect(out.confidence).toBe('unknown');
    expect(out.headline).not.toContain('Lists the files');
    expect(out.warnings.join(' ')).toContain('Trust the command');
  });

  it('leaves a calm sentence alone when the risk score is low', () => {
    const out = applySafetyFloor(calm(), 10);
    expect(out.headline).toBe('Lists the files in a folder.');
    expect(out.confidence).toBe('high');
  });

  it('leaves a non-calm sentence alone even at high risk', () => {
    const scary = { ...calm(), headline: 'Deletes the build folder.', ruleId: 'bash.delete' };
    const out = applySafetyFloor(scary, 85);
    expect(out.headline).toBe('Deletes the build folder.');
  });

  it('trips on irreversibility even when the score is low', () => {
    const out = applySafetyFloor({ ...calm(), reversible: false }, 5);
    expect(out.confidence).toBe('unknown');
  });

  it('passes an already-unknown description straight through', () => {
    const u = unknownDescription('tool.unregistered');
    expect(applySafetyFloor(u, 90)).toEqual(u);
  });
});

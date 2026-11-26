import { describe, it, expect } from 'vitest';
import { trialActivationSteps } from '../../../app/lib/hosted/trial-activation';

const NONE = { keyUsed: false, firstAgentCallAtMs: null, approvalLandedAtMs: null };

function doneIds(result: ReturnType<typeof trialActivationSteps>) {
  return result.steps.filter((s) => s.done).map((s) => s.id);
}

describe('trialActivationSteps', () => {
  it('lists the three steps in order with the brief labels', () => {
    const result = trialActivationSteps(NONE);
    expect(result.steps.map((s) => s.id)).toEqual(['key_used', 'first_call', 'approval_landed']);
    expect(result.steps.map((s) => s.label)).toEqual([
      'Key used',
      'First call received',
      'Approval landed on your phone',
    ]);
  });

  it('fresh trial: nothing done, current step is the key', () => {
    const result = trialActivationSteps(NONE);
    expect(doneIds(result)).toEqual([]);
    expect(result.current).toBe('key_used');
    expect(result.complete).toBe(false);
  });

  it('key used only: current step moves to the first call', () => {
    const result = trialActivationSteps({ ...NONE, keyUsed: true });
    expect(doneIds(result)).toEqual(['key_used']);
    expect(result.current).toBe('first_call');
    expect(result.complete).toBe(false);
  });

  it('key used and an agent call: current step is the phone approval', () => {
    const result = trialActivationSteps({ ...NONE, keyUsed: true, firstAgentCallAtMs: 1_700_000_000_000 });
    expect(doneIds(result)).toEqual(['key_used', 'first_call']);
    expect(result.current).toBe('approval_landed');
  });

  it('all three facts: complete with no current step', () => {
    const result = trialActivationSteps({
      keyUsed: true,
      firstAgentCallAtMs: 1_700_000_000_000,
      approvalLandedAtMs: 1_700_000_060_000,
    });
    expect(doneIds(result)).toEqual(['key_used', 'first_call', 'approval_landed']);
    expect(result.current).toBeNull();
    expect(result.complete).toBe(true);
  });

  it('each step reflects only its own fact (an OAuth agent call with no key use)', () => {
    const result = trialActivationSteps({ ...NONE, firstAgentCallAtMs: 1_700_000_000_000 });
    expect(doneIds(result)).toEqual(['first_call']);
    expect(result.current).toBe('key_used');
    expect(result.complete).toBe(false);
  });
});

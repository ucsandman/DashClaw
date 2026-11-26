/**
 * Hosted-trial activation checklist (the /connect "first real agent call"
 * path). Pure: turns one trial org's facts into the three steps the page
 * renders, so the states are testable without a DB or a browser.
 *
 * Each step reflects only its own fact. A keyless OAuth agent can make a
 * call without ever using the trial key, so "first call" never implies
 * "key used" or the other way round.
 */

export type TrialActivationFacts = {
  /** Any of the org's API keys has authenticated a request. */
  keyUsed: boolean;
  /** First governed action from a real agent (not the in-browser demo button). */
  firstAgentCallAtMs: number | null;
  /** First action a human approved (the /approve phone surface resolves these). */
  approvalLandedAtMs: number | null;
};

export type TrialActivationStepId = 'key_used' | 'first_call' | 'approval_landed';

export type TrialActivationStep = {
  id: TrialActivationStepId;
  label: string;
  done: boolean;
};

export type TrialActivation = {
  steps: TrialActivationStep[];
  /** First step not yet done; null once all are done. */
  current: TrialActivationStepId | null;
  complete: boolean;
};

export function trialActivationSteps(facts: TrialActivationFacts): TrialActivation {
  const steps: TrialActivationStep[] = [
    { id: 'key_used', label: 'Key used', done: facts.keyUsed },
    { id: 'first_call', label: 'First call received', done: facts.firstAgentCallAtMs !== null },
    { id: 'approval_landed', label: 'Approval landed on your phone', done: facts.approvalLandedAtMs !== null },
  ];
  const open = steps.find((s) => !s.done);
  return { steps, current: open ? open.id : null, complete: !open };
}

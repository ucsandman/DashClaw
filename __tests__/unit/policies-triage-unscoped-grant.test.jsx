import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * /policies "Needs your call" → the warn row offered a verdict the server can
 * never honor.
 *
 * Live defect 2026-08-11 (my-dashclaw.vercel.app): "Always allow" is the
 * primary, always-enabled action on every warn group, but
 * POST /api/policies/review/verdict rejects `always_allow` with 400
 * UNSCOPED_GRANT_REJECTED whenever the shape has no target_prefix (F1,
 * governance gap audit 2026-08-05 — an unscoped grant silently nullifies every
 * require_approval rule for its action type).
 *
 * Most Bash warn groups have no target: the hook only forwards `target` for a
 * shell redirection or a script-then-execute hit. So the operator's default
 * click on a group that had already fired 236 times was a guaranteed error,
 * and the row stayed in the inbox. Three rows in the field report were red at
 * once.
 *
 * The row must offer the verb that works and say why the other one is absent.
 */

const fetchReview = vi.fn();
const postVerdict = vi.fn();

vi.mock('@/policies/lib/contractClient', () => ({
  fetchReview: (...a) => fetchReview(...a),
  postVerdict: (...a) => postVerdict(...a),
}));
vi.mock('@/policies/lib/proposalsClient', () => ({
  fetchProposals: () => Promise.resolve({ policies: [], proposals: [] }),
  dismissProposal: vi.fn(),
  undismissProposal: vi.fn(),
  acceptProposal: vi.fn(),
}));
vi.mock('@/policies/lib/tighteningClient', () => ({
  fetchTighteningProposals: () => Promise.resolve({ proposals: [] }),
  ratifyTighteningProposal: vi.fn(),
  dismissTighteningProposal: vi.fn(),
  undoTighteningDecision: vi.fn(),
}));
vi.mock('@/policies/lib/looseningClient', () => ({
  fetchLooseningProposals: () => Promise.resolve({ proposals: [] }),
  ratifyLooseningProposal: vi.fn(),
  dismissLooseningProposal: vi.fn(),
  undoLooseningDecision: vi.fn(),
  isPrecedent: () => false,
}));
vi.mock('@/policies/lib/calibrationClient', () => ({
  fetchCalibrationProposals: () => Promise.resolve({ proposals: [] }),
  ratifyProposal: vi.fn(),
  dismissCalibrationProposal: vi.fn(),
  undoCalibrationDecision: vi.fn(),
  CALIBRATION_RULE_LABEL: {},
}));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));

const { default: TriageInbox } = await import('@/policies/components/TriageInbox.jsx');

function warnGroup(actionType, targetPrefix, count = 10) {
  return {
    shape: {
      action_type: actionType,
      target_prefix: targetPrefix,
      key: `${actionType}::${targetPrefix ?? ''}`,
      label: targetPrefix ? `${actionType} → ${targetPrefix}` : actionType,
    },
    count,
    latest_at: new Date().toISOString(),
    sample_id: `gd_${actionType}`,
    sample_goal: `Bash: echo hi`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  postVerdict.mockResolvedValue({ ok: true });
});

describe('TriageInbox — warn groups with no target scope', () => {
  it('does NOT offer "Always allow" on a shape the server would reject', async () => {
    fetchReview.mockResolvedValue({
      groups: [warnGroup('api', null, 236)],
      interrupts: [],
      cursor: new Date().toISOString(),
    });

    render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/Agents keep tripping the warn on/);

    expect(screen.queryByRole('button', { name: /^Always allow/i })).toBeNull();
  });

  it('makes "Mark fine" the primary action on an unscoped shape', async () => {
    fetchReview.mockResolvedValue({
      groups: [warnGroup('api', null, 236)],
      interrupts: [],
      cursor: new Date().toISOString(),
    });

    render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/Agents keep tripping the warn on/);

    // Present and reachable without opening the caret menu.
    expect(screen.getByRole('button', { name: /^Mark fine/i })).toBeTruthy();
  });

  it('explains why the grant is unavailable, before the click', async () => {
    fetchReview.mockResolvedValue({
      groups: [warnGroup('api', null, 236)],
      interrupts: [],
      cursor: new Date().toISOString(),
    });

    render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/Agents keep tripping the warn on/);

    expect(screen.getByText(/no target scope/i)).toBeTruthy();
  });

  it('still offers "Always allow" when the shape IS scoped', async () => {
    fetchReview.mockResolvedValue({
      groups: [warnGroup('api', 'api.stripe.com', 12)],
      interrupts: [],
      cursor: new Date().toISOString(),
    });

    render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/Agents keep tripping the warn on/);

    expect(screen.getByRole('button', { name: /^Always allow/i })).toBeTruthy();
    expect(screen.queryByText(/no target scope/i)).toBeNull();
  });

  it('shows the right verb per row when scoped and unscoped groups are mixed', async () => {
    fetchReview.mockResolvedValue({
      groups: [warnGroup('api', null, 236), warnGroup('write_file', 'app/secrets/', 4)],
      interrupts: [],
      cursor: new Date().toISOString(),
    });

    render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/write_file/);

    // Exactly one grantable row => exactly one "Always allow".
    expect(screen.getAllByRole('button', { name: /^Always allow/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Mark fine/i })).toHaveLength(1);
  });
});

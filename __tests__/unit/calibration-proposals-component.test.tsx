// CalibrationProposals section (owner roadmap v2.6b) — /policies cockpit.
// Spec: docs/superpowers/specs/2026-07-02-calibration-proposals-human-surface-design.md
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const {
  mockFetchCalibrationProposals,
  mockRatifyProposal,
  mockDismissCalibrationProposal,
  mockUndoCalibrationDecision,
} = vi.hoisted(() => ({
  mockFetchCalibrationProposals: vi.fn(),
  mockRatifyProposal: vi.fn(),
  mockDismissCalibrationProposal: vi.fn(),
  mockUndoCalibrationDecision: vi.fn(),
}));

vi.mock('@/policies/lib/calibrationClient', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchCalibrationProposals: mockFetchCalibrationProposals,
    ratifyProposal: mockRatifyProposal,
    dismissCalibrationProposal: mockDismissCalibrationProposal,
    undoCalibrationDecision: mockUndoCalibrationDecision,
  };
});

import CalibrationProposals from '@/policies/components/CalibrationProposals';

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: 'cv_0123456789abcdef',
    rule: 'over_scored_benign',
    suggested_label: 'benign',
    suggested_name: 'git-status',
    evidence_tier: 'human_approved',
    count: 4,
    risk_min: 55,
    risk_max: 75,
    event_ids: ['gd_1'],
    representative: { action_type: 'bash.command', command_shape: 'git status' },
    provenance: 'mined 2026-07-02 (window 30d): over_scored_benign cv_0123456789abcdef, 4 event(s), tier human_approved',
    ratify_command: 'npm run calibration:add -- --action act_1 --label benign --name git-status --source "x"',
    needs_manual_context: false,
    status: 'pending',
    decision: null,
    ...overrides,
  };
}

function payload(proposals: unknown[] = [proposal()]) {
  return {
    window_days: 30,
    inputs: { decisions: 10, decisions_truncated_at_limit: false, uploaded_samples: 0, synthetic_excluded: 2 },
    proposals,
    counts: { pending: proposals.length, ratified: 0, dismissed: 0, forged: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchCalibrationProposals.mockResolvedValue(payload());
  mockRatifyProposal.mockResolvedValue(undefined);
  mockDismissCalibrationProposal.mockResolvedValue(undefined);
  mockUndoCalibrationDecision.mockResolvedValue(undefined);
});

describe('CalibrationProposals', () => {
  it('renders an evidence card with shape, evidence, and provenance', async () => {
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByText('Calibration proposals'));
    screen.getByText('Over-scored benign');
    screen.getByText('git status');
    screen.getByText(/4 events · tier human approved · risk 55–75/);
    screen.getByText(/mined 2026-07-02/);
  });

  it('ratify is a two-click armed flow that posts the judgment', async () => {
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByRole('button', { name: /^Ratify:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ratify:/ }));
    // Armed: consequence line + confirm.
    screen.getByText(/Records your ratification/);
    expect(mockRatifyProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Confirm ratify/ }));
    expect(mockRatifyProposal).toHaveBeenCalledTimes(1);
    await waitFor(() => screen.getByText(/Ratified — queued for the maintainer forge/));
    screen.getByRole('button', { name: /Undo ratify/ });
  });

  it('dismiss requires a reason before confirm enables', async () => {
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByRole('button', { name: /^Dismiss:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss:/ }));
    const confirm = screen.getByRole('button', { name: /Confirm dismiss/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Reason (required)'), {
      target: { value: 'smoke noise' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(mockDismissCalibrationProposal).toHaveBeenCalledWith(
      expect.objectContaining({ candidate_id: 'cv_0123456789abcdef' }),
      'smoke noise',
    );
    await waitFor(() => screen.getByText('Dismissed.'));
  });

  it('a persisted ratified proposal renders the queued strip; forged shows the vector, no Undo', async () => {
    mockFetchCalibrationProposals.mockResolvedValue(
      payload([
        proposal({
          status: 'ratified',
          decision: { decision: 'ratified', reason: null, decided_by: 'u1', decided_at: 'x', forged_at: null, vector_name: null },
        }),
        proposal({
          candidate_id: 'cv_feedfeedfeedfeed',
          status: 'forged',
          decision: { decision: 'ratified', reason: null, decided_by: 'u1', decided_at: 'x', forged_at: 'y', vector_name: 'git-status' },
        }),
      ]),
    );
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByText(/Ratified — queued for the maintainer forge/));
    screen.getByText(/In corpus as/);
    expect(screen.getAllByRole('button', { name: /Undo/ })).toHaveLength(1);
  });

  it('undo returns the row to pending without a reload', async () => {
    mockFetchCalibrationProposals.mockResolvedValue(
      payload([
        proposal({
          status: 'dismissed',
          decision: { decision: 'dismissed', reason: 'noise', decided_by: 'u1', decided_at: 'x', forged_at: null, vector_name: null },
        }),
      ]),
    );
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByText('Dismissed.'));
    fireEvent.click(screen.getByRole('button', { name: /Undo dismiss/ }));
    await waitFor(() => screen.getByRole('button', { name: /^Ratify:/ }));
    expect(mockUndoCalibrationDecision).toHaveBeenCalledWith('cv_0123456789abcdef');
    expect(mockFetchCalibrationProposals).toHaveBeenCalledTimes(1); // no reload
  });

  it('failed ratify rolls the row back and shows the error', async () => {
    mockRatifyProposal.mockRejectedValue(new Error('Admin access required'));
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByRole('button', { name: /^Ratify:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ratify:/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm ratify/ }));
    await waitFor(() => screen.getByRole('alert'));
    screen.getByText('Admin access required');
    screen.getByRole('button', { name: /^Ratify:/ }); // back to pending
  });

  it('load failure shows the error state with Retry', async () => {
    mockFetchCalibrationProposals.mockRejectedValue(new Error('boom'));
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByText(/Couldn't load calibration proposals/));
    screen.getByRole('button', { name: /Retry/ });
  });

  it('empty window renders the calm empty state', async () => {
    mockFetchCalibrationProposals.mockResolvedValue(payload([]));
    render(<CalibrationProposals />);
    await waitFor(() => screen.getByText(/No calibration proposals in the last 30 days/));
  });
});

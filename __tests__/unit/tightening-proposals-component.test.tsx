// TighteningProposals section (owner roadmap v3.2) — /policies cockpit.
// Spec: docs/superpowers/specs/2026-07-03-findings-become-proposals-design.md
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const {
  mockFetchTighteningProposals,
  mockRatifyTighteningProposal,
  mockDismissTighteningProposal,
  mockUndoTighteningDecision,
} = vi.hoisted(() => ({
  mockFetchTighteningProposals: vi.fn(),
  mockRatifyTighteningProposal: vi.fn(),
  mockDismissTighteningProposal: vi.fn(),
  mockUndoTighteningDecision: vi.fn(),
}));

vi.mock('@/policies/lib/tighteningClient', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchTighteningProposals: mockFetchTighteningProposals,
    ratifyTighteningProposal: mockRatifyTighteningProposal,
    dismissTighteningProposal: mockDismissTighteningProposal,
    undoTighteningDecision: mockUndoTighteningDecision,
  };
});

import TighteningProposals from '@/policies/components/TighteningProposals';

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tp_0123456789abcdef',
    rule: 'govern_ungoverned_allow',
    action_type: 'deploy',
    risk_level: 'high',
    finding_key: 'abcd1234',
    title: 'Govern "deploy" (high-risk allows)',
    summary: '5 ungoverned high-risk "deploy" actions reached allow in the last 7 days',
    evidence: { window_days: 7, observed_count: 5, risk_min: 55, risk_max: 70, example_decision_ids: ['act_gd_1'] },
    patch: { name: '[Tightened] deploy', policy_type: 'require_approval', rules: { action_types: ['deploy'], _tightened: true } },
    status: 'pending',
    decision: null,
    ...overrides,
  };
}

function payload(proposals: unknown[] = [proposal()]) {
  return {
    window_days: 7,
    min_observed: 3,
    synthetic_included: false,
    inputs: { decisions: 12 },
    proposals,
    counts: { pending: proposals.length, ratified: 0, dismissed: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchTighteningProposals.mockResolvedValue(payload());
  mockRatifyTighteningProposal.mockResolvedValue({ policy_id: 'gp_42' });
  mockDismissTighteningProposal.mockResolvedValue(undefined);
  mockUndoTighteningDecision.mockResolvedValue(undefined);
});

describe('TighteningProposals', () => {
  it('renders a proposal with its title and Ratify…/Dismiss… buttons', async () => {
    render(<TighteningProposals />);
    await waitFor(() => screen.getByText('Tightening proposals'));
    screen.getByText('Govern "deploy" (high-risk allows)');
    screen.getByRole('button', { name: /^Ratify:/ });
    screen.getByRole('button', { name: /^Dismiss:/ });
  });

  it('ratify is a two-click armed flow: Ratify… shows consequence text, then Confirm — create policy posts it', async () => {
    render(<TighteningProposals />);
    await waitFor(() => screen.getByRole('button', { name: /^Ratify:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ratify:/ }));
    screen.getByText(/Creates an ACTIVE policy/);
    expect(mockRatifyTighteningProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Confirm ratify for/ }));
    expect(mockRatifyTighteningProposal).toHaveBeenCalledTimes(1);
    await waitFor(() => screen.getByText(/Policy created/));
    screen.getByText(/gp_42/);
    screen.getByRole('button', { name: /Undo ratify/ });
  });

  it('dismiss requires a reason before Confirm enables', async () => {
    render(<TighteningProposals />);
    await waitFor(() => screen.getByRole('button', { name: /^Dismiss:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss:/ }));
    const confirm = screen.getByRole('button', { name: /Confirm dismiss/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Reason (required)'), {
      target: { value: 'known-safe pattern' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(mockDismissTighteningProposal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tp_0123456789abcdef' }),
      'known-safe pattern',
    );
    await waitFor(() => screen.getByText(/stops re-proposing/));
  });

  it('a persisted ratified proposal renders the strip with the policy id and Undo', async () => {
    mockFetchTighteningProposals.mockResolvedValue(
      payload([
        proposal({
          status: 'ratified',
          decision: { decision: 'ratified', reason: null, decided_by: 'u1', decided_at: 'x', policy_id: 'gp_99' },
        }),
      ]),
    );
    render(<TighteningProposals />);
    await waitFor(() => screen.getByText(/Policy created/));
    screen.getByText('gp_99');
    screen.getByRole('button', { name: /Undo ratify/ });
  });

  it('load failure shows the error state with Retry', async () => {
    mockFetchTighteningProposals.mockRejectedValue(new Error('boom'));
    render(<TighteningProposals />);
    await waitFor(() => screen.getByText(/Couldn't load tightening proposals/));
    screen.getByRole('button', { name: /Retry/ });
  });

  it('empty window renders the calm empty-state message', async () => {
    mockFetchTighteningProposals.mockResolvedValue(payload([]));
    render(<TighteningProposals />);
    await waitFor(() => screen.getByText(/No ungoverned high-risk patterns in the last 7 days/));
  });
});

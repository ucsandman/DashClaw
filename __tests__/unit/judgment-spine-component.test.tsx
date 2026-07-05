// JudgmentSpine — the unified proposal queue (owner roadmap v4.4).
// Spec: docs/superpowers/specs/2026-07-04-one-judgment-spine.md
// One section on /policies subsuming the tuning, tightening, calibration, and
// behavior queues under one decision grammar; decisions dispatch through each
// engine's existing client lib.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({
  // tuning
  fetchProposals: vi.fn(),
  acceptProposal: vi.fn(),
  dismissProposal: vi.fn(),
  undismissProposal: vi.fn(),
  // tightening
  fetchTighteningProposals: vi.fn(),
  ratifyTighteningProposal: vi.fn(),
  dismissTighteningProposal: vi.fn(),
  undoTighteningDecision: vi.fn(),
  // calibration
  fetchCalibrationProposals: vi.fn(),
  ratifyProposal: vi.fn(),
  dismissCalibrationProposal: vi.fn(),
  undoCalibrationDecision: vi.fn(),
  // behavior
  fetchBehaviorSuggestions: vi.fn(),
  simulateBehaviorSuggestion: vi.fn(),
  adoptBehaviorSuggestion: vi.fn(),
  dismissBehaviorSuggestion: vi.fn(),
  undoBehaviorSuggestion: vi.fn(),
}));

vi.mock('@/policies/lib/proposalsClient', () => ({
  fetchProposals: m.fetchProposals,
  acceptProposal: m.acceptProposal,
  dismissProposal: m.dismissProposal,
  undismissProposal: m.undismissProposal,
}));
vi.mock('@/policies/lib/tighteningClient', () => ({
  fetchTighteningProposals: m.fetchTighteningProposals,
  ratifyTighteningProposal: m.ratifyTighteningProposal,
  dismissTighteningProposal: m.dismissTighteningProposal,
  undoTighteningDecision: m.undoTighteningDecision,
}));
vi.mock('@/policies/lib/calibrationClient', () => ({
  fetchCalibrationProposals: m.fetchCalibrationProposals,
  ratifyProposal: m.ratifyProposal,
  dismissCalibrationProposal: m.dismissCalibrationProposal,
  undoCalibrationDecision: m.undoCalibrationDecision,
}));
vi.mock('@/policies/lib/behaviorClient', () => ({
  fetchBehaviorSuggestions: m.fetchBehaviorSuggestions,
  simulateBehaviorSuggestion: m.simulateBehaviorSuggestion,
  adoptBehaviorSuggestion: m.adoptBehaviorSuggestion,
  dismissBehaviorSuggestion: m.dismissBehaviorSuggestion,
  undoBehaviorSuggestion: m.undoBehaviorSuggestion,
}));

import JudgmentSpine from '@/policies/components/JudgmentSpine';

function tuningProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop_tune_1',
    rule: 'raise_risk_threshold',
    title: 'Loosen deploy approvals',
    summary: 'Deploys are approved every time — raise the threshold.',
    policy_id: 'gp_deploy',
    policy_name: 'Deploy guard',
    patch: { rules: { threshold: 80 } },
    evidence: { fired: { require_approval: 12 }, approvals: { approved: 12, denied: 0 }, approved_risk_scores: null },
    ...overrides,
  };
}

function tuningPayload(proposals: unknown[] = [tuningProposal()]) {
  return {
    window_days: 7,
    policies: [{ policy_id: 'gp_deploy', name: 'Deploy guard' }],
    proposals,
    dismissed_count: 0,
  };
}

function tighteningProposal(overrides: Record<string, unknown> = {}) {
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

function tighteningPayload(proposals: unknown[] = [tighteningProposal()]) {
  return {
    window_days: 7,
    min_observed: 3,
    synthetic_included: false,
    inputs: { decisions: 12 },
    proposals,
    counts: { pending: proposals.length, ratified: 0, dismissed: 0 },
  };
}

function calibrationProposal(overrides: Record<string, unknown> = {}) {
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
    provenance: 'mined 2026-07-02 (window 30d): over_scored_benign',
    ratify_command: 'npm run calibration:add -- --name git-status',
    needs_manual_context: false,
    status: 'pending',
    decision: null,
    ...overrides,
  };
}

function calibrationPayload(proposals: unknown[] = [calibrationProposal()]) {
  return {
    window_days: 30,
    inputs: { decisions: 10, decisions_truncated_at_limit: false, uploaded_samples: 0, synthetic_excluded: 2 },
    proposals,
    counts: { pending: proposals.length, ratified: 0, dismissed: 0, forged: 0 },
  };
}

function behaviorSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sug_dc_1',
    type: 'destructive_command_approval',
    agent_id: 'codex-1',
    severity: 'high',
    false_positive_risk: 'low',
    confidence: 82,
    expected_effect: 'Require approval before destructive shell commands.',
    matching_sample_size: 6,
    sample_size: 40,
    target: 'bash',
    advisory: false,
    enforceable: true,
    evidence_examples: [],
    rule: { action: 'require_approval' },
    ...overrides,
  };
}

function behaviorPayload(suggestions: unknown[] = [behaviorSuggestion()]) {
  return { agents: [], suggestions, dismissed: 0, sample_count: 40, sample_source: 'local' };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.fetchProposals.mockResolvedValue(tuningPayload());
  m.acceptProposal.mockResolvedValue(undefined);
  m.dismissProposal.mockResolvedValue(undefined);
  m.undismissProposal.mockResolvedValue(undefined);
  m.fetchTighteningProposals.mockResolvedValue(tighteningPayload());
  m.ratifyTighteningProposal.mockResolvedValue({ policy_id: 'gp_42' });
  m.dismissTighteningProposal.mockResolvedValue(undefined);
  m.undoTighteningDecision.mockResolvedValue(undefined);
  m.fetchCalibrationProposals.mockResolvedValue(calibrationPayload());
  m.ratifyProposal.mockResolvedValue(undefined);
  m.dismissCalibrationProposal.mockResolvedValue(undefined);
  m.undoCalibrationDecision.mockResolvedValue(undefined);
  m.fetchBehaviorSuggestions.mockResolvedValue(behaviorPayload());
  m.simulateBehaviorSuggestion.mockResolvedValue({ total: 40, allow: 34, warn: 0, require_approval: 6, block: 0, likely_false_positives: 0 });
  m.adoptBehaviorSuggestion.mockResolvedValue({ adopted: true, advisory: false, note: 'Draft policy created (inactive).' });
  m.dismissBehaviorSuggestion.mockResolvedValue(undefined);
  m.undoBehaviorSuggestion.mockResolvedValue({ ok: true, suggestion_id: 'sug_dc_1', removed: true, policy_kept: true });
});

describe('JudgmentSpine', () => {
  it('renders one row from every queue', async () => {
    render(<JudgmentSpine />);
    await waitFor(() => screen.getByText('Loosen deploy approvals'));
    screen.getByText('Govern "deploy" (high-risk allows)');
    screen.getByText('Over-scored benign');
    screen.getByText('Destructive commands → approval');
  });

  it('tightening ratify is an armed two-click that dispatches through the client lib', async () => {
    render(<JudgmentSpine />);
    await waitFor(() => screen.getByRole('button', { name: 'Ratify: Govern "deploy" (high-risk allows)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ratify: Govern "deploy" (high-risk allows)' }));
    screen.getByText(/Creates an ACTIVE policy/);
    expect(m.ratifyTighteningProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Ratify for Govern "deploy" (high-risk allows)' }));
    expect(m.ratifyTighteningProposal).toHaveBeenCalledTimes(1);
    await waitFor(() => screen.getByText(/Policy created/));
    screen.getByText('gp_42');
  });

  it('calibration dismiss requires a reason before Confirm enables', async () => {
    render(<JudgmentSpine />);
    await waitFor(() => screen.getByRole('button', { name: 'Dismiss: Over-scored benign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Over-scored benign' }));
    const confirm = screen.getByRole('button', { name: 'Confirm dismiss for Over-scored benign' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for dismissing Over-scored benign'), {
      target: { value: 'smoke noise' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(m.dismissCalibrationProposal).toHaveBeenCalledWith(
      expect.objectContaining({ candidate_id: 'cv_0123456789abcdef' }),
      'smoke noise',
    );
    await waitFor(() => screen.getByText('Dismissed.'));
  });

  it('behavior adopt is disabled until a simulation resolves, then enabled', async () => {
    render(<JudgmentSpine />);
    const adoptName = 'Adopt as draft: Destructive commands → approval · codex-1';
    await waitFor(() => screen.getByRole('button', { name: adoptName }));
    expect((screen.getByRole('button', { name: adoptName }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Simulate: Destructive commands → approval · codex-1' }));
    expect(m.simulateBehaviorSuggestion).toHaveBeenCalledWith('sug_dc_1');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: adoptName }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('behavior undo dispatches through the client lib (POST action:undo)', async () => {
    render(<JudgmentSpine />);
    const title = 'Destructive commands → approval · codex-1';
    await waitFor(() => screen.getByRole('button', { name: `Dismiss: ${title}` }));
    fireEvent.click(screen.getByRole('button', { name: `Dismiss: ${title}` }));
    fireEvent.click(screen.getByRole('button', { name: `Confirm dismiss for ${title}` }));
    await waitFor(() => screen.getByRole('button', { name: `Undo dismiss for ${title}` }));
    fireEvent.click(screen.getByRole('button', { name: `Undo dismiss for ${title}` }));
    expect(m.undoBehaviorSuggestion).toHaveBeenCalledWith('sug_dc_1');
  });

  it('renders a calm empty state per queue', async () => {
    m.fetchProposals.mockResolvedValue(tuningPayload([]));
    m.fetchTighteningProposals.mockResolvedValue(tighteningPayload([]));
    m.fetchCalibrationProposals.mockResolvedValue(calibrationPayload([]));
    m.fetchBehaviorSuggestions.mockResolvedValue(behaviorPayload([]));
    render(<JudgmentSpine />);
    await waitFor(() => screen.getByText(/No pending tuning/));
    screen.getByText(/No ungoverned high-risk patterns in the last 7 days/);
    screen.getByText(/No pending calibration in the last 30 days/);
    screen.getByText(/No pending behavior suggestions/);
  });
});

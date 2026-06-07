import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ role: { isAdmin: true, settled: true } }));
vi.mock('@/hooks/useEffectiveRole', () => ({ useEffectiveRole: () => h.role }));

vi.mock('@/policies/lib/modesClient', () => ({
  fetchModes: vi.fn(),
  previewMode: vi.fn(),
  importMode: vi.fn(),
}));

// Controllable scope picker: one click narrows scope to a single agent.
vi.mock('@/policies/components/AgentScopePicker', () => ({
  default: ({ agentIds = [], onChange }) => (
    <button type="button" data-testid="pick-agent" onClick={() => onChange(['agent_1'])}>
      scope:{agentIds.length ? agentIds.join(',') : 'all'}
    </button>
  ),
}));

import ModeApply from '@/policies/components/ModeApply.jsx';
import { fetchModes, previewMode, importMode } from '@/policies/lib/modesClient';

const MODES = [
  { id: 'claude-code', name: 'Claude Code Mode', purpose: 'p', description: 'd', interruptionLevel: 'low', uxPromise: 'stays out of the way', allows: [], warns: [], requiresApproval: [], blocks: [], toolVisibilityNotes: [], policy_count: 9 },
  { id: 'soc2', name: 'SOC 2 Mode', purpose: 'p', description: 'd', interruptionLevel: 'high', uxPromise: 'audit-ready', allows: [], warns: [], requiresApproval: [], blocks: [], toolVisibilityNotes: [], policy_count: 5 },
];

const PREVIEW = {
  mode: {
    id: 'claude-code', name: 'Claude Code Mode', purpose: 'p', description: 'Governs a Claude Code agent.',
    interruptionLevel: 'low', uxPromise: 'stays out of the way',
    allows: ['Read & edit files'], warns: ['High-risk actions'], requiresApproval: ['Deploys'], blocks: ['Extreme-risk actions'], toolVisibilityNotes: [],
  },
  policies: [
    { name: '[Claude Code Mode] Warn on high-risk actions', policy_type: 'risk_threshold', decision: 'warn', rules: { threshold: 85, action: 'warn', _mode: 'claude-code' } },
    { name: '[Claude Code Mode] Gate paid (x402) spend', policy_type: 'x402_spend_limit', decision: 'require_approval', rules: { approval_threshold: 0.01, max_spend_usd: 0.1, _mode: 'claude-code' } },
  ],
  summary: { total: 9, warn: 2, require_approval: 6, block: 1 },
  friction: { available: true, sample_size: 120, window_days: 7, summary: { total: 120, allow: 100, warn: 12, require_approval: 6, block: 2 }, excluded_policy_types: ['rate_limit'] },
};

const IMPORT_RESULT = {
  mode_id: 'claude-code', imported: 9, skipped: 0, errors: [],
  policies: [
    { id: 'gp_risk', name: '[Claude Code Mode] Warn on high-risk actions', policy_type: 'risk_threshold', active: 1 },
    { id: 'gp_x402', name: '[Claude Code Mode] Gate paid (x402) spend', policy_type: 'x402_spend_limit', active: 1 },
  ],
};

// Find a PATCH /api/policies call whose parsed body satisfies the predicate.
// Robust against JSON-string escaping of nested `rules`/`agent_ids`.
function findPatch(predicate) {
  return global.fetch.mock.calls.find(([, init]) => {
    if (init?.method !== 'PATCH') return false;
    try { return predicate(JSON.parse(init.body)); } catch { return false; }
  });
}

describe('ModeApply', () => {
  beforeEach(() => {
    h.role = { isAdmin: true, settled: true };
    vi.mocked(fetchModes).mockResolvedValue(MODES);
    vi.mocked(previewMode).mockResolvedValue(PREVIEW);
    vi.mocked(importMode).mockResolvedValue(IMPORT_RESULT);
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => { vi.clearAllMocks(); });

  it('recommends Claude Code Mode and shows its compiled behavior', async () => {
    render(<ModeApply />);
    expect(await screen.findByRole('heading', { name: 'Claude Code Mode' })).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
    expect(screen.getByText('What this mode enforces')).toBeTruthy();
    // Behavior buckets, drawn from the compiled mode.
    expect(screen.getByText('Read & edit files')).toBeTruthy();
    expect(screen.getByText('Extreme-risk actions')).toBeTruthy();
  });

  it('shows the interruption forecast from real friction history', async () => {
    render(<ModeApply />);
    expect(await screen.findByText('Interruption forecast')).toBeTruthy();
    // warn(12) + require_approval(6) = 18 paused of 120 sampled.
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText(/Excluded \(not deterministically simulable\)/)).toBeTruthy();
  });

  it('shows an honest message when there is no forecast history yet', async () => {
    vi.mocked(previewMode).mockResolvedValue({ ...PREVIEW, friction: { available: false, reason: 'No recent action history to simulate against yet.' } });
    render(<ModeApply />);
    expect(await screen.findByText(/No interruption forecast yet/)).toBeTruthy();
  });

  it('applies the mode in a single action', async () => {
    const onApplied = vi.fn();
    render(<ModeApply onApplied={onApplied} />);
    await screen.findByText('Interruption forecast'); // gate on preview load
    fireEvent.click(screen.getByRole('button', { name: /Apply Claude Code Mode/ }));
    await waitFor(() => expect(vi.mocked(importMode)).toHaveBeenCalledWith('claude-code'));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(screen.getByText(/9 applied/)).toBeTruthy();
    // No scope/cap change → no follow-up PATCH calls.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('narrows scope with a PATCH when specific agents are chosen', async () => {
    render(<ModeApply />);
    await screen.findByLabelText('Spend cap (paid actions)'); // gate on preview load
    fireEvent.click(screen.getByTestId('pick-agent'));
    fireEvent.click(screen.getByRole('button', { name: /Apply Claude Code Mode/ }));
    await waitFor(() => expect(vi.mocked(importMode)).toHaveBeenCalled());
    await waitFor(() => {
      expect(findPatch((b) => String(b.agent_ids).includes('agent_1'))).toBeTruthy();
    });
  });

  it('overrides the spend cap with a PATCH when the value changes', async () => {
    render(<ModeApply />);
    const cap = await screen.findByLabelText('Spend cap (paid actions)');
    fireEvent.change(cap, { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply Claude Code Mode/ }));
    await waitFor(() => {
      expect(findPatch((b) => JSON.parse(b.rules).max_spend_usd === 0.5)).toBeTruthy();
    });
  });

  it('blocks apply for non-admin viewers', async () => {
    h.role = { isAdmin: false, settled: true };
    render(<ModeApply />);
    const apply = await screen.findByRole('button', { name: /Apply Claude Code Mode/ });
    expect(apply.disabled).toBe(true);
    expect(screen.getByText('Admin access required to apply a mode.')).toBeTruthy();
  });
});

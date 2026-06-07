import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// ModeApply has its own suite; here it is a marker behind the change-mode action.
vi.mock('@/policies/components/ModeApply', () => ({
  default: ({ defaultModeId }) => <div data-testid="mode-apply">apply:{defaultModeId}</div>,
  RECOMMENDED_MODE_ID: 'claude-code',
}));
vi.mock('@/policies/components/AdvancedSection', () => ({
  default: () => <div data-testid="advanced">advanced</div>,
}));

import PolicyConsole from '@/policies/components/PolicyConsole.jsx';

const POLICIES = [
  { id: 'p1', name: '[Claude Code Mode] Block', policy_type: 'risk_threshold', rules: '{"_mode":"claude-code"}', active: 1, agent_ids: null },
  { id: 'p2', name: '[Claude Code Mode] Warn', policy_type: 'risk_threshold', rules: '{"_mode":"claude-code"}', active: 1, agent_ids: null },
  { id: 'p3', name: 'My custom rule', policy_type: 'block_action_type', rules: '{"action_types":["x"]}', active: 1, agent_ids: null },
  { id: 'p4', name: 'inactive mode rule', policy_type: 'risk_threshold', rules: '{"_mode":"claude-code"}', active: 0, agent_ids: null },
];

describe('PolicyConsole', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/agents') return { ok: true, json: async () => ({ agents: [] }) };
      if (String(url).startsWith('/api/guard/decisions')) return { ok: true, json: async () => ({ stats: { blocks: 4, approvals: 2 } }) };
      return { ok: true, json: async () => ({}) };
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('summarizes which modes and policies govern the agents', () => {
    render(<PolicyConsole policies={POLICIES} onApplied={vi.fn()} />);
    expect(screen.getByText('What is governing your agents')).toBeTruthy();
    // Two active claude-code policies group under the mode name.
    expect(screen.getByText('Claude Code Mode')).toBeTruthy();
    expect(screen.getByText('2 rules')).toBeTruthy();
    // The one non-mode policy groups as Custom; the inactive one is excluded.
    expect(screen.getByText('Custom policies')).toBeTruthy();
    expect(screen.getByText('1 rule')).toBeTruthy();
    // Null agent_ids == all agents.
    expect(screen.getAllByText('All agents').length).toBeGreaterThan(0);
  });

  it('offers change-mode and keeps everything else under Advanced', () => {
    render(<PolicyConsole policies={POLICIES} onApplied={vi.fn()} />);
    expect(screen.getByText('Apply or change a mode')).toBeTruthy();
    expect(screen.getByTestId('advanced')).toBeTruthy();
    // Change-mode surface is disclosed on demand, preselected to the applied mode.
    expect(screen.queryByTestId('mode-apply')).toBeNull();
    fireEvent.click(screen.getByText('Apply or change a mode'));
    expect(screen.getByTestId('mode-apply').textContent).toContain('claude-code');
  });

  it('renders the custom-only case with a nudge to apply a mode', () => {
    const customOnly = [
      { id: 'c1', name: 'Lone rule', policy_type: 'block_action_type', rules: '{}', active: 1, agent_ids: null },
    ];
    render(<PolicyConsole policies={customOnly} onApplied={vi.fn()} />);
    expect(screen.getByText('Custom policies')).toBeTruthy();
    expect(screen.getByText(/No operating mode applied yet/)).toBeTruthy();
  });
});

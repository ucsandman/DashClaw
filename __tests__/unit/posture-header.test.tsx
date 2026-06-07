import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import PostureHeader from '@/policies/components/PostureHeader';

const MODE = { id: 'claude-code', name: 'Claude Code Mode', interruptionLevel: 'low' as const };

describe('PostureHeader', () => {
  it('renders the primary mode name and interruption level', () => {
    render(
      <PostureHeader
        primaryMode={MODE}
        modeCount={1}
        agentsTotal={3}
        pendingApprovals={0}
        scopeLabel="All agents"
        onChangeMode={vi.fn()}
      />,
    );
    expect(screen.getByText('Claude Code Mode')).toBeTruthy();
    expect(screen.getByText(/low interruption/)).toBeTruthy();
    expect(screen.getByText('All agents')).toBeTruthy();
    expect(screen.getByText(/3/)).toBeTruthy();
  });

  it('shows +N when more than one mode is applied', () => {
    render(
      <PostureHeader
        primaryMode={MODE}
        modeCount={3}
        agentsTotal={1}
        pendingApprovals={0}
        scopeLabel="All agents"
        onChangeMode={vi.fn()}
      />,
    );
    expect(screen.getByText(/\+2/)).toBeTruthy();
  });

  it('falls back to "Custom policies" / "—" when no primary mode', () => {
    render(
      <PostureHeader
        primaryMode={null}
        modeCount={0}
        agentsTotal={0}
        pendingApprovals={0}
        scopeLabel="All agents"
        onChangeMode={vi.fn()}
      />,
    );
    expect(screen.getByText('Custom policies')).toBeTruthy();
    expect(screen.getByText(/— interruption/)).toBeTruthy();
  });

  it('calls onChangeMode when Change mode is clicked', () => {
    const onChangeMode = vi.fn();
    render(
      <PostureHeader
        primaryMode={MODE}
        modeCount={1}
        agentsTotal={1}
        pendingApprovals={0}
        scopeLabel="All agents"
        onChangeMode={onChangeMode}
      />,
    );
    fireEvent.click(screen.getByText(/Change mode/));
    expect(onChangeMode).toHaveBeenCalledTimes(1);
  });

  it('uses warning styling for pending approvals when > 0', () => {
    render(
      <PostureHeader
        primaryMode={MODE}
        modeCount={1}
        agentsTotal={1}
        pendingApprovals={4}
        scopeLabel="All agents"
        onChangeMode={vi.fn()}
      />,
    );
    const pending = screen.getByText('4 pending');
    expect(pending.className).toContain('text-warning');
  });

  it('uses tertiary styling for pending approvals when 0', () => {
    render(
      <PostureHeader
        primaryMode={MODE}
        modeCount={1}
        agentsTotal={1}
        pendingApprovals={0}
        scopeLabel="All agents"
        onChangeMode={vi.fn()}
      />,
    );
    const pending = screen.getByText('0 pending');
    expect(pending.className).toContain('text-tertiary');
  });
});

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { PolicyAgentScope, agentNamespace } = await import(
  '@/policies/components/PolicyAuthoringPanel'
);

const agents = [
  { agent_id: 'sparrow', agent_name: 'Sparrow' },
  { agent_id: 'codex/Explore', agent_name: 'codex Explore' },
  { agent_id: 'codex/dashclaw-gate-runner', agent_name: 'gate runner' },
  { agent_id: 'ps-content-draft', agent_name: 'ps-content-draft' },
  { agent_id: 'ps-content-research', agent_name: 'ps-content-research' },
  { agent_id: 'ps-content-outline', agent_name: 'ps-content-outline' },
  { agent_id: 'pico', agent_name: 'pico' },
];

// Render once; `seen` collects the resolved agent-id arrays passed to setAgentIds.
function renderPicker(agentIds: string[] = []) {
  const seen: string[][] = [];
  const setAgentIds = vi.fn((v: string[] | ((prev: string[]) => string[])) => {
    seen.push(typeof v === 'function' ? (v as (p: string[]) => string[])(agentIds) : v);
  });
  const utils = render(<PolicyAgentScope agentIds={agentIds} setAgentIds={setAgentIds} agents={agents} />);
  return { ...utils, setAgentIds, seen };
}

describe('agentNamespace', () => {
  it('groups by the segment before / or -', () => {
    expect(agentNamespace('codex/Explore')).toBe('codex');
    expect(agentNamespace('ps-content-draft')).toBe('ps');
    expect(agentNamespace('sparrow')).toBe('standalone');
    expect(agentNamespace('pico')).toBe('standalone');
  });
});

describe('PolicyAgentScope', () => {
  it('shows All Agents as active when nothing is selected', () => {
    renderPicker();
    expect(screen.getByText('applies to every agent')).toBeTruthy();
  });

  it('renders namespace groups', () => {
    renderPicker();
    expect(screen.getByText('ps')).toBeTruthy();
    expect(screen.getByText('codex')).toBeTruthy();
    expect(screen.getByText('standalone')).toBeTruthy();
  });

  it('filters agents by search query', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search agents'), { target: { value: 'gate' } });
    expect(screen.getByText('gate runner')).toBeTruthy();
    expect(screen.queryByText('ps-content-draft')).toBeNull();
    expect(screen.getByText('1 match')).toBeTruthy();
  });

  it('selecting an agent calls setAgentIds with the id added', () => {
    const { setAgentIds, seen } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Expand codex' }));
    fireEvent.click(screen.getByText('gate runner'));
    expect(setAgentIds).toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual(['codex/dashclaw-gate-runner']);
  });

  it('shows selected agents as removable chips', () => {
    const { seen } = renderPicker(['sparrow']);
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Remove from scope'));
    expect(seen[seen.length - 1]).toEqual([]);
  });

  it('group "all" selects every member of the biggest group', () => {
    const { setAgentIds, seen } = renderPicker();
    // ps has 3 members, strictly the biggest group, so its "all" is first
    // in group order... locate it via the ps group header instead of order.
    const psHeader = screen.getByText('ps').closest('div')!.parentElement!;
    const allBtn = Array.from(psHeader.querySelectorAll('button')).find((b) => b.textContent === 'all')!;
    fireEvent.click(allBtn);
    const last = seen[seen.length - 1]!;
    expect(last).toContain('ps-content-draft');
    expect(last).toContain('ps-content-research');
    expect(last).toContain('ps-content-outline');
    expect(setAgentIds).toHaveBeenCalled();
  });

  it('collapses and expands groups', () => {
    renderPicker();
    // groups start collapsed: members hidden
    expect(screen.queryByText('gate runner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand codex' }));
    expect(screen.getByText('gate runner')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse codex' }));
    expect(screen.queryByText('gate runner')).toBeNull();
  });

  it('shows the empty-agents fallback', () => {
    render(<PolicyAgentScope agentIds={[]} setAgentIds={() => {}} agents={[]} />);
    expect(screen.getByText(/No agents discovered yet/)).toBeTruthy();
  });
});

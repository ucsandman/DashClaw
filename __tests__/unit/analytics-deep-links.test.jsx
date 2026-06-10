import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BreakdownCard from '../../app/analytics/components/BreakdownCard';
import TokenUsage from '../../app/analytics/components/TokenUsage';

// Analytics lists must deep-link: agents → /agents/{id}, action types →
// /decisions?action_type=, enforcement rows → /decisions?decision= (warn
// stays unlinked — no ledger entries exist for warn evaluations).

describe('BreakdownCard — row deep links', () => {
  it('links agent rows to the agent page (encoded id)', () => {
    render(
      <BreakdownCard
        title="By Agent"
        items={[{ agent_name: 'Claude Code', agent_id: 'claude:code/1', cost: 1, pct: 50 }]}
        labelKey="agent_name"
        countLabel="cost"
        hrefFor={(i) => (i.agent_id ? `/agents/${encodeURIComponent(i.agent_id)}` : null)}
      />
    );
    const link = screen.getByRole('link', { name: 'Claude Code' });
    expect(link.getAttribute('href')).toBe('/agents/claude%3Acode%2F1');
  });

  it('links action-type rows into the filtered ledger', () => {
    render(
      <BreakdownCard
        title="By Action Type"
        items={[{ action_type: 'deploy', cost: 2, pct: 30 }]}
        labelKey="action_type"
        countLabel="cost"
        hrefFor={(i) => `/decisions?action_type=${encodeURIComponent(i.action_type)}`}
      />
    );
    expect(screen.getByRole('link', { name: 'deploy' }).getAttribute('href')).toBe('/decisions?action_type=deploy');
  });

  it('links enforcement rows by decision and leaves warn unlinked', () => {
    const items = [
      { label: 'Blocked', decision: 'block', count: 3, pct: 60 },
      { label: 'Warnings', decision: null, count: 2, pct: 40 },
    ];
    render(
      <BreakdownCard
        title="Policy Enforcement"
        items={items}
        labelKey="label"
        countLabel="count"
        hrefFor={(i) => (i.decision ? `/decisions?decision=${encodeURIComponent(i.decision)}` : null)}
      />
    );
    expect(screen.getByRole('link', { name: 'Blocked' }).getAttribute('href')).toBe('/decisions?decision=block');
    // Warn has no destination — plain text, not a dead link.
    expect(screen.queryByRole('link', { name: 'Warnings' })).toBeNull();
    expect(screen.getByText('Warnings')).toBeTruthy();
  });

  it('renders plain labels when no hrefFor is provided (back-compat)', () => {
    render(
      <BreakdownCard title="X" items={[{ label: 'plain', count: 1, pct: 10 }]} labelKey="label" countLabel="count" />
    );
    expect(screen.queryByRole('link', { name: 'plain' })).toBeNull();
  });
});

describe('TokenUsage — top consumers', () => {
  it('wraps consumer names in agent EntityLinks', () => {
    render(
      <TokenUsage
        tokens={{
          total: 1000, total_in: 600, total_out: 400, cost_per_million: 2,
          top_consumers: [{ agent_id: 'claude-code', agent_name: 'Claude Code', total_tokens: 1000, cost: 1, avg_per_action: 10 }],
        }}
      />
    );
    const link = screen.getByRole('link', { name: 'Claude Code' });
    expect(link.getAttribute('href')).toBe('/agents/claude-code');
    expect(link.getAttribute('data-entity-type')).toBe('agent');
  });
});

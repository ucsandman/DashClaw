import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/PageLayout', () => ({ default: ({ children, actions }) => <main>{actions}{children}</main> }));
vi.mock('@/components/ui/Card', () => ({ Card: ({ children }) => <div>{children}</div>, CardContent: ({ children }) => <div>{children}</div> }));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: ({ title, description }) => <div><div>{title}</div><div>{description}</div></div> }));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));
vi.mock('@/hooks/useEffectiveRole', () => ({ useEffectiveRole: () => ({ isAdmin: true, settled: true }) }));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));
vi.mock('@/components/ApprovalPauseBanner', () => ({ default: () => null }));
vi.mock('@/components/ObserveModeBanner', () => ({ default: () => null }));

afterEach(() => { vi.restoreAllMocks(); });

const otherResponse = { ok: true, json: async () => ({}) };

describe('approval queue truth states', () => {
  it('shows loading, never All clear, while the first queue read hangs', async () => {
    global.fetch = vi.fn((url) => String(url).includes('status=pending_approval') ? new Promise(() => {}) : Promise.resolve(otherResponse));
    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);
    expect(screen.getByRole('status').textContent).toContain('Loading approvals');
    expect(screen.queryByText('All clear')).toBeNull();
  });

  it('shows unavailable without reassuring empty copy after a failed first read', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('status=pending_approval')
      ? { ok: false, status: 503, json: async () => ({}) }
      : otherResponse);
    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);
    await screen.findByText('Approval queue unavailable');
    expect(screen.queryByText('All clear')).toBeNull();
  });

  it('preserves the last successful row and renders the canonical redacted act after refresh failure', async () => {
    let pendingReads = 0;
    global.fetch = vi.fn(async (url) => {
      const value = String(url);
      if (value.includes('status=pending_approval')) {
        pendingReads += 1;
        if (pendingReads > 1) return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, json: async () => ({ actions: [{
          action_id: 'act_bound', agent_id: 'agent', declared_goal: 'Publish release', action_type: 'deploy',
          status: 'pending_approval', risk_score: 60, timestamp_start: '2026-09-05T00:00:00Z', systems_touched: '[]',
          act_content_hash: 'sha256:bound', context: { act: { kind: 'shell', command: 'npm run release -- --token [REDACTED]' } },
        }] }) };
      }
      if (value.includes('status=expired')) return { ok: true, json: async () => ({ actions: [] }) };
      return otherResponse;
    });
    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);
    await screen.findByText('Publish release');
    expect(screen.getByText(/Bound act \(redacted\)/i)).toBeTruthy();
    expect(screen.getByText(/npm run release -- --token \[REDACTED\]/)).toBeTruthy();
    expect(screen.getByText('Recorded request')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh pending approvals' }));
    await screen.findByText('Approval queue unavailable');
    expect(screen.getByText('Publish release')).toBeTruthy();
    expect(screen.queryByText('All clear')).toBeNull();
  });
});

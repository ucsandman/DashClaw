import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Pins H3: the Enforcement Evidence tiles must read the keys the
// /api/compliance/evidence route actually returns
// (guard_decisions_total / guard_decisions_blocked / action_records_total).
// Before the fix they read guard_decisions / blocked / actions_recorded and
// rendered the `?? 0` fallback even while enforcement was active.

vi.mock('next/link', () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }));
vi.mock('@/messages/_components/MarkdownBody', () => ({ default: ({ content }) => <div>{content}</div> }));
vi.mock('@/components/PageLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/ProgressBar', () => ({ ProgressBar: () => null }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: ({ title }) => <div>{title}</div> }));
vi.mock('@/components/ui/Skeleton', () => ({ ListSkeleton: () => null }));
vi.mock('@/components/HelpIcon', () => ({ HelpIcon: () => null }));
vi.mock('@/lib/demo/fixtures/help-tips.js', () => ({ HELP_TIPS: {} }));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));

const { default: CompliancePage } = await import('@/compliance/page.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

function mockFetch(evidence) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u === '/api/compliance/frameworks') return { ok: true, json: async () => ({ frameworks: [{ id: 'soc2' }] }) };
    if (u.startsWith('/api/compliance/map')) return { ok: true, json: async () => ({ controls: [], coverage: {} }) };
    if (u.startsWith('/api/compliance/gaps')) return { ok: true, json: async () => ({ gaps: [], remediations: [], risk_level: 'low' }) };
    if (u.startsWith('/api/compliance/evidence')) return { ok: true, json: async () => ({ evidence }) };
    if (u === '/api/policies/summary') return { ok: true, json: async () => ({ modes: [] }) };
    if (u === '/api/actions/signals') return { ok: true, json: async () => ({ signals: [] }) };
    return { ok: true, json: async () => ({}) };
  });
}

describe('CompliancePage — enforcement evidence tiles', () => {
  it('renders the live values from the corrected evidence keys', async () => {
    vi.stubGlobal('fetch', mockFetch({
      guard_decisions_total: 15,
      guard_decisions_blocked: 3,
      approval_requests: 2,
      action_records_total: 8,
    }));

    render(<CompliancePage />);

    // Each value belongs to a corrected key; pre-fix these tiles showed 0.
    expect(await screen.findByText('15')).toBeTruthy(); // guard_decisions_total
    expect(screen.getByText('8')).toBeTruthy();          // action_records_total
    expect(screen.getByText('3')).toBeTruthy();          // guard_decisions_blocked
    expect(screen.getByText('Guard decisions')).toBeTruthy();
    expect(screen.getByText('Actions recorded')).toBeTruthy();
  });
});

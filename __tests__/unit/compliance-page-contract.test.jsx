import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// A5: the compliance page must read the shapes the API actually returns:
// /api/compliance/map -> { summary: { total_controls, covered, partial, gaps, coverage_percentage }, controls:[{ control_id, status, gap_recommendations }] }
// /api/compliance/gaps -> { remediation_plan:[{ status, title, estimated_effort }], quick_wins:[...], risk_assessment:{ overall_risk(UPPERCASE), narrative } }
// Pre-fix it read coverage.*, gapAnalysis.gaps/remediations/risk_level/narrative and rendered zeros / 'unknown'.

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

const MAP = {
  summary: { total_controls: 10, covered: 6, partial: 2, gaps: 2, coverage_percentage: 70 },
  controls: [
    { control_id: 'CC6.1', title: 'Logical Access', status: 'gap', gap_recommendations: ['Add a block policy for shell'], matched_policies: [] },
  ],
};
const GAPS = {
  remediation_plan: [
    { priority: 1, control_id: 'CC6.1', title: 'Restrict shell access', status: 'gap', recommendations: ['Add policy'], estimated_effort: '1-2 hours' },
  ],
  quick_wins: [
    { control_id: 'CC7.2', title: 'Enable anomaly logging', estimated_effort: '1-2 hours' },
  ],
  risk_assessment: { overall_risk: 'HIGH', narrative: 'Significant control gaps remain.', immediate_actions: [] },
};

function mockFetch() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u === '/api/compliance/frameworks') return { ok: true, json: async () => ({ frameworks: [{ id: 'soc2' }] }) };
    if (u.startsWith('/api/compliance/map')) return { ok: true, json: async () => MAP };
    if (u.startsWith('/api/compliance/gaps')) return { ok: true, json: async () => GAPS };
    if (u.startsWith('/api/compliance/evidence')) return { ok: true, json: async () => ({ evidence: { guard_decisions_total: 0, guard_decisions_blocked: 0, approval_requests: 0, action_records_total: 0 } }) };
    if (u === '/api/policies/summary') return { ok: true, json: async () => ({ modes: [] }) };
    if (u === '/api/actions/signals') return { ok: true, json: async () => ({ signals: [] }) };
    return { ok: true, json: async () => ({}) };
  });
}

describe('CompliancePage — reads the real API contract shapes (A5)', () => {
  it('renders coverage from summary, risk from risk_assessment, and remediation/quick-win lists', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<CompliancePage />);

    // Coverage comes from summary.coverage_percentage / summary.* (pre-fix: 0).
    expect(await screen.findByText('70%')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy(); // covered

    // Risk badge from risk_assessment.overall_risk (UPPERCASE), narrative from risk_assessment.narrative.
    expect(screen.getByText('HIGH')).toBeTruthy();
    expect(screen.getByText('Significant control gaps remain.')).toBeTruthy();

    // Remediation plan title + estimated_effort, and quick wins as a list.
    // A gap-status item appears in both "Critical gaps" and "Top remediations", so match all.
    expect(screen.getAllByText('Restrict shell access').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1-2 hours').length).toBeGreaterThan(0);
    expect(screen.getByText('Enable anomaly logging')).toBeTruthy();
  });
});

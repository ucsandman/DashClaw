import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// P13: the two navigation fixes on the compliance cockpit.
// 1) "Create policy from this gap" must target /policies/rules?prefill= —
//    the ONLY surface that mounts the prefill handler (CustomTab). The old
//    /policies?prefill= link silently dropped the draft (PolicyCockpit reads
//    only ?policy=).
// 2) The sidebar "Compliance" entry must land on the map page (/compliance),
//    not bury it behind the exports sub-page.

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
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

// A gap control whose policy_mappings produce a draftable policy
// (block + concrete tool patterns → block_action_type).
const GAP_CONTROL = {
  control_id: 'CC6.1',
  title: 'Logical Access',
  status: 'gap',
  gap_recommendations: [],
  matched_policies: [],
  policy_mappings: [{ policy_pattern: 'block', tool_patterns: ['exec'] }],
};

function mockFetch() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u === '/api/compliance/frameworks') return { ok: true, json: async () => ({ frameworks: [{ id: 'soc2' }] }) };
    if (u.startsWith('/api/compliance/map')) return { ok: true, json: async () => ({ summary: {}, controls: [GAP_CONTROL] }) };
    if (u.startsWith('/api/compliance/gaps')) return { ok: true, json: async () => ({ remediation_plan: [], quick_wins: [], risk_assessment: {} }) };
    if (u.startsWith('/api/compliance/evidence')) return { ok: true, json: async () => ({ evidence: { breakdown: [] } }) };
    if (u === '/api/policies/summary') return { ok: true, json: async () => ({ modes: [] }) };
    return { ok: true, json: async () => ({ signals: [] }) };
  });
}

describe('gap → policy bridge link target', () => {
  it('links the gap draft to /policies/rules?prefill= (the surface that mounts the handler)', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<CompliancePage />);

    // Expand the gap control to reveal the bridge link.
    fireEvent.click(await screen.findByRole('button', { name: /CC6\.1/ }));
    const link = await screen.findByRole('link', { name: /Create policy from this gap/ });
    const href = link.getAttribute('href');
    expect(href.startsWith('/policies/rules?prefill=')).toBe(true);

    // The prefill payload decodes to the draft CustomTab expects.
    const draft = JSON.parse(decodeURIComponent(href.split('prefill=')[1]));
    expect(draft.policy_type).toBe('block_action_type');
    expect(draft.rules.action_types).toEqual(['exec']);
  });
});

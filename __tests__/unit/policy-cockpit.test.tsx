import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { mockFetchSummary } = vi.hoisted(() => ({ mockFetchSummary: vi.fn() }));

vi.mock('@/policies/lib/modesClient', () => ({ fetchSummary: mockFetchSummary }));
// Stub the leaf children so this test isolates the cockpit's orchestration.
vi.mock('@/policies/components/PostureHeader', () => ({ default: () => <div data-testid="posture-header" /> }));
vi.mock('@/policies/components/EnforcementSummary', () => ({ default: () => <div data-testid="enforcement-summary" /> }));
vi.mock('@/policies/components/ShieldList', () => ({ default: () => <div data-testid="shield-list" /> }));
vi.mock('@/policies/components/RecentDigest', () => ({ default: () => <div data-testid="recent-digest" /> }));
vi.mock('@/policies/components/ModeDrawer', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="mode-drawer" data-open={String(open)} />,
}));

import PolicyCockpit from '@/policies/components/PolicyCockpit';

const baseSummary = {
  governed: true,
  modes: [{ id: 'claude-code', name: 'Claude Code Mode', interruptionLevel: 'low' }],
  primaryMode: { id: 'claude-code', name: 'Claude Code Mode', interruptionLevel: 'low' },
  enforcement: { total: 3, warn: 1, require_approval: 1, block: 1 },
  rules: [],
  shields: [],
  decisions30d: { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 },
  scope: { allAgents: true },
  agents: { total: 5 },
  pendingApprovals: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ decisions: [] }) })));
});

describe('PolicyCockpit', () => {
  it('renders the cockpit sections when governed', async () => {
    mockFetchSummary.mockResolvedValue(baseSummary);
    render(<PolicyCockpit />);
    await waitFor(() => screen.getByTestId('posture-header'));
    // getBy* throw if absent — presence is the assertion.
    screen.getByTestId('enforcement-summary');
    screen.getByTestId('shield-list');
    screen.getByTestId('recent-digest');
  });

  it('renders a calm empty state when ungoverned (not a settings dump)', async () => {
    mockFetchSummary.mockResolvedValue({ ...baseSummary, governed: false });
    render(<PolicyCockpit />);
    await waitFor(() => screen.getByText(/No governance active/i));
    screen.getByText(/Apply your first mode/i);
    expect(screen.queryByTestId('posture-header')).toBeNull();
  });

  it('fails loud on a summary error rather than showing an ungoverned state', async () => {
    mockFetchSummary.mockRejectedValue(new Error('boom'));
    render(<PolicyCockpit />);
    await waitFor(() => screen.getByText(/Couldn.t load posture/i));
    expect(screen.queryByText(/No governance active/i)).toBeNull();
    expect(screen.queryByTestId('posture-header')).toBeNull();
  });
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

// Pill-filter coverage for the dashboard Activity Timeline tile
// (app/components/ActivityTimeline.tsx). The dashboard mounts it with NO
// controller props (DraggableDashboard renders bare <Component />), so the
// component must fall back to internal state — these tests render it bare and
// assert each of the 6 operator-channel pills actually filters the event list
// and moves the active highlight.

// --- Mocks (declared before the target module is imported) ---

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }) => <div className={className}>{children}</div>,
  CardHeader: ({ title, children, action }) => (
    <div>
      <div>{title}</div>
      {action}
      {children}
    </div>
  ),
  CardContent: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title, description }) => (
    <div>
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/components/ui/Skeleton', () => ({
  CardSkeleton: () => <div data-testid="skeleton" />,
}));

vi.mock('@/components/HelpIcon', () => ({
  HelpIcon: () => null,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../app/hooks/useRealtime', () => ({
  useRealtime: () => {},
}));

vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: null }),
}));

import ActivityTimeline from '@/components/ActivityTimeline';

// --- Fixtures ---
// One non-telemetry event per fetched channel. buildActionEvent → 'decision'
// (completed, low risk → NOT priority), buildLoopEvent → 'intervention',
// buildGuardEvent block → 'governance'. No 'outcome' events arrive via fetch
// (they only come from realtime decision.created), so the Outcomes pill shows
// the category empty state.

const NOW = new Date().toISOString();

const ACTION = {
  action_id: 'act_dec_1',
  action_type: 'deploy',
  declared_goal: 'Deploy decision fixture',
  status: 'completed',
  risk_score: 40,
  agent_id: 'agent-a',
  timestamp_start: NOW,
};

const LOOP = {
  loop_id: 'loop_1',
  loop_type: 'approval',
  description: 'Intervention loop fixture',
  status: 'open',
  priority: 'high',
  agent_id: 'agent-b',
  created_at: NOW,
};

const GUARD = {
  id: 'g_1',
  decision: 'block',
  reason: 'Governance guard fixture',
  action_type: 'deploy',
  risk_score: 90,
  agent_id: 'agent-c',
  created_at: NOW,
};

function stubFetch() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/api/actions/loops')) {
      return { ok: true, status: 200, json: async () => ({ loops: [LOOP] }) };
    }
    if (u.startsWith('/api/actions')) {
      return { ok: true, status: 200, json: async () => ({ actions: [ACTION] }) };
    }
    if (u.startsWith('/api/guard')) {
      return { ok: true, status: 200, json: async () => ({ decisions: [GUARD] }) };
    }
    if (u.startsWith('/api/assumptions')) {
      return { ok: true, status: 200, json: async () => ({ assumptions: [] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function pill(container, label) {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === label
  );
}

const ACTIVE_CLASS = 'text-brand';

describe('ActivityTimeline filter pills (uncontrolled dashboard mount)', () => {
  beforeEach(() => {
    global.fetch = stubFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderTimeline() {
    const utils = render(<ActivityTimeline />);
    await waitFor(() => {
      expect(utils.container.textContent).toContain('Deploy decision fixture');
    });
    return utils;
  }

  it('renders all three fetched events by default with the All pill active', async () => {
    const { container } = await renderTimeline();
    expect(container.textContent).toContain('Deploy decision fixture');
    expect(container.textContent).toContain('Intervention loop fixture');
    expect(container.textContent).toContain('Governance guard fixture');
    expect(pill(container, 'All').className).toContain(ACTIVE_CLASS);
    expect(pill(container, 'Decisions').className).not.toContain(ACTIVE_CLASS);
  });

  it('Decisions pill filters to decision events and takes the highlight', async () => {
    const { container } = await renderTimeline();
    fireEvent.click(pill(container, 'Decisions'));
    expect(container.textContent).toContain('Deploy decision fixture');
    expect(container.textContent).not.toContain('Intervention loop fixture');
    expect(container.textContent).not.toContain('Governance guard fixture');
    expect(pill(container, 'Decisions').className).toContain(ACTIVE_CLASS);
    expect(pill(container, 'All').className).not.toContain(ACTIVE_CLASS);
  });

  it('Governance pill filters to guard events', async () => {
    const { container } = await renderTimeline();
    fireEvent.click(pill(container, 'Governance'));
    expect(container.textContent).toContain('Governance guard fixture');
    expect(container.textContent).not.toContain('Deploy decision fixture');
    expect(container.textContent).not.toContain('Intervention loop fixture');
    expect(pill(container, 'Governance').className).toContain(ACTIVE_CLASS);
  });

  it('Interventions pill filters to loop events', async () => {
    const { container } = await renderTimeline();
    fireEvent.click(pill(container, 'Interventions'));
    expect(container.textContent).toContain('Intervention loop fixture');
    expect(container.textContent).not.toContain('Deploy decision fixture');
    expect(container.textContent).not.toContain('Governance guard fixture');
    expect(pill(container, 'Interventions').className).toContain(ACTIVE_CLASS);
  });

  it('Priority pill keeps governance + interventions and drops completed decisions', async () => {
    const { container } = await renderTimeline();
    fireEvent.click(pill(container, 'Priority'));
    expect(container.textContent).toContain('Governance guard fixture');
    expect(container.textContent).toContain('Intervention loop fixture');
    expect(container.textContent).not.toContain('Deploy decision fixture');
    expect(pill(container, 'Priority').className).toContain(ACTIVE_CLASS);
  });

  it('Outcomes pill shows the category empty state when no outcome events exist', async () => {
    const { container } = await renderTimeline();
    fireEvent.click(pill(container, 'Outcomes'));
    expect(container.textContent).toContain('No outcome events right now');
    expect(container.textContent).not.toContain('Deploy decision fixture');
    expect(pill(container, 'Outcomes').className).toContain(ACTIVE_CLASS);
  });

  it('returning to All restores the full list', async () => {
    const { container } = await renderTimeline();
    fireEvent.click(pill(container, 'Decisions'));
    expect(container.textContent).not.toContain('Intervention loop fixture');
    fireEvent.click(pill(container, 'All'));
    expect(container.textContent).toContain('Deploy decision fixture');
    expect(container.textContent).toContain('Intervention loop fixture');
    expect(container.textContent).toContain('Governance guard fixture');
    expect(pill(container, 'All').className).toContain(ACTIVE_CLASS);
  });

  it('controlled mode still wins when controller props are supplied', async () => {
    const onCategoryChange = vi.fn();
    const utils = render(
      <ActivityTimeline activeCategory="governance" onCategoryChange={onCategoryChange} />
    );
    await waitFor(() => {
      expect(utils.container.textContent).toContain('Governance guard fixture');
    });
    // Controlled: the list reflects the prop, not internal state.
    expect(utils.container.textContent).not.toContain('Deploy decision fixture');
    fireEvent.click(pill(utils.container, 'Decisions'));
    // Click delegates to the controller; without a state update the prop wins.
    expect(onCategoryChange).toHaveBeenCalledWith('decision');
    expect(utils.container.textContent).not.toContain('Deploy decision fixture');
  });
});

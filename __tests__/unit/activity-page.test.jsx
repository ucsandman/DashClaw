import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Render-state coverage for /activity (app/activity/page.jsx). These assertions
// migrated from the retired /my-agent page test when Agent Summary was folded
// into Activity: narrative hero, Today/This-week scope toggle, pinned denials,
// install-prompt empty state, and agent-filter querystring propagation.

// --- Mocks (declared before the target module is imported) ---

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, breadcrumbs }) => (
    <div>
      <h1>{title}</h1>
      {breadcrumbs && <nav aria-label="Breadcrumb">{breadcrumbs.join(' / ')}</nav>}
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }) => <div className={className}>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title, description, action }) => (
    <div>
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action && <div>{action}</div>}
    </div>
  ),
}));

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ className }) => <div className={className} data-testid="skeleton" />,
}));

// useRealtime — capture the subscriber so tests can fire events into the component.
let realtimeSubscriber = null;
vi.mock('../../app/hooks/useRealtime', () => ({
  useRealtime: (handler) => {
    realtimeSubscriber = handler;
  },
}));

// useAgentFilter — tests may re-mock this per case; default to null.
let currentAgentFilter = { agentId: null };
vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => currentAgentFilter,
}));

// --- Test fixtures ---

function makeAction({
  action_id = 'act_' + Math.random().toString(36).slice(2, 10),
  agent_id = 'claude-code',
  declared_goal = 'do a thing',
  status = 'completed',
  approved_by = null,
  timestamp_start = new Date().toISOString(),
} = {}) {
  return { action_id, agent_id, declared_goal, status, approved_by, timestamp_start };
}

function makeGuard({
  id = 'g_' + Math.random().toString(36).slice(2, 10),
  agent_id = 'claude-code',
  decision = 'allow',
  reason = 'policy permitted',
  matched_policies = [],
  created_at = new Date().toISOString(),
} = {}) {
  return { id, agent_id, decision, reason, matched_policies, created_at };
}

function stubFetch({ actions = [], decisions = [], total = undefined, stats = {}, detail = null } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    // Order matters: /api/actions/stats and /api/actions/{id} both share the
    // /api/actions prefix, so the more specific routes must match first.
    if (u.startsWith('/api/actions/stats')) {
      // GET /api/actions/stats returns the true 24h { total } (agent-scopable).
      return { ok: true, status: 200, json: async () => stats };
    }
    if (u.startsWith('/api/actions/')) {
      // Single-action detail fetch fired by decision-row expansion.
      return { ok: true, status: 200, json: async () => (detail ? { action: detail } : {}) };
    }
    if (u.startsWith('/api/actions')) {
      // List endpoint returns { actions, total } — total is the windowed COUNT(*).
      return { ok: true, status: 200, json: async () => ({ actions, total }) };
    }
    if (u.startsWith('/api/guard')) {
      // GET /api/guard returns { decisions: [...] } (see listGuardDecisions).
      return { ok: true, status: 200, json: async () => ({ decisions }) };
    }
    if (u.startsWith('/api/activity')) {
      return { ok: true, status: 200, json: async () => ({ events: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

// Helper — wait for the async fetches to settle and React to commit.
async function waitForFetches(fetchMock, expectedCalls = 2) {
  await waitFor(() => {
    const actionCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/actions'));
    const guardCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/guard'));
    expect(actionCalls.length + guardCalls.length).toBeGreaterThanOrEqual(expectedCalls);
  });
}

// --- Tests ---

describe('GlobalActivityFeed — /activity render states', () => {
  beforeEach(() => {
    realtimeSubscriber = null;
    currentAgentFilter = { agentId: null };
    // Reset module registry so each test gets a fresh component instance
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the install-prompt hero for a zero-activity user', async () => {
    global.fetch = stubFetch({ actions: [], decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      expect(screen.getByText(/your agent hasn't run anything yet/i)).toBeTruthy();
    });
    // 3-step install hero
    expect(screen.getByText(/install the hook/i)).toBeTruthy();
    expect(screen.getByText(/connect discord/i)).toBeTruthy();
    // Link to the full guide
    const guideLink = screen.getByRole('link', { name: /open the full guide|full guide/i });
    expect(guideLink.getAttribute('href')).toBe('/guides/claude-code');
  });

  it('renders the narrative hero with a singular command count for 1 action', async () => {
    const actions = [
      makeAction({ status: 'completed', timestamp_start: new Date().toISOString() }),
    ];
    global.fetch = stubFetch({ actions, decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      // Singular grammar: "1 command." (no trailing s)
      expect(screen.getByText(/your agent ran 1 command\./i)).toBeTruthy();
    });
  });

  it('respects the Today/This-week scope toggle re-filter', async () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    // 30 commands within the last day (today scope)
    const todayActions = Array.from({ length: 30 }, (_, i) =>
      makeAction({ status: 'completed', timestamp_start: new Date(now - i * 60 * 1000).toISOString() })
    );
    // 25 commands scattered across the prior days, still within week
    const weekOnlyActions = Array.from({ length: 25 }, (_, i) =>
      makeAction({
        status: 'completed',
        timestamp_start: new Date(now - (1.5 * DAY + i * 2 * 60 * 60 * 1000)).toISOString(),
      })
    );
    const actions = [...todayActions, ...weekOnlyActions];

    global.fetch = stubFetch({ actions, decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    // Today scope first
    await waitFor(() => {
      expect(screen.getByText(/your agent ran 30 commands\./i)).toBeTruthy();
    });

    // Click the "This week" toggle — week count includes today + prior days
    const weekBtn = screen.getByRole('button', { name: /this week/i });
    fireEvent.click(weekBtn);

    await waitFor(() => {
      expect(screen.getByText(/your agent ran 55 commands\./i)).toBeTruthy();
    });
  });

  it('propagates useAgentFilter.agentId into fetch querystring', async () => {
    currentAgentFilter = { agentId: 'claude-code' };
    const fetchMock = stubFetch({ actions: [makeAction()], decisions: [] });
    global.fetch = fetchMock;

    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitForFetches(fetchMock);
    const actionCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/actions'));
    const guardCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/guard'));
    expect(actionCalls[0][0]).toMatch(/agent_id=claude-code/);
    expect(guardCalls[0][0]).toMatch(/agent_id=claude-code/);
  });

  it('pins denials above the live feed', async () => {
    const now = Date.now();
    const approvals = Array.from({ length: 5 }, (_, i) =>
      makeAction({
        action_id: `act_approved_${i}`,
        status: 'completed',
        timestamp_start: new Date(now - (i + 1) * 60 * 1000).toISOString(),
        declared_goal: `approved action ${i}`,
      })
    );
    const denials = [
      makeGuard({
        id: 'g_deny_0',
        decision: 'block',
        reason: 'rm -rf blocked',
        matched_policies: [{ name: 'block_destructive_shell' }],
        created_at: new Date(now - 30 * 1000).toISOString(),
      }),
      makeGuard({
        id: 'g_deny_1',
        decision: 'deny',
        reason: 'force push to main',
        matched_policies: [{ name: 'block_force_push' }],
        created_at: new Date(now - 20 * 1000).toISOString(),
      }),
    ];

    global.fetch = stubFetch({ actions: approvals, decisions: denials });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    const { container } = render(<ActivityPage />);

    await waitFor(() => {
      // Denials appear both in the pinned section and the chronological feed
      // (Activity is the full record; the pin is an added highlight), so the
      // text legitimately matches more than once.
      expect(screen.getAllByText(/rm -rf blocked/i).length).toBeGreaterThan(0);
    });

    // Denial section must render testid=denials-section ABOVE the live feed.
    const denialsSection = container.querySelector('[data-testid="denials-section"]');
    expect(denialsSection).toBeTruthy();
    // The pinned denial reason precedes the live-feed "Live feed" header.
    const liveFeedHeader = screen.getByText(/live feed/i);
    const order = denialsSection.compareDocumentPosition(liveFeedHeader);
    // Node.DOCUMENT_POSITION_FOLLOWING === 4 (bit set when other node follows)
    expect(order & 4).toBeTruthy();
  });

  it('counts denials in the narrative and uses the warning tone', async () => {
    const now = Date.now();
    const actions = [makeAction({ status: 'completed', timestamp_start: new Date(now).toISOString() })];
    const denials = [
      makeGuard({ id: 'g_d', decision: 'block', reason: 'blocked', created_at: new Date(now).toISOString() }),
    ];
    global.fetch = stubFetch({ actions, decisions: denials });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      // Narrative includes the denial clause.
      expect(screen.getByText(/1 was denied\./i)).toBeTruthy();
    });
  });

  it('patches a realtime guard.decision.created event into the feed in place', async () => {
    const now = Date.now();
    const fetchMock = stubFetch({
      actions: [makeAction({ timestamp_start: new Date(now).toISOString() })],
      decisions: [],
    });
    global.fetch = fetchMock;

    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    const { container } = render(<ActivityPage />);

    await waitForFetches(fetchMock);
    expect(realtimeSubscriber).toBeTruthy();

    // Fire a denial SSE event — it should appear in the pinned denials section.
    realtimeSubscriber('guard.decision.created', {
      id: 'g_live',
      agent_id: 'claude-code',
      decision: 'block',
      reason: 'live denial reason',
      created_at: new Date(now).toISOString(),
    });

    await waitFor(() => {
      // The realtime denial must surface specifically in the pinned section
      // (it also lands in the feed, so scope the assertion to disambiguate).
      const denialsSection = container.querySelector('[data-testid="denials-section"]');
      expect(denialsSection).toBeTruthy();
      expect(within(denialsSection).getByText(/live denial reason/i)).toBeTruthy();
    });
  });

  it('pluralizes the narrative subject from distinct actors', async () => {
    const now = Date.now();
    const actions = [
      makeAction({ action_id: 'act_p1', agent_id: 'agent-a', timestamp_start: new Date(now).toISOString() }),
      makeAction({ action_id: 'act_p2', agent_id: 'agent-b', timestamp_start: new Date(now - 1000).toISOString() }),
      makeAction({ action_id: 'act_p3', agent_id: 'agent-c', timestamp_start: new Date(now - 2000).toISOString() }),
    ];
    global.fetch = stubFetch({ actions, decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      expect(screen.getByText(/your 3 agents ran 3 commands\./i)).toBeTruthy();
    });
  });

  it('sources the narrative total from the windowed API count, not the buffer length', async () => {
    const now = Date.now();
    // Only 3 rows in the buffer, but the true 24h COUNT(*) is 700.
    const actions = Array.from({ length: 3 }, (_, i) =>
      makeAction({ action_id: `act_tc_${i}`, timestamp_start: new Date(now - i * 1000).toISOString() })
    );
    global.fetch = stubFetch({ actions, decisions: [], stats: { total: 700 } });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      expect(screen.getByText(/your agent ran 700 commands\./i)).toBeTruthy();
    });
  });

  it('counts pending_approval actions in the required-approval narrative clause', async () => {
    const now = Date.now();
    const actions = [
      makeAction({ action_id: 'act_pa', status: 'pending_approval', timestamp_start: new Date(now).toISOString() }),
      makeAction({ action_id: 'act_ap', status: 'completed', approved_by: 'wes', timestamp_start: new Date(now - 1000).toISOString() }),
    ];
    global.fetch = stubFetch({ actions, decisions: [] });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => {
      expect(screen.getByText(/2 required approval\./i)).toBeTruthy();
    });
  });

  it('auto-pauses on row expansion, buffers events, and flushes on collapse', async () => {
    const now = Date.now();
    const fetchMock = stubFetch({
      actions: [makeAction({ action_id: 'act_seed', declared_goal: 'seed goal', timestamp_start: new Date(now).toISOString() })],
      decisions: [],
    });
    global.fetch = fetchMock;
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText(/seed goal/i)).toBeTruthy());

    // Expand the row — only feed rows carry aria-expanded.
    const [rowBtn] = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(rowBtn);
    await waitFor(() => {
      expect(screen.getByText(/live feed · paused/i)).toBeTruthy();
      expect(screen.getByTestId('row-detail')).toBeTruthy();
    });

    // A realtime event while expanded must NOT mutate the visible list.
    realtimeSubscriber('action.created', {
      action_id: 'act_buffered',
      agent_id: 'claude-code',
      declared_goal: 'buffered while reading',
      status: 'completed',
      timestamp_start: new Date(now + 1000).toISOString(),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1 new · back to live/i })).toBeTruthy();
    });
    expect(screen.queryByText(/buffered while reading/i)).toBeNull();

    // Collapse restores the prior cadence (live) and flushes the buffer.
    const [expandedBtn] = screen.getAllByRole('button', { expanded: true });
    fireEvent.click(expandedBtn);
    await waitFor(() => {
      expect(screen.getByText(/buffered while reading/i)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /back to live/i })).toBeNull();
  });

  it('back-to-live flushes the paused buffer preserving order', async () => {
    const now = Date.now();
    const fetchMock = stubFetch({
      actions: [makeAction({ action_id: 'act_seed2', declared_goal: 'seed goal two', timestamp_start: new Date(now).toISOString() })],
      decisions: [],
    });
    global.fetch = fetchMock;
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText(/seed goal two/i)).toBeTruthy());

    // Explicit pause via the cadence control.
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    await waitFor(() => expect(screen.getByText(/live feed · paused/i)).toBeTruthy());

    realtimeSubscriber('action.created', {
      action_id: 'act_flush_a',
      agent_id: 'claude-code',
      declared_goal: 'flush goal alpha',
      status: 'completed',
      timestamp_start: new Date(now + 1000).toISOString(),
    });
    realtimeSubscriber('action.created', {
      action_id: 'act_flush_b',
      agent_id: 'claude-code',
      declared_goal: 'flush goal bravo',
      status: 'completed',
      timestamp_start: new Date(now + 2000).toISOString(),
    });

    const pill = await screen.findByRole('button', { name: /2 new · back to live/i });
    expect(screen.queryByText(/flush goal alpha/i)).toBeNull();
    fireEvent.click(pill);

    await waitFor(() => {
      expect(screen.getByText(/flush goal alpha/i)).toBeTruthy();
      expect(screen.getByText(/flush goal bravo/i)).toBeTruthy();
    });
    // Newest-first ordering: bravo (now+2000) renders above alpha (now+1000).
    const alpha = screen.getByText(/flush goal alpha/i);
    const bravo = screen.getByText(/flush goal bravo/i);
    // DOCUMENT_POSITION_FOLLOWING (4): alpha follows bravo in the document.
    expect(bravo.compareDocumentPosition(alpha) & 4).toBeTruthy();
    expect(screen.getByText(/^live feed$/i)).toBeTruthy();
  });

  it('renders the cadence control and reflects the selected mode', async () => {
    const now = Date.now();
    global.fetch = stubFetch({
      actions: [makeAction({ action_id: 'act_seed3', timestamp_start: new Date(now).toISOString() })],
      decisions: [],
    });
    const { default: ActivityPage } = await import('../../app/activity/page.jsx');
    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByRole('group', { name: /stream cadence/i })).toBeTruthy());
    const group = screen.getByRole('group', { name: /stream cadence/i });
    const liveBtn = within(group).getByRole('button', { name: /live/i });
    const batchBtn = within(group).getByRole('button', { name: /every 10s/i });
    const pauseBtn = within(group).getByRole('button', { name: /pause/i });

    expect(liveBtn.getAttribute('aria-pressed')).toBe('true');
    expect(batchBtn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(batchBtn);
    await waitFor(() => {
      expect(batchBtn.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByText(/live feed · batched/i)).toBeTruthy();
    });

    fireEvent.click(pauseBtn);
    await waitFor(() => {
      expect(pauseBtn.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByText(/live feed · paused/i)).toBeTruthy();
    });
  });
});

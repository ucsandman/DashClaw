import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WIDGET_PREFS_KEY, WIDGET_PREFS_VERSION, defaultWidgetPrefs } from '../../app/lib/widgetPrefs';

// Mutable search string so each test can set its own ?hide=/?show=.
let search = '';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock('@/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true, role: 'admin' }),
}));

// Controlled summary fixture — the page renders purely from this.
let summary;

vi.mock('@/widget/useWidgetSummary', () => ({
  useWidgetSummary: () => ({
    data: summary,
    loading: false,
    error: null,
    connection: 'live',
    lastUpdated: 1718000000000,
  }),
}));

function baseSummary() {
  return {
    status: 'calm',
    generatedAt: '2026-06-10T12:00:00.000Z',
    metrics: { activeAgents: 2, pendingApprovals: 0, signals: 1, spend: 1.25 },
    signals: { red: 0, amber: 1, total: 1 },
    pendingApprovals: [],
    recentActions: [
      {
        actionId: 'act_recent',
        agentName: 'scout',
        actionType: 'fetch',
        summary: 'Fetched the daily report',
        status: 'completed',
        riskScore: 10,
        outcomeStatus: 'completed',
        ts: '2026-06-10T11:59:00.000Z',
      },
    ],
    topSignals: [{ severity: 'amber', label: 'Velocity above baseline', detail: '', agentId: null, ts: null }],
  };
}

function storePrefs(mutate) {
  const prefs = defaultWidgetPrefs();
  mutate(prefs);
  window.localStorage.setItem(WIDGET_PREFS_KEY, JSON.stringify({ ...prefs, v: WIDGET_PREFS_VERSION }));
}

async function renderWidget() {
  const { default: WidgetPage } = await import('@/widget/page.jsx');
  return render(<WidgetPage />);
}

describe('widget page — prefs-driven sections', () => {
  beforeEach(() => {
    search = '';
    summary = baseSummary();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    delete window.documentPictureInPicture;
    vi.restoreAllMocks();
  });

  it('renders all sections by default', async () => {
    const { container } = await renderWidget();
    await waitFor(() => {
      expect(container.textContent).toContain('Recent');
    });
    expect(container.textContent).toContain('Agents');
    expect(container.textContent).toContain('Velocity above baseline');
  });

  it('a toggled-off section is absent from the DOM', async () => {
    storePrefs((p) => {
      p.sections.recentLog = false;
      p.sections.topSignal = false;
    });
    const { container } = await renderWidget();
    await waitFor(() => {
      // Stored prefs hydrate in an effect — wait until they apply.
      expect(container.textContent).not.toContain('Recent');
    });
    expect(container.textContent).not.toContain('Velocity above baseline');
    expect(container.textContent).not.toContain('Fetched the daily report');
    // Untouched sections still render.
    expect(container.textContent).toContain('Agents');
  });

  it('?hide= override beats stored prefs', async () => {
    storePrefs((p) => {
      p.sections.topSignal = true; // storage says visible
    });
    search = 'hide=topSignal,spend';
    const { container } = await renderWidget();
    await waitFor(() => {
      expect(container.textContent).toContain('Recent');
    });
    expect(container.textContent).not.toContain('Velocity above baseline');
    // The spend metric is hidden too; other metrics survive.
    expect(container.textContent).not.toContain('24h spend');
    expect(container.textContent).toContain('Agents');
  });

  it('toggling a section off in the settings panel persists to storage', async () => {
    const { container } = await renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /widget settings/i }));
    const checkbox = container.querySelector('#widget-section-recentLog');
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(container.textContent).not.toContain('Recent actions will appear');
      expect(container.textContent).not.toContain('Fetched the daily report');
    });
    const stored = JSON.parse(window.localStorage.getItem(WIDGET_PREFS_KEY));
    expect(stored.sections.recentLog).toBe(false);
  });
});

describe('widget page — approvals safety rail', () => {
  beforeEach(() => {
    search = '';
    summary = baseSummary();
    summary.pendingApprovals = [
      {
        actionId: 'act_pending',
        agentName: 'deployer',
        actionType: 'deploy',
        summary: 'Deploy to production',
        status: 'pending_approval',
        riskScore: 80,
        outcomeStatus: null,
        ts: '2026-06-10T11:58:00.000Z',
      },
    ];
    summary.metrics.pendingApprovals = 1;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders pending approvals even when the section is hidden by prefs and URL', async () => {
    storePrefs((p) => {
      p.sections.approvals = false;
    });
    search = 'hide=approvals';
    const { container } = await renderWidget();
    await waitFor(() => {
      expect(container.textContent).toContain('Waiting for approval');
    });
    expect(container.textContent).toContain('Deploy to production');
  });
});

describe('widget page — Pin (Document PiP) feature detection', () => {
  beforeEach(() => {
    search = '';
    summary = baseSummary();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    delete window.documentPictureInPicture;
    vi.restoreAllMocks();
  });

  it('shows no Pin button when the API is absent', async () => {
    await renderWidget();
    await waitFor(() => {
      expect(screen.queryByText('Recent')).not.toBeNull();
    });
    expect(screen.queryByLabelText(/pin on top/i)).toBeNull();
    // The cross-browser popup path is still there.
    expect(screen.queryByLabelText(/pop out into a floating window/i)).not.toBeNull();
  });

  it('shows the Pin button only when documentPictureInPicture exists', async () => {
    window.documentPictureInPicture = { requestWindow: vi.fn(), window: null };
    await renderWidget();
    const pin = await screen.findByLabelText(/pin on top/i);
    expect(pin).not.toBeNull();
  });
});

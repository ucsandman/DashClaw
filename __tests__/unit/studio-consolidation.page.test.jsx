import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Studio consolidation (phase 18): model strategies live under /workflows as a
// tab. These tests prove (a) a strategy created through the consolidated UI is
// selectable in the workflow builder, and (b) the sidebar reflects the new IA
// (Capabilities under Govern; Model Strategies / Branch Finish entries gone).

const push = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/',
}));

vi.mock('@/components/PageLayout.js', () => ({
  default: ({ title, subtitle, children, actions }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children, className }) => <div className={className}>{children}</div>,
  CardContent: ({ children, className }) => <div className={className}>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
}));

vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

describe('studio consolidation — strategy created in the consolidated UI feeds the builder', () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a strategy at /workflows/strategies/new and offers it in the workflow builder strategy select', async () => {
    // Phase 1: create the strategy through the consolidated UI.
    global.fetch = vi.fn(async (url, options = {}) => {
      if (String(url) === '/api/model-strategies' && options.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ strategy: { strategy_id: 'mst_consolidated' } }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: NewModelStrategyPage } = await import('@/workflows/strategies/new/page.jsx');
    const first = render(<NewModelStrategyPage />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Latency-first research' } });
    fireEvent.click(screen.getByRole('button', { name: /create strategy/i }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/workflows/strategies/mst_consolidated');
    });

    const postCall = global.fetch.mock.calls.find(
      ([url, options]) => String(url) === '/api/model-strategies' && options?.method === 'POST'
    );
    expect(postCall).toBeTruthy();
    const created = JSON.parse(postCall[1].body);
    expect(created.name).toBe('Latency-first research');
    expect(created.config?.primary?.provider).toBeTruthy();

    first.unmount();

    // Phase 2: the builder's resources fetch returns that same strategy —
    // it must surface as a selectable option in the model strategy select.
    global.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/model-strategies') {
        return {
          ok: true,
          json: async () => ({
            strategies: [
              { strategy_id: 'mst_consolidated', name: created.name, config: created.config },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: NewWorkflowTemplatePage } = await import('@/workflows/new/page.jsx');
    render(<NewWorkflowTemplatePage />);

    const strategySelect = await screen.findByLabelText(/model strategy/i);
    await screen.findByRole('option', { name: /latency-first research/i });

    fireEvent.change(strategySelect, { target: { value: 'mst_consolidated' } });
    expect(strategySelect.value).toBe('mst_consolidated');
  });
});

describe('studio consolidation — sidebar IA', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Workflows and Capabilities, with Capabilities outside the Labs group', async () => {
    const { default: Sidebar } = await import('@/components/Sidebar');
    const { container } = render(<Sidebar />);

    expect(screen.getAllByText('Workflows').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Capabilities').length).toBeGreaterThan(0);

    // Capabilities moved to Govern: no capabilities link inside any Labs group.
    const labsGroups = container.querySelectorAll('[id="nav-group-labs"]');
    expect(labsGroups.length).toBeGreaterThan(0);
    for (const labs of labsGroups) {
      expect(labs.querySelector('a[href="/capabilities"]')).toBeNull();
    }
    expect(container.querySelector('a[href="/capabilities"]')).toBeTruthy();
  });

  it('does not render the retired Model Strategies and Branch Finish entries', async () => {
    const { default: Sidebar } = await import('@/components/Sidebar');
    const { container } = render(<Sidebar />);

    expect(screen.queryByText('Model Strategies')).toBeNull();
    expect(screen.queryByText('Branch Finish')).toBeNull();
    expect(container.querySelector('a[href="/model-strategies"]')).toBeNull();
    expect(container.querySelector('a[href="/labs/branch-finish"]')).toBeNull();
  });
});

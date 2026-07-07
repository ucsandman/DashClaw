import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Studio consolidation (phase 18): model strategies live under
// /workflows/strategies. These tests prove (a) a strategy is created through the
// consolidated UI, and (b) the sidebar reflects the new IA (Capabilities under
// Govern; Model Strategies / Branch Finish entries gone).

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

describe('studio consolidation — strategy created in the consolidated UI', () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a strategy at /workflows/strategies/new', async () => {
    // Create the strategy through the consolidated UI.
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
  });
});

describe('studio consolidation — sidebar IA', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

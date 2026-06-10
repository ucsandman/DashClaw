import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// §18.5 Spend UI regression tests.
//
// Three coverage gaps, all asserting REAL production behavior:
//  1. app/spend/page.tsx        — Spend overview renders + shapes the merged
//                                  agent+x402 daily trend the AreaChart consumes.
//  2. app/spend/code/page.tsx   — the /spend/code chart-data transform maps the
//                                  code-sessions by_day aggregation into the
//                                  {date, cost} series the AreaChart consumes.
//  3. app/components/Sidebar.tsx — the Spend nav item gets brand active styling
//                                  when usePathname() === '/spend', and sibling
//                                  /spend/* items + unrelated items do NOT.

// next/link → plain anchor (sibling-test convention).
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Stub PageLayout so the page's own title/subtitle/actions/children are the only
// things under test (and so we don't pull the real Sidebar into the page render).
vi.mock('@/components/PageLayout.js', () => ({
  default: ({ title, subtitle, children, actions }: any) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div data-testid="actions">{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

// recharts is not the unit under test. Render the AreaChart's `data` prop as a
// stable JSON payload + expose the series `dataKey` so we can assert the page's
// own data-shaping output deterministically (jsdom gives ResponsiveContainer a
// 0x0 box, so the real SVG would not paint — mocking keeps the data assertion
// meaningful without weakening it).
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  AreaChart: ({ data, children }: any) => (
    <div data-testid="area-chart" data-series={JSON.stringify(data)}>{children}</div>
  ),
  Area: ({ dataKey }: any) => <div data-testid="area" data-key={dataKey} />,
  XAxis: () => <div data-testid="xaxis" />,
  YAxis: () => <div data-testid="yaxis" />,
  Tooltip: () => <div data-testid="tooltip" />,
}));

function okJson(body: any) {
  return { ok: true, json: async () => body } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpendOverviewPage (§18.5 Spend page rendering)', () => {
  it('renders the Spend surface (title + fleet total) and feeds the merged agent+x402 daily trend to the AreaChart', async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).startsWith('/api/finops/spend')) {
        return okJson({
          fleet_total_usd: 123.45,
          agent: {
            total_cost_usd: 100.0,
            by_day: [
              { date: '2026-06-02', cost_usd: 60 },
              { date: '2026-06-01', cost_usd: 40 },
            ],
          },
          x402: {
            total_spend_usd: 23.45,
            // 06-02 overlaps an agent day (must merge into one row); 06-03 is x402-only.
            by_day: [
              { date: '2026-06-02', spend_usd: 13.45 },
              { date: '2026-06-03', spend_usd: 10 },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any;

    const { default: SpendOverviewPage } = await import('@/spend/page');
    render(<SpendOverviewPage />);

    // The Spend surface heading renders.
    expect(await screen.findByRole('heading', { name: 'Spend' })).toBeTruthy();

    // Fleet total card shows the formatted fleet_total_usd.
    await waitFor(() => {
      expect(screen.getByText('$123.45')).toBeTruthy();
    });
    // Break-out totals also render (real cards, not the chart).
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(screen.getByText('$23.45')).toBeTruthy();

    // The chart container mounts (async — the chart is behind next/dynamic so
    // recharts stays out of the page's initial chunk) and the Area binds the
    // `total` series key.
    expect(await screen.findByTestId('chart-container')).toBeTruthy();
    expect(screen.getByTestId('area').getAttribute('data-key')).toBe('total');

    // The page's trend-shaping IIFE: agent + x402 merged by date, sorted asc,
    // each row carrying total = agent + x402.
    const series = JSON.parse(screen.getByTestId('area-chart').getAttribute('data-series') || '[]');
    expect(series.map((r: any) => r.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    // 06-01: agent-only.
    expect(series[0]).toMatchObject({ date: '2026-06-01', agent: 40, x402: 0, total: 40 });
    // 06-02: agent + x402 merged into ONE row (this is the regression — the two
    // by_day arrays keyed by date must not produce duplicate rows).
    expect(series[1]).toMatchObject({ date: '2026-06-02', agent: 60, x402: 13.45, total: 73.45 });
    // 06-03: x402-only day still appears with agent defaulted to 0.
    expect(series[2]).toMatchObject({ date: '2026-06-03', agent: 0, x402: 10, total: 10 });
  });
});

describe('ClaudeCodeSpendPage (§18.5 /spend/code chart data)', () => {
  it('maps the code-sessions by_day aggregation into the sorted {date, cost} series the AreaChart consumes', async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).startsWith('/api/finops/spend')) {
        // The page requests ?lens=claude-code&period=...; assert it does.
        expect(String(url)).toContain('lens=claude-code');
        return okJson({
          code_total_usd: 7.5,
          code_sessions: {
            session_count: 3,
            total_cache_savings_usd: 2.25,
            // Intentionally out of order — the transform must sort ascending.
            by_day: [
              { date: '2026-06-03', cost_usd: 3 },
              { date: '2026-06-01', cost_usd: '1.50' }, // string (pg numeric) → Number()
              { date: '2026-06-02', cost_usd: 3 },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any;

    const { default: ClaudeCodeSpendPage } = await import('@/spend/code/page');
    render(<ClaudeCodeSpendPage />);

    await waitFor(() => {
      expect(screen.getByTestId('area-chart')).toBeTruthy();
    });

    // Area binds the `cost` key (distinct from the overview's `total`).
    expect(screen.getByTestId('area').getAttribute('data-key')).toBe('cost');

    const series = JSON.parse(screen.getByTestId('area-chart').getAttribute('data-series') || '[]');
    // Shape: each row is exactly {date, cost}; cost coerced via Number(); sorted asc by date.
    expect(series).toEqual([
      { date: '2026-06-01', cost: 1.5 },
      { date: '2026-06-02', cost: 3 },
      { date: '2026-06-03', cost: 3 },
    ]);
  });
});

describe('Sidebar (§18.5 /spend navigation active state)', () => {
  async function renderSidebarAt(pathname: string) {
    vi.doMock('next/navigation', () => ({ usePathname: () => pathname }));
    vi.resetModules();
    const { default: Sidebar } = await import('@/components/Sidebar');
    return render(<Sidebar />);
  }

  afterEach(() => {
    vi.doUnmock('next/navigation');
    vi.resetModules();
  });

  it('marks the Spend Overview item active (brand styling) on /spend and leaves siblings/unrelated items inactive', async () => {
    await renderSidebarAt('/spend');

    // Desktop + mobile copies both render in this component; pick the active links.
    const overviewLinks = screen.getAllByRole('link', { name: 'Overview' });
    const activeOverview = overviewLinks.find((l) => l.getAttribute('href') === '/spend');
    expect(activeOverview).toBeTruthy();

    // Active item: aria-current=page, white text, and the brand accent indicator.
    expect(activeOverview!.getAttribute('aria-current')).toBe('page');
    expect(activeOverview!.className).toContain('text-white');
    // The brand active indicator span (bg-brand) renders only for the active item.
    const brandBar = activeOverview!.querySelector('.bg-brand');
    expect(brandBar).toBeTruthy();
    // The icon picks up the brand color when active.
    expect(activeOverview!.querySelector('.text-brand')).toBeTruthy();

    // Sibling /spend/code ("Your Claude Code") must NOT be active on exact /spend.
    const codeLinks = screen.getAllByRole('link', { name: 'Your Claude Code' });
    const codeLink = codeLinks.find((l) => l.getAttribute('href') === '/spend/code')!;
    expect(codeLink.getAttribute('aria-current')).toBeNull();
    expect(codeLink.className).toContain('text-secondary');
    expect(codeLink.querySelector('.bg-brand')).toBeNull();

    // Unrelated item (Decisions) is inactive.
    const decisionsLinks = screen.getAllByRole('link', { name: 'Decisions' });
    const decisions = decisionsLinks.find((l) => l.getAttribute('href') === '/decisions')!;
    expect(decisions.getAttribute('aria-current')).toBeNull();
    expect(decisions.className).toContain('text-secondary');
  });
});

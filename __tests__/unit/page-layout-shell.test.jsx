import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import PageLayout from '@/components/PageLayout';

vi.mock('@/components/Sidebar', () => ({
  default: () => <aside data-testid="sidebar" />,
}));

vi.mock('@/components/NotificationCenter', () => ({
  default: () => <div data-testid="notifications" />,
}));

vi.mock('@/components/AgentFilterDropdown', () => ({
  default: () => <div data-testid="agent-filter" />,
}));

vi.mock('@/components/UserMenu', () => ({
  default: () => <div data-testid="user-menu" />,
}));

vi.mock('@/components/RealtimeIndicator', () => ({
  default: () => <div data-testid="realtime" />,
}));

vi.mock('@/components/DemoBanner', () => ({
  default: () => <div data-testid="demo-banner" />,
}));

vi.mock('@/components/SystemStatusBar', () => ({
  default: () => <div data-testid="system-status" />,
}));

describe('PageLayout shell', () => {
  it('pins dashboard chrome to the viewport and keeps scrolling inside main', () => {
    const { container } = render(
      <PageLayout title="Mission Control" breadcrumbs={['Mission Control']}>
        <div>Governed events</div>
      </PageLayout>,
    );

    const shell = container.firstElementChild;
    expect(shell?.className).toContain('fixed');
    expect(shell?.className).toContain('inset-0');
    expect(shell?.className).toContain('overflow-hidden');

    const main = container.querySelector('main');
    expect(main?.className).toContain('overflow-y-auto');
    expect(main?.className).toContain('overflow-x-hidden');
  });
});

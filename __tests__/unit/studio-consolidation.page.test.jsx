import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Studio consolidation (phase 18): the retired Model Strategies pages and the
// Branch Finish entry were removed from the sidebar IA (model-strategies deleted
// entirely in the v5 cull). This proves the sidebar no longer advertises them.

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

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

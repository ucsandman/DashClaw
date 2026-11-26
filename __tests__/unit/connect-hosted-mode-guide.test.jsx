import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@/components/PublicNavbar', () => ({ default: () => null }));
vi.mock('@/components/PublicFooter', () => ({ default: () => null }));
vi.mock('next/script', () => ({ default: () => null }));

import ConnectPage from '@/connect/page';

afterEach(() => {
  cleanup();
  delete process.env.DASHCLAW_HOSTED;
});

// The self-host runbook tells the reader to stand up their own instance.
// On the hosted trial instance that text sat directly under the mint button
// and told trial visitors they needed a server (25 of 30 trials never made a
// call). Hosted mode drops it; self-host keeps the page exactly as it was.
const SELF_HOST_PREREQ = 'Before you start, you need a running DashClaw instance.';
const SELF_HOST_BASE_URL = 'export DASHCLAW_BASE_URL=https://your-instance.vercel.app';
const DEMO_WARNING = 'as your agent base URL';

describe('/connect self-host guide by mode', () => {
  it('hosted mode: mint section renders and the self-host guide does not', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    const ui = await ConnectPage({ searchParams: Promise.resolve({}) });
    const { container } = render(ui);
    const text = container.textContent ?? '';

    expect(text).toContain('Mint trial workspace');
    expect(text).not.toContain(SELF_HOST_PREREQ);
    expect(text).not.toContain(SELF_HOST_BASE_URL);
    expect(text).not.toContain(DEMO_WARNING);
    expect(text).not.toContain('Get your API key');
    // Someone who really wants their own server still has one way there.
    expect(container.querySelector('a[href="/self-host"]')).toBeTruthy();
  });

  it('self-host mode: the full guide renders unchanged and there is no mint section', async () => {
    delete process.env.DASHCLAW_HOSTED;
    const ui = await ConnectPage({ searchParams: Promise.resolve({}) });
    const { container } = render(ui);
    const text = container.textContent ?? '';

    expect(text).toContain(SELF_HOST_PREREQ);
    expect(text).toContain(SELF_HOST_BASE_URL);
    expect(text).toContain(DEMO_WARNING);
    expect(text).toContain('Get your API key');
    expect(text).not.toContain('Mint trial workspace');
  });
});

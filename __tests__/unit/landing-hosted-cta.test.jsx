import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import HostedTrialCTA from '@/components/HostedTrialCTA';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HostedTrialCTA', () => {
  it('under cap: renders the sign-in CTA linking to /login', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ full: false, active: 0, max: 500 }) }),
    );

    render(<HostedTrialCTA />);

    const cta = await screen.findByText(/Govern your Claude/i);
    expect(cta).toBeTruthy();
    expect(cta.closest('a')?.getAttribute('href')).toBe('/login');
  });

  it('full: shows "Trials are full" and not the sign-in CTA', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ full: true, active: 500, max: 500 }) }),
    );

    render(<HostedTrialCTA />);

    expect(await screen.findByText(/Trials are full/i)).toBeTruthy();
    expect(screen.queryByText(/Govern your Claude/i)).toBeNull();
  });

  it('self-host (404): renders nothing', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));

    const { container } = render(<HostedTrialCTA />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    // Effect has settled; component returns null on a non-ok response.
    expect(container.innerHTML).toBe('');
  });

  it('fetch error: renders nothing', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

    const { container } = render(<HostedTrialCTA />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(container.innerHTML).toBe('');
  });
});

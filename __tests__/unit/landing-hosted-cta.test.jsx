import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import HostedTrialCTA from '@/components/HostedTrialCTA';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('HostedTrialCTA', () => {
  it('marketing mode (NEXT_PUBLIC_HOSTED_TRIAL_URL set): renders a cross-origin link, no capacity probe', () => {
    vi.stubEnv('NEXT_PUBLIC_HOSTED_TRIAL_URL', 'https://hosted.dashclaw.io/connect');
    global.fetch = vi.fn();

    render(<HostedTrialCTA />);

    const link = screen.getByRole('link', { name: /Start a hosted trial/i });
    expect(link.getAttribute('href')).toBe('https://hosted.dashclaw.io/connect');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('hosted instance, under cap: links to the same-origin /connect mint (NOT Google sign-in — no provider is configured on the hosted deployment)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ full: false, active: 0, max: 500 }) }),
    );

    render(<HostedTrialCTA />);

    const link = await screen.findByRole('link', { name: /Start a hosted trial/i });
    expect(link.getAttribute('href')).toBe('/connect');
  });

  it('full: shows "Trials are full" and not the trial link', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ full: true, active: 500, max: 500 }) }),
    );

    render(<HostedTrialCTA />);

    expect(await screen.findByText(/Trials are full/i)).toBeTruthy();
    expect(screen.queryByText(/Start a hosted trial/i)).toBeNull();
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

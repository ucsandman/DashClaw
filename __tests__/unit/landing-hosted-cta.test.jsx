import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import HostedTrialCTA from '@/components/HostedTrialCTA';

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

import { signIn } from 'next-auth/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HostedTrialCTA', () => {
  it('under cap: clicking the CTA calls signIn with google and /connect?hosted=1', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ full: false, active: 0, max: 500 }) }),
    );

    render(<HostedTrialCTA />);

    const btn = await screen.findByRole('button', { name: /Govern your Claude/i });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/connect?hosted=1' });
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

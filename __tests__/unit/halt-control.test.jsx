/**
 * Emergency halt control (Mission Control) — the org kill switch's first UI.
 *
 * HUMAN-EXPERIENCE.md clause 3: an emergency capability a human is expected
 * to trigger must be a click, never a terminal command. /api/halt existed
 * with zero rendered surface. Contract: admins see a Halt control (two-step
 * confirm, optional reason); a halted org renders a banner with actor,
 * reason, and a Resume control; non-admins (GET 403) see nothing.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { default: HaltControl } = await import('@/mission-control/components/HaltControl.tsx');

afterEach(() => { vi.unstubAllGlobals(); });

const NOT_HALTED = { halt: { halted: false, actor: null, reason: null, at: null } };
const HALTED = { halt: { halted: true, actor: 'usr_admin', reason: 'incident response', at: '2026-07-03T00:00:00.000Z' } };

function stubFetch(getBody, postBody = { ok: true }) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if ((opts.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => getBody };
    }
    return { ok: true, status: 200, json: async () => postBody };
  }));
  return calls;
}

describe('HaltControl', () => {
  it('renders a Halt control for an un-halted org and requires an explicit confirm before POSTing', async () => {
    const calls = stubFetch(NOT_HALTED);
    render(<HaltControl />);

    const haltButton = await screen.findByRole('button', { name: /halt org/i });
    fireEvent.click(haltButton);

    // No POST yet — first click only opens the confirm step.
    expect(calls.filter((c) => (c.opts.method || 'GET') === 'POST')).toHaveLength(0);

    const reasonInput = await screen.findByPlaceholderText(/reason/i);
    fireEvent.change(reasonInput, { target: { value: 'runaway deploy loop' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm halt/i }));

    await waitFor(() => {
      const posts = calls.filter((c) => (c.opts.method || 'GET') === 'POST');
      expect(posts).toHaveLength(1);
      expect(JSON.parse(posts[0].opts.body)).toEqual({ halted: true, reason: 'runaway deploy loop' });
    });
  });

  it('renders the halted banner with actor and reason, and Resume confirm POSTs halted:false', async () => {
    const calls = stubFetch(HALTED);
    render(<HaltControl />);

    expect(await screen.findByText(/halted/i)).toBeTruthy();
    expect(screen.getByText(/usr_admin/)).toBeTruthy();
    expect(screen.getByText(/incident response/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm resume/i }));

    await waitFor(() => {
      const posts = calls.filter((c) => (c.opts.method || 'GET') === 'POST');
      expect(posts).toHaveLength(1);
      expect(JSON.parse(posts[0].opts.body)).toEqual({ halted: false });
    });
  });

  it('renders nothing for non-admins (GET 403)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Admin access required' }) })));
    const { container } = render(<HaltControl />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

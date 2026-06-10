import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// P13: the /compliance ProfileBand — framework → Policy Mode card with honest
// posture, live applied/not-applied state from /api/policies/summary, a
// two-step Apply (click → confirm) through POST /api/policies/modes/import,
// and a calm inline message on 403 instead of an error wall.

vi.mock('next/link', () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));

const { default: ProfileBand, modeIdForFramework } = await import('@/compliance/ProfileBand.jsx');

function mockFetch({ appliedModes = [], importStatus = 201, importBody } = {}) {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u === '/api/policies/summary') {
      return { ok: true, status: 200, json: async () => ({ modes: appliedModes.map((id) => ({ id })) }) };
    }
    if (u === '/api/policies/modes/import' && method === 'POST') {
      return {
        ok: importStatus < 400,
        status: importStatus,
        json: async () => importBody ?? { mode_id: 'soc2', imported: 7, reactivated: 0, errors: [], policies: [] },
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('modeIdForFramework', () => {
  it('maps soc2 to its purpose-built mode and everything else to enterprise-strict', () => {
    expect(modeIdForFramework('soc2')).toBe('soc2');
    expect(modeIdForFramework('gdpr')).toBe('enterprise-strict');
    expect(modeIdForFramework('iso27001')).toBe('enterprise-strict');
  });
});

describe('ProfileBand', () => {
  it('renders the matched mode with honest posture and a Not applied state', async () => {
    vi.stubGlobal('fetch', mockFetch({ appliedModes: [] }));
    render(<ProfileBand framework="soc2" frameworkLabel="SOC 2" />);

    expect(await screen.findByText('SOC 2 Mode')).toBeTruthy();
    expect(await screen.findByText('Not applied')).toBeTruthy();
    // The honest non-certification disclaimer from the catalog is shown.
    expect(screen.getByText(/does NOT by itself make an organization SOC 2 compliant/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply profile' })).toBeTruthy();
  });

  it('shows Applied when /api/policies/summary carries the mode tag', async () => {
    vi.stubGlobal('fetch', mockFetch({ appliedModes: ['soc2'] }));
    render(<ProfileBand framework="soc2" frameworkLabel="SOC 2" />);
    expect(await screen.findByText('Applied')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Re-apply profile' })).toBeTruthy();
  });

  it('applies through a two-step confirm and reports the policy count', async () => {
    const fetchMock = mockFetch({ appliedModes: [] });
    vi.stubGlobal('fetch', fetchMock);
    const onApplied = vi.fn();
    render(<ProfileBand framework="soc2" frameworkLabel="SOC 2" onApplied={onApplied} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Apply profile' }));
    // First click does NOT fire the request — it arms the confirm step.
    expect(fetchMock.mock.calls.filter(([, o]) => o?.method === 'POST').length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /Confirm — activates org-wide/ }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(await screen.findByText(/SOC 2 Mode applied — 7 policies active/)).toBeTruthy();

    const post = fetchMock.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(post[0]).toBe('/api/policies/modes/import');
    expect(JSON.parse(post[1].body)).toEqual({ mode_id: 'soc2' });
  });

  it('renders a calm inline message on 403 instead of an error wall', async () => {
    vi.stubGlobal('fetch', mockFetch({ appliedModes: [], importStatus: 403, importBody: { error: 'Admin access required' } }));
    render(<ProfileBand framework="gdpr" frameworkLabel="GDPR" />);

    expect(await screen.findByText('Enterprise Strict Mode')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply profile' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm — activates org-wide/ }));
    expect(await screen.findByText(/needs an admin key/)).toBeTruthy();
  });
});

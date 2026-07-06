import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the governance-settings wiring: the panel must seed the runtime flags
// from GET /api/settings, save each flag via POST /api/settings, and —
// critically — store the predictive keys with category 'general' (guard.js
// reads them with that exact filter, so any other category would be a silent
// no-op). It must also fully remove a setting via DELETE, not just overwrite it.

const { default: GovernancePanel } = await import('@/settings/components/GovernancePanel.jsx');

const SETTINGS = [
  { key: 'PREDICTIVE_RISK_ENABLED', value: 'true' },
  { key: 'PREDICTIVE_RISK_THRESHOLD', value: '70' },
  { key: 'DASHCLAW_ACTION_COST_THRESHOLD', value: '5' },
  { key: 'DASHCLAW_OUTCOME_TIMEOUT_MINUTES', value: '30' },
];

function makeFetch() {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u.startsWith('/api/settings') && method === 'GET') {
      return { ok: true, json: async () => ({ settings: SETTINGS }) };
    }
    if (u === '/api/settings' && method === 'POST') return { ok: true, json: async () => ({ success: true }) };
    if (u.startsWith('/api/settings') && method === 'DELETE') return { ok: true, json: async () => ({ success: true }) };
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('GovernancePanel', () => {
  it('seeds flags from /api/settings', async () => {
    global.fetch = makeFetch();
    render(<GovernancePanel />);

    // cost threshold seeded from the stored value
    await waitFor(() => expect(screen.getByDisplayValue('5')).toBeTruthy());
  });

  it('saves the predictive-risk keys with category "general"', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<GovernancePanel />);

    fireEvent.click(await screen.findByText('Save settings'));

    await waitFor(() => {
      const enabledPost = fetchFn.mock.calls.find(
        (c) => c[0] === '/api/settings' && c[1]?.method === 'POST' &&
          JSON.parse(c[1].body).key === 'PREDICTIVE_RISK_ENABLED',
      );
      expect(enabledPost).toBeTruthy();
      const body = JSON.parse(enabledPost[1].body);
      expect(body.category).toBe('general');
      expect(body.value).toBe('true');
    });

    // threshold is also persisted with category general
    const threshPost = fetchFn.mock.calls.find(
      (c) => c[0] === '/api/settings' && c[1]?.method === 'POST' &&
        JSON.parse(c[1].body).key === 'PREDICTIVE_RISK_THRESHOLD',
    );
    expect(JSON.parse(threshPost[1].body).category).toBe('general');
  });

  it('removes a setting via DELETE rather than overwriting it', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<GovernancePanel />);

    const removeBtns = await screen.findAllByText('Remove');
    fireEvent.click(removeBtns[0]); // cost-alert threshold

    await waitFor(() => {
      expect(fetchFn.mock.calls.some(
        (c) => String(c[0]).includes('key=DASHCLAW_ACTION_COST_THRESHOLD') && c[1]?.method === 'DELETE',
      )).toBe(true);
    });
  });
});

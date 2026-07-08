import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// "One Ledger, Many Lenses" redesign: CustomTab (mounted only at
// /policies/rules, reading ?prefill= itself) was deleted. Prefill now flows
// in as a `prefill` prop on Ledger — PolicyWorkbench is responsible for
// parsing the deep-link and handing Ledger the parsed draft.
const { default: Ledger } = await import('@/policies/components/Ledger.jsx');

function mockFetch() {
  const routes = {
    'GET /api/policies': () => ({ policies: [] }),
    'GET /api/agents': () => ({ agents: [] }),
  };
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const key = `${method} ${url.split('?')[0]}`;
    const handler = routes[key];
    return { ok: true, status: 200, json: async () => (handler ? handler() : {}) };
  });
}

const noop = () => {};
const baseProps = {
  summary: null,
  contract: null,
  highlightPolicy: null,
  refreshSignal: 0,
  onChanged: noop,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('Ledger — prefill from deep-link (A6)', () => {
  it('opens the rule editor pre-populated when a prefill draft is passed', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const draft = { name: 'CC6.1: block action type', policy_type: 'block_action_type', rules: { action_types: ['exec'], action: 'block' } };

    render(<Ledger {...baseProps} prefill={draft} />);

    // The rule editor is only mounted when showEditor is true; its Cancel
    // button is unique to that modal, so finding it proves the prefill opened it.
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The prefilled policy name lands in the form.
    expect(screen.getByDisplayValue('CC6.1: block action type')).toBeTruthy();
  });

  it('does not open the rule editor without a prefill draft', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<Ledger {...baseProps} prefill={null} />);
    await screen.findByText(/no rules yet/i);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

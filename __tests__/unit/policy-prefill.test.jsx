import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// A6: a /policies/rules?prefill=<encoded draft> deep-link opens the authoring
// form prefilled. CustomTab is mounted ONLY at /policies/rules — /policies
// renders PolicyCockpit, which drops ?prefill=, so any prefilled draft link
// MUST point at /policies/rules (P13 bridge fix).
vi.mock('@/components/ui/Badge.js', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/EmptyState.js', () => ({ EmptyState: ({ title, description }) => <div>{title}{description}</div> }));
vi.mock('@/policies/components/PolicyGeneratedDraftEditor.jsx', () => ({ default: () => <div /> }));

const { default: CustomTab } = await import('@/policies/components/CustomTab.jsx');

function mockFetch() {
  const routes = {
    'GET /api/policies': () => ({ policies: [] }),
    'GET /api/agents': () => ({ agents: [] }),
    'GET /api/policies/templates': () => ({ templates: [] }),
  };
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const key = `${method} ${url.split('?')[0]}`;
    const handler = routes[key];
    return { ok: true, status: 200, json: async () => (handler ? handler() : {}) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/policies/rules');
});

describe('CustomTab — prefill from deep-link (A6)', () => {
  it('opens the authoring form when ?prefill= carries a valid draft', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const draft = { name: 'CC6.1: block action type', policy_type: 'block_action_type', rules: { action_types: ['exec'], action: 'block' } };
    window.history.replaceState({}, '', '/policies/rules?prefill=' + encodeURIComponent(JSON.stringify(draft)));

    render(<CustomTab />);

    // The authoring panel is only mounted when showAuthoring is true; its Cancel
    // button is unique to that panel, so finding it proves the prefill opened it.
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The prefilled policy name lands in the form.
    expect(screen.getByDisplayValue('CC6.1: block action type')).toBeTruthy();
  });

  it('does not open the authoring form without a prefill param', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<CustomTab />);
    await screen.findByPlaceholderText(/search policies/i);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

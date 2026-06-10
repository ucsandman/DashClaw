import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Registry learnability: the guided path must be real (working links to
// /capabilities/new), templates must prefill the form, inactive agents must be
// reactivatable, and fetch failures must not masquerade as an empty registry.

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div>
      <h1>{title}</h1>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

import RegistryEmptyState from '../../app/agents/registry/components/RegistryEmptyState';
import { REGISTRY_TEMPLATES } from '../../app/agents/registry/components/constants';

function registryFetch({ agents = [], detail = null, capabilities = [] } = {}) {
  return vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('/api/agents/registry/') && (opts.method || 'GET') === 'PATCH') {
      const body = JSON.parse(opts.body);
      return {
        ok: true, status: 200,
        json: async () => ({ registered_agent: { ...(detail?.registered_agent || {}), ...body } }),
      };
    }
    if (u.startsWith('/api/agents/registry/')) {
      return { ok: true, status: 200, json: async () => detail };
    }
    if (u.startsWith('/api/agents/registry')) {
      return { ok: true, status: 200, json: async () => ({ registered_agents: agents }) };
    }
    if (u.startsWith('/api/capabilities')) {
      return { ok: true, status: 200, json: async () => ({ capabilities }) };
    }
    if (u.startsWith('/api/agents')) {
      return { ok: true, status: 200, json: async () => ({ agents: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

const INACTIVE_AGENT = {
  entry_id: 'ra_1', name: 'Acme', slug: 'acme', endpoint: 'https://api.acme.example',
  auth_type: 'bearer', risk_class: 'medium', default_budget_usd: 2, status: 'inactive',
};

describe('RegistryEmptyState — guided path', () => {
  it('links the capability step to /capabilities/new and shows the seed command', () => {
    render(<RegistryEmptyState onRegister={() => {}} />);
    const capLink = screen.getByRole('link', { name: /create one at \/capabilities\/new/i });
    expect(capLink.getAttribute('href')).toBe('/capabilities/new');
    expect(screen.getByText(/node scripts\/seed-registry-demo\.mjs/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /register agent/i })).toBeTruthy();
  });
});

describe('AgentRegistryPage', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('templates prefill the register form', async () => {
    global.fetch = registryFetch();
    const { default: Page } = await import('../../app/agents/registry/page.jsx');
    render(<Page />);

    fireEvent.click(await screen.findByRole('button', { name: /register agent/i }));
    const templates = await screen.findByTestId('registry-templates');
    fireEvent.click(templates.querySelectorAll('button')[0]);

    const tpl = REGISTRY_TEMPLATES[0];
    await waitFor(() => {
      expect(screen.getByDisplayValue(tpl.form.name)).toBeTruthy();
      expect(screen.getByDisplayValue(tpl.form.endpoint)).toBeTruthy();
    });
  });

  it('inactive agents get an Activate button that PATCHes status active', async () => {
    global.fetch = registryFetch({
      agents: [INACTIVE_AGENT],
      detail: { registered_agent: INACTIVE_AGENT, capabilities: [], invocations: [] },
    });
    const { default: Page } = await import('../../app/agents/registry/page.jsx');
    render(<Page />);

    fireEvent.click(await screen.findByRole('button', { name: /Acme/ }));
    const activate = await screen.findByRole('button', { name: /^activate$/i });
    fireEvent.click(activate);

    await waitFor(() => {
      const patchCall = global.fetch.mock.calls.find(([, o]) => o?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall[1].body)).toEqual({ status: 'active' });
    });
  });

  it('zero-capability orgs see the truthful copy with a /capabilities/new link', async () => {
    global.fetch = registryFetch({
      agents: [INACTIVE_AGENT],
      detail: { registered_agent: INACTIVE_AGENT, capabilities: [], invocations: [] },
      capabilities: [],
    });
    const { default: Page } = await import('../../app/agents/registry/page.jsx');
    render(<Page />);

    fireEvent.click(await screen.findByRole('button', { name: /Acme/ }));
    await waitFor(() => {
      expect(screen.getByText(/no capabilities exist in this workspace yet/i)).toBeTruthy();
    });
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(links).toContain('/capabilities/new');
    // The old misleading copy is gone for the zero-capability case.
    expect(screen.queryByText(/all capabilities are already grouped/i)).toBeNull();
  });

  it('a non-OK list response shows an error, not an empty registry', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'demo: endpoint disabled' }) }));
    const { default: Page } = await import('../../app/agents/registry/page.jsx');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/demo: endpoint disabled/i);
    });
  });
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, subtitle, children, actions }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children, className }) => <div className={className}>{children}</div>,
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title, description, action }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      <div>{action}</div>
    </div>
  ),
}));

describe('WorkflowsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createFetchMock() {
    return vi.fn(async (url, options = {}) => {
      if (String(url) === '/api/workflows/templates?limit=100') {
        return {
          ok: true,
          json: async () => ({
            templates: [
              {
                template_id: 'wft_test',
                name: 'Test workflow',
                slug: 'test-workflow',
                status: 'draft',
                version: 1,
                linked_policy_ids: [],
                linked_capability_ids: [],
                updated_at: new Date().toISOString(),
              },
              {
                template_id: 'wft_release',
                name: 'Release workflow',
                slug: 'release-workflow',
                status: 'active',
                version: 2,
                linked_policy_ids: ['gp_1'],
                linked_capability_ids: ['cap_1'],
                updated_at: new Date().toISOString(),
              },
            ],
          }),
        };
      }

      if (String(url) === '/api/workflows/templates/wft_test' && options.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({ deleted: true, template_id: 'wft_test' }),
        };
      }

      if (String(url) === '/api/workflows/templates/wft_release' && options.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({ deleted: true, template_id: 'wft_release' }),
        };
      }

      return { ok: true, json: async () => ({}) };
    });
  }

  it('shows a visible AI builder entry on the workflows list', async () => {
    global.fetch = createFetchMock();

    const { default: WorkflowsPage } = await import('@/workflows/page.jsx');
    render(<WorkflowsPage />);

    await screen.findByText(/workflow operations/i);
    expect(screen.getByRole('link', { name: /open ai workflow builder/i })).toBeTruthy();
    expect(screen.getByText(/describe it in plain english/i)).toBeTruthy();
  });

  it('lets the user select multiple workflows and delete them', async () => {
    global.fetch = createFetchMock();

    const { default: WorkflowsPage } = await import('@/workflows/page.jsx');
    render(<WorkflowsPage />);

    await screen.findByText(/test workflow/i);

    fireEvent.click(screen.getByRole('button', { name: /select multiple/i }));
    fireEvent.click(screen.getByLabelText(/select test workflow/i));
    fireEvent.click(screen.getByRole('button', { name: /delete selected \(1\)/i }));

    // Destructive bulk delete is a two-step inline confirmation now (window.confirm is banned).
    expect(screen.getByText(/delete 1 template\?/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }));

    await waitFor(() => {
      // Bulk delete fans out plain same-origin DELETEs; the server resolves the
      // caller's role from the session (the old inert x-org-role header was removed).
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/workflows/templates/wft_test',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    expect(screen.queryByText(/test workflow/i)).toBeNull();
    expect(screen.getByText(/release workflow/i)).toBeTruthy();
  });
});

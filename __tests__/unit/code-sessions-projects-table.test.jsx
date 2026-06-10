import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import ProjectsTable from '../../app/code-sessions/ProjectsTable';

function project(overrides = {}) {
  return {
    id: 'cp_' + Math.random().toString(36).slice(2, 10),
    slug: 'c--projects-dashclaw',
    cwd: null,
    session_count: 4,
    total_cost_usd: 12.5,
    last_session_at: '2026-06-10T12:00:00Z',
    ...overrides,
  };
}

describe('ProjectsTable — real path display', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the real cwd as the primary label with a copy affordance, slug secondary', () => {
    render(<ProjectsTable projects={[project({ id: 'cp_1', cwd: 'C:\\Projects\\DashClaw' })]} />);

    // Path is the headline (exactly as stored — no case mangling)…
    expect(screen.getByText('C:\\Projects\\DashClaw')).toBeTruthy();
    // …slug demoted to the secondary line…
    expect(screen.getByText('c--projects-dashclaw')).toBeTruthy();
    // …with a copy button that yields the pasteable path without navigating.
    const copyBtn = screen.getByRole('button', { name: /copy path C:\\Projects\\DashClaw/i });
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('C:\\Projects\\DashClaw');
  });

  it('falls back to the slug headline when cwd is null', () => {
    render(<ProjectsTable projects={[project({ id: 'cp_2', cwd: null })]} />);
    expect(screen.getByText('c--projects-dashclaw')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy path/i })).toBeNull();
  });

  it('keeps row links and entity tags for the context-menu integration', () => {
    const { container } = render(<ProjectsTable projects={[project({ id: 'cp_3', cwd: '/home/wes/app' })]} />);
    const row = container.querySelector('[data-entity-type="codeSession"][data-entity-id="cp_3"]');
    expect(row).toBeTruthy();
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/code-sessions/cp_3');
  });
});

describe('ProjectsTable — clear all typed confirm', () => {
  it('keeps the destructive button disabled until DELETE is typed', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ deleted: true }) }));
    render(<ProjectsTable projects={[project({ id: 'cp_4' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    const confirmBtn = screen.getByRole('button', { name: /clear everything/i });
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'DELETE' } });
    expect(confirmBtn.disabled).toBe(false);

    fireEvent.click(confirmBtn);
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/code-sessions/projects?confirm=all',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});

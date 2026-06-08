import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...props }) => <a href={href} onClick={onClick} {...props}>{children}</a>,
}));

const { roleRef, rt } = vi.hoisted(() => ({
  roleRef: { current: { isAdmin: true, settled: true } },
  rt: { cb: null },
}));
vi.mock('@/hooks/useEffectiveRole', () => ({ useEffectiveRole: () => roleRef.current }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: (cb) => { rt.cb = cb; } }));

import NotificationCenter from '@/components/NotificationCenter';

let pendingState = [];
let postCalls = [];
function installFetch(initial) {
  pendingState = [...initial];
  postCalls = [];
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    if (u.includes('/api/approvals/') && method === 'POST') {
      const id = u.split('/api/approvals/')[1];
      const body = JSON.parse(opts.body);
      postCalls.push({ id, decision: body.decision });
      pendingState = pendingState.filter((a) => a.action_id !== id);
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes('/api/actions')) return { ok: true, json: async () => ({ actions: pendingState }) };
    return { ok: true, json: async () => ({}) };
  });
}

const PENDING = [
  { action_id: 'act_1', agent_name: 'planner', declared_goal: 'Deploy to prod', risk_score: 80 },
  { action_id: 'act_2', agent_name: 'builder', declared_goal: 'Drop table', risk_score: 95 },
];

async function openBell() {
  const bell = await waitFor(() => screen.getByRole('button', { name: /Notifications/i }));
  fireEvent.click(bell);
  return screen.getByRole('dialog', { name: 'Notifications' });
}

beforeEach(() => {
  roleRef.current = { isAdmin: true, settled: true };
  rt.cb = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NotificationCenter — pending approvals', () => {
  it('shows pending items with agent + goal + risk and inline Approve/Deny for admins', async () => {
    installFetch(PENDING);
    render(<NotificationCenter />);
    const dialog = await openBell();
    await waitFor(() => expect(within(dialog).getByText('Deploy to prod')).toBeTruthy());
    expect(within(dialog).getByText('planner')).toBeTruthy();
    expect(within(dialog).getByText(/risk 80/)).toBeTruthy();
    expect(within(dialog).getAllByRole('button', { name: /^Approve/ }).length).toBe(2);
    expect(within(dialog).getAllByRole('button', { name: /^Deny/ }).length).toBe(2);
  });

  it('Approve fires POST /api/approvals/:id {decision:"allow"} and removes the item', async () => {
    installFetch(PENDING);
    render(<NotificationCenter />);
    const dialog = await openBell();
    await waitFor(() => within(dialog).getByText('Deploy to prod'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve Deploy to prod' }));
    await waitFor(() => expect(postCalls).toContainEqual({ id: 'act_1', decision: 'allow' }));
    await waitFor(() => expect(within(dialog).queryByText('Deploy to prod')).toBeNull());
  });

  it('Deny fires POST /api/approvals/:id {decision:"deny"}', async () => {
    installFetch(PENDING);
    render(<NotificationCenter />);
    const dialog = await openBell();
    await waitFor(() => within(dialog).getByText('Drop table'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deny Drop table' }));
    await waitFor(() => expect(postCalls).toContainEqual({ id: 'act_2', decision: 'deny' }));
  });

  it('non-admin sees read-only pending items (no Approve/Deny buttons)', async () => {
    roleRef.current = { isAdmin: false, settled: true };
    installFetch(PENDING);
    render(<NotificationCenter />);
    const dialog = await openBell();
    await waitFor(() => within(dialog).getByText('Deploy to prod'));
    expect(within(dialog).queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Deny/ })).toBeNull();
  });

  it('links "View all" to /approvals', async () => {
    installFetch(PENDING);
    render(<NotificationCenter />);
    const dialog = await openBell();
    const viewAll = await waitFor(() => within(dialog).getByText(/View all/));
    expect(viewAll.getAttribute('href')).toBe('/approvals');
  });

  it('badge reflects pending count and updates on action.updated', async () => {
    installFetch([PENDING[0]]);
    render(<NotificationCenter />);
    await waitFor(() => expect(screen.getByRole('button', { name: /1 pending approval/ })).toBeTruthy());
    // A new pending action arrives; the realtime tick refetches → badge grows.
    pendingState = [...PENDING];
    rt.cb('action.updated', {});
    await waitFor(() => expect(screen.getByRole('button', { name: /2 pending approvals/ })).toBeTruthy());
  });
});

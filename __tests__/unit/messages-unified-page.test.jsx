import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the unified comms-ledger page contract: no Inbox/Sent webmail tabs,
// every filter chip maps to existing SERVER params (no client re-filtering),
// the swarm ?agents= deep link actually filters, and ?thread= selects a
// thread. The fetch URLs are the contract — assert them, not the markup.

let mockParams = new URLSearchParams();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, actions, children }) => (
    <div>
      <h1>{title}</h1>
      {actions}
      {children}
    </div>
  ),
}));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: ({ title }) => <div>{title}</div> }));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('@/messages/_components/ComposeModal', () => ({ default: () => null }));
vi.mock('@/messages/_components/CreateThreadForm', () => ({ default: () => null }));
vi.mock('@/messages/_components/MessageDetail', () => ({
  default: ({ message }) => <div>detail:{message.id}</div>,
}));
vi.mock('@/messages/_components/ThreadConversation', () => ({
  default: ({ thread }) => <div>thread-conv:{thread.id}</div>,
}));

// jsdom doesn't implement scrollIntoView (selected rows keep themselves visible).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const { default: MessagesPage } = await import('@/messages/page.jsx');

const THREAD = {
  id: 'mt_1', name: 'Incident sync', status: 'open', message_count: 2,
  created_by: 'agent-a', participants: '[]',
  last_message_at: '2026-06-10T12:00:00Z', created_at: '2026-06-09T10:00:00Z',
};
const MESSAGE = {
  id: 'msg_1', from_agent_id: 'agent-a', to_agent_id: null, message_type: 'question',
  body: 'Need a decision on the rollout', status: 'sent', is_read: false,
  created_at: '2026-06-10T11:00:00Z',
};

let fetchCalls = [];

function installFetch() {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    // Specific prefixes first — '/api/messages' would shadow '/api/messages/threads'.
    if (u.startsWith('/api/messages/threads')) {
      return { ok: true, json: async () => ({ threads: [THREAD] }) };
    }
    if (u.startsWith('/api/messages')) {
      return { ok: true, json: async () => ({ messages: [MESSAGE], total: 1, unread_count: 1 }) };
    }
    if (u.startsWith('/api/agents')) {
      return { ok: true, json: async () => ({ agents: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

beforeEach(() => {
  mockParams = new URLSearchParams();
  fetchCalls = [];
  installFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Messages — unified ledger page', () => {
  it('default All view fetches direction=all AND threads, renders both row kinds, no Inbox/Sent tabs', async () => {
    render(<MessagesPage />);

    await waitFor(() => {
      expect(fetchCalls.some(u => u.startsWith('/api/messages?') && u.includes('direction=all'))).toBe(true);
      expect(fetchCalls.some(u => u.startsWith('/api/messages/threads'))).toBe(true);
    });

    // Unified list shows a thread row and a standalone message row together
    expect(await screen.findByText('Incident sync')).toBeTruthy();
    expect(await screen.findByText('Need a decision on the rollout')).toBeTruthy();

    // The webmail IA is gone
    expect(screen.queryByText('Inbox')).toBeNull();
    expect(screen.queryByText('Sent')).toBeNull();
  });

  it('Needs input chip fetches type=question and type=action server-side', async () => {
    render(<MessagesPage />);
    await screen.findByText('Incident sync');
    fetchCalls = [];

    fireEvent.click(screen.getByText('Needs input'));

    await waitFor(() => {
      expect(fetchCalls.some(u => u.includes('type=question'))).toBe(true);
      expect(fetchCalls.some(u => u.includes('type=action'))).toBe(true);
    });
    // No thread fetch on this chip
    expect(fetchCalls.some(u => u.startsWith('/api/messages/threads'))).toBe(false);
  });

  it('Broadcasts chip fetches direction=inbox&agent_id=all', async () => {
    render(<MessagesPage />);
    await screen.findByText('Incident sync');
    fetchCalls = [];

    fireEvent.click(screen.getByText('Broadcasts'));

    await waitFor(() => {
      expect(fetchCalls.some(u => u.includes('direction=inbox') && u.includes('agent_id=all'))).toBe(true);
    });
  });

  it('?agents=alpha,beta deep link fetches per-agent and shows a clearable banner', async () => {
    mockParams = new URLSearchParams('agents=alpha,beta');
    render(<MessagesPage />);

    await waitFor(() => {
      expect(fetchCalls.some(u => u.includes('agent_id=alpha'))).toBe(true);
      expect(fetchCalls.some(u => u.includes('agent_id=beta'))).toBe(true);
    });

    expect(screen.getByText('alpha, beta')).toBeTruthy();
    fireEvent.click(screen.getByText('Clear'));
    expect(mockReplace).toHaveBeenCalledWith('/messages');
  });

  it('?thread=mt_1 deep link selects the thread in the detail pane', async () => {
    mockParams = new URLSearchParams('thread=mt_1');
    render(<MessagesPage />);

    expect(await screen.findByText('thread-conv:mt_1')).toBeTruthy();
  });
});

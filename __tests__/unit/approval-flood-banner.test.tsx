import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import ApprovalFloodBanner from '@/components/ApprovalFloodBanner';

const flood = { policy_id: 'gp_a', name: '[Tightened] other', count: 47, tripped_at: '2026-06-11T00:00:00Z' };

beforeEach(() => vi.restoreAllMocks());

describe('ApprovalFloodBanner', () => {
  it('renders nothing when there is no flood', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ floods: [], budget: null }) })));
    const { container } = render(<ApprovalFloodBanner />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders the flood with two-step confirmed bulk deny', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ resolved: 47, failed: 0, matched: 47 }) };
      return { ok: true, json: async () => ({ floods: [flood], budget: { perPolicy: 10, windowMin: 15, fleetWide: 30 } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<ApprovalFloodBanner />);
    await waitFor(() => expect(container.textContent).toContain('[Tightened] other'));

    fireEvent.click(getByText(/deny all/i));
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')).toHaveLength(0);
    fireEvent.click(getByText(/^confirm$/i));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({ decision: 'deny', filter: { policy_id: 'gp_a' } });
    });
  });

  it('pause rule PATCHes the policy inactive after confirm', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => ({ floods: [flood], budget: { perPolicy: 10, windowMin: 15, fleetWide: 30 } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<ApprovalFloodBanner />);
    await waitFor(() => expect(container.textContent).toContain('[Tightened] other'));
    fireEvent.click(getByText(/pause rule/i));
    fireEvent.click(getByText(/^confirm$/i));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH');
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ id: 'gp_a', active: 0 });
    });
  });
});

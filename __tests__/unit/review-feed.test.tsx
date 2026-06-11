// __tests__/unit/review-feed.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import ReviewFeed from '@/policies/components/ReviewFeed';

const group = {
  shape: { action_type: 'api', target_prefix: 'api.stripe.com', key: 'api::api.stripe.com', label: 'api → api.stripe.com' },
  count: 23,
  latest_at: '2026-06-10T02:00:00Z',
  sample_id: 'gd_1',
  sample_goal: 'call stripe',
};

describe('ReviewFeed', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders warn groups with counts and verdict buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('/review')
          ? { groups: [group], interrupts: [], cursor: '2026-06-03T00:00:00Z' }
          : {},
    })));
    const { container } = render(<ReviewFeed />);
    await waitFor(() => {
      expect(container.textContent).toContain('api → api.stripe.com');
      expect(container.textContent).toContain('23');
    });
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
  });

  it('posts an always_allow verdict and removes the group', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) };
      return {
        ok: true,
        json: async () => ({ groups: [group], interrupts: [], cursor: '2026-06-03T00:00:00Z' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<ReviewFeed />);
    await waitFor(() => expect(container.textContent).toContain('api → api.stripe.com'));
    fireEvent.click(getByText(/always allow/i));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
        verdict: 'always_allow',
        shape: { action_type: 'api' },
      });
    });
  });

  it('shows the empty state when nothing needs review', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ groups: [], interrupts: [], cursor: '2026-06-03T00:00:00Z' }),
    })));
    const { container } = render(<ReviewFeed />);
    await waitFor(() => expect(container.textContent).toMatch(/nothing to review/i));
  });
});

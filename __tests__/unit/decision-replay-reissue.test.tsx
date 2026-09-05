import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DecisionReplayPage from '../../app/decisions/[actionId]/page';

let actionId = 'act_first';
vi.mock('next/navigation', () => ({ useParams: () => ({ actionId }) }));
vi.mock('../../app/components/PageLayout', () => ({
  default: ({ subtitle, children, actions }: any) => <div><p>{subtitle}</p>{actions}{children}</div>,
}));
vi.mock('../../app/components/ExecutionGraph', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); actionId = 'act_first'; });

it('ignores a reissue completion for a decision the operator has left', async () => {
  let finishReissue: (value: any) => void;
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === 'POST') return new Promise(resolve => { finishReissue = resolve; });
    if (url === '/api/actions/act_first' || url === '/api/actions/act_second') {
      const id = url.split('/').pop();
      return Promise.resolve({ ok: true, json: async () => ({ action: {
        action_id: id, agent_id: 'agent', declared_goal: id,
        action_type: 'test', status: 'completed', containment_status: 'promoted',
        timestamp_start: '2026-09-05T00:00:00Z',
      } }) });
    }
    return new Promise(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<DecisionReplayPage />);
  await waitFor(() => expect(screen.getByText('agent -- act_first')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Re-issue merge grant' }));
  actionId = 'act_second';
  view.rerender(<DecisionReplayPage />);
  await waitFor(() => expect(screen.getByText('agent -- act_second')).toBeTruthy());
  await act(async () => finishReissue!({ ok: true }));
  expect(screen.getByText('agent -- act_second')).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/actions/act_first')).toHaveLength(1);
});

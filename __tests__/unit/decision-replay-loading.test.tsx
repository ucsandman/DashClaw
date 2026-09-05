import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import DecisionReplayPage from '../../app/decisions/[actionId]/page';

let actionId = 'act_first';
vi.mock('next/navigation', () => ({ useParams: () => ({ actionId }) }));
vi.mock('../../app/components/PageLayout', () => ({
  default: ({ title, subtitle, children, actions }: any) => <div><h1>{title}</h1><p>{subtitle}</p>{actions}{children}</div>,
}));
vi.mock('../../app/components/ExecutionGraph', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); actionId = 'act_first'; });

function response(goal: string) {
  return { ok: true, json: async () => ({ action: {
    action_id: actionId, agent_id: 'agent', declared_goal: goal,
    action_type: 'test', status: 'completed', timestamp_start: '2026-09-05T00:00:00Z',
  } }) };
}

it('renders the primary decision while graph, trace and legacy guard remain pending', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/actions/act_first'
    ? Promise.resolve(response('primary decision ready')) : new Promise(() => {})));
  render(<DecisionReplayPage />);
  await waitFor(() => expect(screen.getByText('agent -- primary decision ready')).toBeTruthy());
  expect(screen.queryByText('ALLOW')).toBeNull();
});

it('does not let an older base response replace the current decision', async () => {
  let resolveFirst: (value: any) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/actions/act_first') return new Promise(resolve => { resolveFirst = resolve; });
    if (url === '/api/actions/act_second') return Promise.resolve(response('current decision'));
    return new Promise(() => {});
  }));
  const view = render(<DecisionReplayPage />);
  actionId = 'act_second';
  view.rerender(<DecisionReplayPage />);
  await waitFor(() => expect(screen.getByText('agent -- current decision')).toBeTruthy());
  await act(async () => resolveFirst!(response('outdated decision')));
  expect(screen.queryByText('agent -- outdated decision')).toBeNull();
  expect(screen.getByText('agent -- current decision')).toBeTruthy();
});

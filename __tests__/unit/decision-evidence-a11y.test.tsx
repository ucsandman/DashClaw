import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DecisionReplayPage from '../../app/decisions/[actionId]/page';

vi.mock('next/navigation', () => ({ useParams: () => ({ actionId: 'act_evidence' }) }));
vi.mock('../../app/components/PageLayout', () => ({
  default: ({ title, subtitle, children, actions }: any) => <main><h1>{title}</h1><p>{subtitle}</p>{actions}{children}</main>,
}));
vi.mock('../../app/components/ExecutionGraph', () => ({ default: () => <div>graph view</div> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('preserves confidence zero, separates provenance assertions, and supports arrow-key tabs', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/actions/act_evidence'
    ? Promise.resolve({ ok: true, json: async () => ({ action: {
      action_id: 'act_evidence', agent_id: 'agent', declared_goal: 'Review evidence', action_type: 'review',
      status: 'completed', timestamp_start: '2026-09-05T00:00:00Z', confidence: 0,
      provenance: { identity_verified: true, payload_signature: 'missing' },
    } }) })
    : new Promise(() => {})));

  render(<DecisionReplayPage />);
  await waitFor(() => expect(screen.getByText('0%')).toBeTruthy());
  expect(screen.getByText('Verified identity')).toBeTruthy();
  expect(screen.getByText('Payload signature missing')).toBeTruthy();

  const timeline = screen.getByRole('tab', { name: 'Timeline' });
  const graph = screen.getByRole('tab', { name: 'Graph' });
  expect(timeline.getAttribute('aria-selected')).toBe('true');
  timeline.focus();
  fireEvent.keyDown(timeline, { key: 'ArrowRight' });
  expect(graph.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(graph);
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('decision-tab-graph');
});

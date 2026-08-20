import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TeamTaskTimeline from '../../app/team-tasks/_components/TeamTaskTimeline';

describe('TeamTaskTimeline', () => {
  it('renders an empty state when there are no events', () => {
    render(<TeamTaskTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeTruthy();
  });

  it('renders one row per event with agent, type label and summary', () => {
    render(<TeamTaskTimeline events={[
      { id: 1, ts: '2026-07-10T01:00:00Z', from_agent: 'claude', to_agent: 'openclaw', type: 'delegation', summary: 'asked for cron facts' },
      { id: 2, ts: '2026-07-10T01:01:00Z', from_agent: 'openclaw', to_agent: 'claude', type: 'reply', summary: 'answered', body: 'every 2 hours' },
    ]} />);
    expect(screen.getByText('asked for cron facts')).toBeTruthy();
    expect(screen.getByText('answered')).toBeTruthy();
    expect(screen.getByText(/delegation/i)).toBeTruthy();
    expect(screen.getByText('every 2 hours')).toBeTruthy();
  });

  it('renders a Practical Systems cycle exchange by agent name (mission-control -> forge -> reply)', () => {
    render(<TeamTaskTimeline events={[
      { id: 4, ts: '2026-08-20T10:00:00Z', from_agent: 'mission-control', to_agent: 'forge', type: 'delegation', summary: 'step_06_build_wait: directive to forge', body: 'Review this build.' },
      { id: 5, ts: '2026-08-20T10:03:00Z', from_agent: 'forge', to_agent: 'mission-control', type: 'reply', summary: 'BLOCK: licence check is client-side only' },
      { id: 6, ts: '2026-08-20T10:04:00Z', from_agent: 'ps-qa', to_agent: 'moltfire', type: 'status', summary: 'step 8 qa: pass' },
    ]} />);
    expect(screen.getByText('mission-control → forge')).toBeTruthy();
    expect(screen.getByText('forge → mission-control')).toBeTruthy();
    expect(screen.getByText('ps-qa → moltfire')).toBeTruthy();
    expect(screen.getByText('BLOCK: licence check is client-side only')).toBeTruthy();
  });

  it('marks approval_needed events with the warning treatment', () => {
    const { container } = render(<TeamTaskTimeline events={[
      { id: 3, ts: '2026-07-10T01:02:00Z', from_agent: 'openclaw', to_agent: 'wes', type: 'approval_needed', summary: 'post needs approval' },
    ]} />);
    expect(container.querySelector('.bg-warning-subtle')).toBeTruthy();
  });
});

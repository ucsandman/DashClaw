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

  it('marks approval_needed events with the warning treatment', () => {
    const { container } = render(<TeamTaskTimeline events={[
      { id: 3, ts: '2026-07-10T01:02:00Z', from_agent: 'openclaw', to_agent: 'wes', type: 'approval_needed', summary: 'post needs approval' },
    ]} />);
    expect(container.querySelector('.bg-warning-subtle')).toBeTruthy();
  });
});

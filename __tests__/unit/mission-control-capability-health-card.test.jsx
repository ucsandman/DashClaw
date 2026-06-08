import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title, action, count }) => (
    <div>
      <span>{title}</span>
      {count !== undefined ? <span>{count}</span> : null}
      {action}
    </div>
  ),
  CardContent: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

describe('MissionControlCapabilityHealthCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders capability posture counts and urgent capabilities in priority order', async () => {
    const { default: MissionControlCapabilityHealthCard } = await import('@/components/MissionControlCapabilityHealthCard.jsx');

    render(
      <MissionControlCapabilityHealthCard
        loading={false}
        error={null}
        capabilities={[
          {
            capability_id: 'cap_2',
            capability_name: 'Send Slack Message',
            status: 'unhealthy',
            certification_status: 'failed',
            stale_check: true,
          },
          {
            capability_id: 'cap_3',
            capability_name: 'Calendar Create',
            status: 'degraded',
            certification_status: 'stale',
            stale_check: true,
          },
          {
            capability_id: 'cap_4',
            capability_name: 'CRM Lookup',
            status: 'healthy',
            certification_status: 'uncertified',
            stale_check: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('Capability Health')).toBeTruthy();
    expect(screen.getByText('1 unhealthy')).toBeTruthy();
    expect(screen.getByText('2 stale')).toBeTruthy();
    expect(screen.getByText('1 uncertified')).toBeTruthy();

    const urgentLinks = screen.getAllByRole('link', { name: /send slack message|calendar create|crm lookup/i });
    expect(urgentLinks[0].getAttribute('href')).toBe('/capabilities/cap_2');
    expect(urgentLinks[1].getAttribute('href')).toBe('/capabilities/cap_3');
    expect(urgentLinks[2].getAttribute('href')).toBe('/capabilities/cap_4');

    // Right-click resolves each row as a capability entity (Phase 2 ref wiring).
    expect(urgentLinks[0].getAttribute('data-entity-type')).toBe('capability');
    expect(urgentLinks[0].getAttribute('data-entity-id')).toBe('cap_2');
  });

  it('renders a graceful unavailable state when capability health is missing', async () => {
    const { default: MissionControlCapabilityHealthCard } = await import('@/components/MissionControlCapabilityHealthCard.jsx');

    render(
      <MissionControlCapabilityHealthCard
        loading={false}
        error="Capability health unavailable"
        capabilities={[]}
      />,
    );

    expect(screen.getByText('Capability Health')).toBeTruthy();
    expect(screen.getByText(/capability health unavailable/i)).toBeTruthy();
  });
});

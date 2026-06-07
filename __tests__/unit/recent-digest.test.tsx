import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }));

import RecentDigest from '@/policies/components/RecentDigest';
import type { RecentDecision } from '@/policies/components/RecentDigest';

function at(hh: number, mm: number): string {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

const DECISIONS: RecentDecision[] = [
  { id: 'd1', decision: 'block', agentLabel: 'deploy-bot', actionType: 'shell.exec', createdAt: at(9, 5) },
  { id: 'd2', decision: 'require_approval', agentLabel: 'ops-bot', actionType: 'db.write', createdAt: at(10, 30) },
  { id: 'd3', decision: 'warn', agentLabel: 'dev-bot', actionType: 'file.edit', createdAt: at(11, 0) },
  { id: 'd4', decision: 'allow', agentLabel: 'read-bot', actionType: 'file.read', createdAt: at(12, 15) },
  { id: 'd5', decision: 'allow', agentLabel: 'a5', actionType: 'x', createdAt: at(13, 0) },
  { id: 'd6', decision: 'allow', agentLabel: 'a6', actionType: 'y', createdAt: at(14, 0) },
];

describe('RecentDigest', () => {
  it('renders at most 5 rows', () => {
    render(<RecentDigest decisions={DECISIONS} />);
    expect(screen.getByText('deploy-bot')).toBeTruthy();
    expect(screen.getByText('a5')).toBeTruthy();
    // 6th row dropped.
    expect(screen.queryByText('a6')).toBeNull();
  });

  it('colors decisions by outcome and uppercases the label', () => {
    render(<RecentDigest decisions={DECISIONS} />);
    expect(screen.getByText('BLOCK').className).toContain('text-error');
    expect(screen.getByText('REQUIRE_APPROVAL').className).toContain('text-warning');
    expect(screen.getByText('WARN').className).toContain('text-warning');
    expect(screen.getAllByText('ALLOW')[0].className).toContain('text-tertiary');
  });

  it('renders the HH:MM time', () => {
    render(<RecentDigest decisions={DECISIONS} />);
    expect(screen.getByText('09:05')).toBeTruthy();
    expect(screen.getByText('10:30')).toBeTruthy();
  });

  it('shows the /decisions link', () => {
    render(<RecentDigest decisions={DECISIONS} />);
    const link = screen.getByText(/All decisions on \/decisions/).closest('a');
    expect(link?.getAttribute('href')).toBe('/decisions');
  });

  it('renders the empty state when there are no decisions', () => {
    render(<RecentDigest decisions={[]} />);
    expect(screen.getByText('No decisions yet.')).toBeTruthy();
  });
});

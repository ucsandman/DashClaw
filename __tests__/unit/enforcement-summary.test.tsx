import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }));

import EnforcementSummary from '@/policies/components/EnforcementSummary';

const ENFORCEMENT = { total: 4, warn: 1, require_approval: 1, block: 2 };
const RULES = [
  { id: 'r1', name: 'Block destructive shell', bucket: 'block' as const, fired30d: 5, lastFiredAt: null },
  { id: 'r2', name: 'Block secret exfil', bucket: 'block' as const, fired30d: 0, lastFiredAt: null },
  { id: 'r3', name: 'Approve prod deploys', bucket: 'require_approval' as const, fired30d: 2, lastFiredAt: null },
  { id: 'r4', name: 'Warn on large diffs', bucket: 'warn' as const, fired30d: 9, lastFiredAt: null },
];
const DECISIONS = { total: 100, allow: 80, warn: 9, require_approval: 7, block: 4 };

describe('EnforcementSummary', () => {
  it('shows the signal-only line with warn/approval/block counts', () => {
    render(<EnforcementSummary enforcement={ENFORCEMENT} rules={RULES} decisions30d={DECISIONS} />);
    // The signal sentence reads as one prose line; assert on the whole paragraph.
    const para = screen.getByText(/everything else runs without interruption/).closest('p');
    const text = para?.textContent ?? '';
    expect(text).toContain('1 warn');
    expect(text).toContain('1 require approval');
    expect(text).toContain('2 block');
  });

  it('reveals grouped rule names with fired counts via View rules', () => {
    render(<EnforcementSummary enforcement={ENFORCEMENT} rules={RULES} decisions30d={DECISIONS} />);
    // Rules hidden until disclosed.
    expect(screen.queryByText('Block destructive shell')).toBeNull();
    fireEvent.click(screen.getByText('View rules'));
    expect(screen.getByText('Block destructive shell')).toBeTruthy();
    expect(screen.getByText('Approve prod deploys')).toBeTruthy();
    expect(screen.getByText(/fired 5/)).toBeTruthy();
    // fired30d === 0 omits the count for that rule.
    expect(screen.queryByText(/fired 0/)).toBeNull();
  });

  it('links Edit rules to /policies/rules', () => {
    render(<EnforcementSummary enforcement={ENFORCEMENT} rules={RULES} decisions30d={DECISIONS} />);
    fireEvent.click(screen.getByText('View rules'));
    const link = screen.getByText(/Edit rules/).closest('a');
    expect(link?.getAttribute('href')).toBe('/policies/rules');
  });

  it('shows the 30-day decision outcome counts', () => {
    render(<EnforcementSummary enforcement={ENFORCEMENT} rules={RULES} decisions30d={DECISIONS} />);
    expect(screen.getByText(/DECISIONS/i)).toBeTruthy();
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('allowed')).toBeTruthy();
    expect(screen.getByText('blocked')).toBeTruthy();
  });

  it('colors blocked count with error token when > 0', () => {
    render(<EnforcementSummary enforcement={ENFORCEMENT} rules={RULES} decisions30d={DECISIONS} />);
    expect(screen.getByText('4').className).toContain('text-error');
  });
});

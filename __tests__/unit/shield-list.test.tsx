import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ShieldList from '@/policies/components/ShieldList';

const SHIELDS = [
  { id: 's1', name: 'Block secret exfil', description: 'Stops secret leaks', on: true, fired30d: 3, lastFiredAt: null },
  { id: 's2', name: 'Quiet shield', description: 'On but quiet', on: true, fired30d: 0, lastFiredAt: null },
  { id: 's3', name: 'Rate limiter', description: 'Caps call rate', on: false, fired30d: 0, lastFiredAt: null },
];

describe('ShieldList', () => {
  it('shows the on/total summary', () => {
    render(<ShieldList shields={SHIELDS} onToggle={vi.fn()} />);
    expect(screen.getByText('2 of 3 on')).toBeTruthy();
  });

  it('renders ON shields with their fired count, OFF shield hidden by default', () => {
    render(<ShieldList shields={SHIELDS} onToggle={vi.fn()} />);
    expect(screen.getByText('Block secret exfil')).toBeTruthy();
    expect(screen.getByText(/fired 3/)).toBeTruthy();
    expect(screen.getByText('quiet')).toBeTruthy();
    // OFF shield lives behind manage.
    expect(screen.queryByText('Rate limiter')).toBeNull();
  });

  it('calls onToggle(id, next) when a switch is toggled', () => {
    const onToggle = vi.fn();
    render(<ShieldList shields={SHIELDS} onToggle={onToggle} />);
    const sw = screen.getByLabelText('Disable Block secret exfil');
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledWith('s1', false);
  });

  it('reveals OFF shields under manage and can enable them', () => {
    const onToggle = vi.fn();
    render(<ShieldList shields={SHIELDS} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('manage'));
    expect(screen.getByText('Rate limiter')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Enable Rate limiter'));
    expect(onToggle).toHaveBeenCalledWith('s3', true);
  });

  it('disables the switch for the busy shield', () => {
    render(<ShieldList shields={SHIELDS} onToggle={vi.fn()} busyId="s1" />);
    const sw = screen.getByLabelText('Disable Block secret exfil') as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
  });

  it('renders only the header + empty note when no shields are on', () => {
    const allOff = SHIELDS.map((s) => ({ ...s, on: false }));
    render(<ShieldList shields={allOff} onToggle={vi.fn()} />);
    expect(screen.getByText('0 of 3 on')).toBeTruthy();
    expect(screen.getByText('No shields on')).toBeTruthy();
    // No ON rows.
    expect(screen.queryByLabelText('Disable Block secret exfil')).toBeNull();
  });

  it('highlights the ?policy deep-link target by name (case-insensitive)', () => {
    const { container } = render(<ShieldList shields={SHIELDS} onToggle={vi.fn()} highlight="block secret exfil" />);
    const highlighted = container.querySelectorAll('[data-policy-highlight="true"]');
    expect(highlighted.length).toBe(1);
    expect(highlighted[0]!.textContent).toContain('Block secret exfil');
  });

  it('highlights the deep-link target by id', () => {
    const { container } = render(<ShieldList shields={SHIELDS} onToggle={vi.fn()} highlight="s2" />);
    const highlighted = container.querySelector('[data-policy-highlight="true"]');
    expect(highlighted?.textContent).toContain('Quiet shield');
  });

  it('auto-reveals an OFF shield when it is the deep-link target', () => {
    // Rate limiter (s3) is OFF (behind manage) — highlighting it must open the disclosure.
    render(<ShieldList shields={SHIELDS} onToggle={vi.fn()} highlight="s3" />);
    expect(screen.getByText('Rate limiter')).toBeTruthy();
  });

  it('highlights nothing when the param matches no shield', () => {
    const { container } = render(<ShieldList shields={SHIELDS} onToggle={vi.fn()} highlight="nope" />);
    expect(container.querySelectorAll('[data-policy-highlight="true"]').length).toBe(0);
  });
});

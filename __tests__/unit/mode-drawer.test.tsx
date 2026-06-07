import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchModes = vi.fn();
const previewMode = vi.fn();
const importMode = vi.fn();

vi.mock('@/policies/lib/modesClient', () => ({
  fetchModes: (...a: unknown[]) => fetchModes(...a),
  previewMode: (...a: unknown[]) => previewMode(...a),
  importMode: (...a: unknown[]) => importMode(...a),
}));

import ModeDrawer from '@/policies/components/ModeDrawer';

const MODES = [
  { id: 'claude-code', name: 'Claude Code Mode', uxPromise: "Won't interrupt normal coding.", interruptionLevel: 'low', policy_count: 4 },
  { id: 'soc2', name: 'SOC 2 Mode', uxPromise: 'Everything sensitive is reviewed and auditable.', interruptionLevel: 'high', policy_count: 9 },
];

const PREVIEW = {
  mode: MODES[0],
  policies: [],
  summary: { total: 4, warn: 1, require_approval: 2, block: 1 },
  friction: {
    available: true,
    sample_size: 40,
    window_days: 30,
    summary: { total: 40, allow: 35, warn: 2, require_approval: 2, block: 1 },
    excluded_policy_types: ['rate_limit'],
  },
};

describe('ModeDrawer', () => {
  afterEach(() => {
    fetchModes.mockReset();
    previewMode.mockReset();
    importMode.mockReset();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ModeDrawer open={false} onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(fetchModes).not.toHaveBeenCalled();
  });

  it('lists modes from fetchModes when open', async () => {
    fetchModes.mockResolvedValue(MODES);
    render(<ModeDrawer open onClose={vi.fn()} onApplied={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Claude Code Mode')).toBeTruthy());
    expect(screen.getByText('SOC 2 Mode')).toBeTruthy();
    expect(screen.getByText("Won't interrupt normal coding.")).toBeTruthy();
  });

  it('shows the impact preview when a mode is selected', async () => {
    fetchModes.mockResolvedValue(MODES);
    previewMode.mockResolvedValue(PREVIEW);
    render(<ModeDrawer open onClose={vi.fn()} onApplied={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Claude Code Mode')).toBeTruthy());
    fireEvent.click(screen.getByText('Claude Code Mode'));
    await waitFor(() => expect(previewMode).toHaveBeenCalledWith('claude-code'));
    // require_approval(2) + block(1) = 3 paused of 40.
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText(/excluded: rate_limit/)).toBeTruthy();
  });

  it('applies the selected mode then calls onApplied and onClose', async () => {
    fetchModes.mockResolvedValue(MODES);
    previewMode.mockResolvedValue(PREVIEW);
    importMode.mockResolvedValue({ mode_id: 'claude-code', imported: 4, skipped: 0, errors: [], policies: [] });
    const onApplied = vi.fn();
    const onClose = vi.fn();
    render(<ModeDrawer open onClose={onClose} onApplied={onApplied} />);
    await waitFor(() => expect(screen.getByText('Claude Code Mode')).toBeTruthy());
    fireEvent.click(screen.getByText('Claude Code Mode'));
    await waitFor(() => expect(previewMode).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Apply Claude Code Mode'));
    await waitFor(() => expect(importMode).toHaveBeenCalledWith('claude-code'));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces an apply error inline', async () => {
    fetchModes.mockResolvedValue(MODES);
    previewMode.mockResolvedValue(PREVIEW);
    importMode.mockRejectedValue(new Error('Apply failed (500)'));
    render(<ModeDrawer open onClose={vi.fn()} onApplied={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Claude Code Mode')).toBeTruthy());
    fireEvent.click(screen.getByText('Claude Code Mode'));
    await waitFor(() => expect(previewMode).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Apply Claude Code Mode'));
    await waitFor(() => expect(screen.getByText('Apply failed (500)')).toBeTruthy());
  });

  it('closes on Escape without applying', async () => {
    fetchModes.mockResolvedValue(MODES);
    const onClose = vi.fn();
    render(<ModeDrawer open onClose={onClose} onApplied={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Claude Code Mode')).toBeTruthy());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(importMode).not.toHaveBeenCalled();
  });
});

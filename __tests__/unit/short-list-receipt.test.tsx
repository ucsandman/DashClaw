import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchSummary = vi.fn();
const installPack = vi.fn();

vi.mock('@/policies/lib/modesClient', () => ({
  fetchSummary: (...a: unknown[]) => fetchSummary(...a),
}));

vi.mock('@/policies/lib/shortListClient', () => ({
  installPack: (...a: unknown[]) => installPack(...a),
}));

import ShortListReceipt from '@/connect/ShortListReceipt';
import type { ShortListLine } from '@/lib/policy-modes/summary';

function line(over: Partial<ShortListLine>): ShortListLine {
  return {
    id: 'gp_1',
    name: 'Mass destruction',
    tier: 'BLOCK',
    policy_type: 'block_action_type',
    scope: 'rm -rf outside a build dir, DROP TABLE, TRUNCATE',
    fired30d: 0,
    ungrantable: true,
    shape_exceptions: [],
    active: true,
    seeded: true,
    ...over,
  };
}

const LINES: ShortListLine[] = [
  line({}),
  line({ id: 'gp_2', name: 'Secret-file writes', tier: 'HOLD', policy_type: 'require_approval', scope: 'writes to .env, secrets/**' }),
  line({ id: 'gp_3', name: 'Force-push over main', tier: 'HOLD', policy_type: 'require_approval', scope: 'git push --force onto a protected branch' }),
  line({ id: 'gp_4', name: 'Runaway loop', tier: 'WATCH', policy_type: 'warn_action_type', scope: 'over 200 governed actions in 10 min' }),
  // Inactive lines are off — the receipt reports what is LIVE, so it must not list them.
  line({ id: 'gp_5', name: 'Dormant role constraint', tier: 'HOLD', policy_type: 'role_constraint', active: false }),
];

function summary(shortList: ShortListLine[]) {
  return { shortList, shortListCap: 10 };
}

beforeEach(() => {
  fetchSummary.mockReset();
  installPack.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShortListReceipt — the /connect receipt (B7)', () => {
  it('reports the live Short List with its tier chips and the two links', async () => {
    fetchSummary.mockResolvedValue(summary(LINES));

    render(<ShortListReceipt />);

    expect(await screen.findByText('Your Short List is live')).toBeTruthy();
    expect(
      screen.getByText(
        'One of these refuses outright. Two hold for your approval. Everything else runs and is recorded.',
      ),
    ).toBeTruthy();

    // The four active lines, in place, read-only.
    expect(screen.getByText('Mass destruction')).toBeTruthy();
    expect(screen.getByText('Secret-file writes')).toBeTruthy();
    expect(screen.getByText('Force-push over main')).toBeTruthy();
    expect(screen.getByText('Runaway loop')).toBeTruthy();
    // Off lines are not part of what is live.
    expect(screen.queryByText('Dormant role constraint')).toBeNull();

    // The chip carries the WORD, never colour alone.
    expect(screen.getByText('BLOCK')).toBeTruthy();
    expect(screen.getAllByText('HOLD')).toHaveLength(2);
    expect(screen.getByText('WATCH')).toBeTruthy();

    const review = screen.getByRole('link', { name: /Review the Short List/i });
    expect(review.getAttribute('href')).toBe('/policies');

    expect(
      screen.getByText('Add a pack when you want more than catastrophe coverage. Pack rules start in Watch.'),
    ).toBeTruthy();
    const packs = screen.getByRole('link', { name: /Browse policy packs/i });
    expect(packs.getAttribute('href')).toBe('/policies/packs');
  });

  it('offers the install card when nothing is on the list, and installs the catastrophe pack', async () => {
    fetchSummary.mockResolvedValue(summary([]));
    installPack.mockResolvedValue({ ok: true, status: 200, json: {} });

    render(<ShortListReceipt />);

    expect(await screen.findByText('Install the Short List')).toBeTruthy();
    expect(screen.queryByText('Your Short List is live')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(installPack).toHaveBeenCalledWith('catastrophe-only'));
    // A successful install re-reads the summary so the receipt replaces the card.
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
  });

  it('says so out loud when the install fails', async () => {
    fetchSummary.mockResolvedValue(summary([]));
    installPack.mockResolvedValue({ ok: false, status: 403, json: { error: 'Read-only demo instance.' } });

    render(<ShortListReceipt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not install — Read-only demo instance.');
    // Still the install card: nothing was installed, so nothing may claim to be live.
    expect(screen.queryByText('Your Short List is live')).toBeNull();
  });

  it('reports the real tier counts once the list drifts off the seeded shape', async () => {
    fetchSummary.mockResolvedValue(
      summary([line({}), line({ id: 'gp_b', tier: 'BLOCK', name: 'Second block' }), line({ id: 'gp_h', tier: 'HOLD', name: 'One hold' })]),
    );

    render(<ShortListReceipt />);

    expect(
      await screen.findByText('2 refuse outright. 1 holds for your approval. Everything else runs and is recorded.'),
    ).toBeTruthy();
  });

  it('drops the block clause entirely when the only BLOCK line is switched off', async () => {
    fetchSummary.mockResolvedValue(
      summary([line({ id: 'gp_h', tier: 'HOLD', name: 'Secret-file writes' }), line({ id: 'gp_w', tier: 'WATCH', name: 'Runaway loop' })]),
    );

    render(<ShortListReceipt />);

    expect(await screen.findByText('1 holds for your approval. Everything else runs and is recorded.')).toBeTruthy();
  });

  it('says nothing interrupts when every remaining line is WATCH', async () => {
    fetchSummary.mockResolvedValue(summary([line({ id: 'gp_w', tier: 'WATCH', name: 'Runaway loop' })]));

    render(<ShortListReceipt />);

    expect(await screen.findByText('Everything here is watched and recorded; nothing interrupts.')).toBeTruthy();
  });

  it('treats an all-inactive list as empty', async () => {
    fetchSummary.mockResolvedValue(summary([line({ active: false })]));
    render(<ShortListReceipt />);
    expect(await screen.findByText('Install the Short List')).toBeTruthy();
  });

  it('falls back to the pack line when the summary cannot be read (signed-out visitor)', async () => {
    fetchSummary.mockRejectedValue(new Error('401'));

    render(<ShortListReceipt />);

    expect(
      await screen.findByText('Add a pack when you want more than catastrophe coverage. Pack rules start in Watch.'),
    ).toBeTruthy();
    expect(screen.queryByText('Your Short List is live')).toBeNull();
    expect(screen.queryByText('Install the Short List')).toBeNull();
    expect(screen.getByRole('link', { name: /Browse policy packs/i }).getAttribute('href')).toBe('/policies/packs');
    // A lone line, not an empty card with a rule through it.
    const wrapper = screen.getByText(/Add a pack when you want more/).parentElement;
    expect(wrapper?.className).not.toMatch(/border-t|pt-4/);
  });
});

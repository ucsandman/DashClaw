import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const patchPolicy = vi.fn();
const createPolicy = vi.fn();
const installPack = vi.fn();
const fetchPolicyRules = vi.fn();

vi.mock('@/policies/lib/shortListClient', async () => {
  const actual = await vi.importActual<typeof import('@/policies/lib/shortListClient')>(
    '@/policies/lib/shortListClient',
  );
  return {
    ...actual,
    patchPolicy: (...a: unknown[]) => patchPolicy(...a),
    createPolicy: (...a: unknown[]) => createPolicy(...a),
    installPack: (...a: unknown[]) => installPack(...a),
    fetchPolicyRules: (...a: unknown[]) => fetchPolicyRules(...a),
  };
});

import ShortListSection from '@/policies/components/ShortListSection';
import type { PolicySummary, ShortListLine } from '@/lib/policy-modes/summary';

const OK = { ok: true, status: 200, json: {} };
const FULL = { ok: false, status: 409, json: { code: 'SHORT_LIST_FULL', error: 'The Short List is full.' } };

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
  line({ id: 'gp_2', name: 'Secret-file writes', tier: 'HOLD', policy_type: 'require_approval', fired30d: 1, scope: 'writes to .env, secrets/**' }),
  line({ id: 'gp_3', name: 'Real money', tier: 'HOLD', policy_type: 'require_approval', scope: 'payment, purchase, subscription' }),
  line({
    id: 'gp_4',
    name: 'Runaway loop',
    tier: 'WATCH',
    policy_type: 'warn_action_type',
    ungrantable: false,
    seeded: false,
    scope: 'over 200 governed actions in 10 min',
  }),
];

const SUGGESTION = {
  id: 'real_money' as const,
  title: 'Real money' as const,
  scope: 'payment, purchase, subscription, domain buy',
  rule: {
    policy_type: 'require_approval' as const,
    rules: { action: 'require_approval' as const, action_types: ['payment'], ungrantable: true as const, short_list: true as const },
  },
};

function summaryOf(shortList: ShortListLine[], suggestions: PolicySummary['suggestions'] = []): PolicySummary {
  return { shortList, shortListCap: 10, suggestions } as unknown as PolicySummary;
}

function renderSection(summary: PolicySummary, onChanged = vi.fn(), onPick = vi.fn()) {
  render(<ShortListSection summary={summary} onChanged={onChanged} onPickFromDecisions={onPick} />);
  return { onChanged, onPick };
}

describe('ShortListSection', () => {
  afterEach(() => {
    patchPolicy.mockReset();
    createPolicy.mockReset();
    installPack.mockReset();
    fetchPolicyRules.mockReset();
    try { window.localStorage.clear(); } catch { /* jsdom without storage */ }
  });

  it('renders one row per line with the tier WORD and the counter', () => {
    renderSection(summaryOf(LINES));
    expect(screen.getByText('The Short List')).toBeTruthy();
    expect(screen.getByText('4 of 10 lines')).toBeTruthy();
    expect(screen.getByText('The only rules that can interrupt an unattended run.')).toBeTruthy();
    expect(screen.getByText('BLOCK')).toBeTruthy();
    expect(screen.getAllByText('HOLD').length).toBe(2);
    expect(screen.getByText('WATCH')).toBeTruthy();
    expect(screen.getByText('Mass destruction')).toBeTruthy();
    expect(screen.getByText('1 hit / 30d')).toBeTruthy();
    expect(screen.getAllByText('0 hits / 30d').length).toBe(3);
    expect(screen.getByText('Refuses outright. Never waits on you.')).toBeTruthy();
    expect(
      screen.getAllByText('Ungrantable — no grant, approval pause, interruption budget, or automatic tuning can lift this.').length,
    ).toBe(3);
    expect(screen.getByText('+ Add a line from a decision you have seen. 6 slots left.')).toBeTruthy();
  });

  it('arms Off before it PATCHes — the first click writes nothing', async () => {
    patchPolicy.mockResolvedValue(OK);
    const { onChanged } = renderSection(summaryOf(LINES));

    fireEvent.click(screen.getAllByRole('button', { name: 'Off' })[0]!);
    expect(patchPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Turn off?' }));
    await waitFor(() => expect(patchPolicy).toHaveBeenCalledWith('gp_1', { active: false }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('promotes a WATCH line with Hold instead', async () => {
    fetchPolicyRules.mockResolvedValue({ action: 'warn', action_types: ['bash_command'] });
    patchPolicy.mockResolvedValue(OK);
    renderSection(summaryOf(LINES));

    fireEvent.click(screen.getByRole('button', { name: 'Hold instead' }));
    const confirm = await screen.findByRole('button', { name: 'Make it a hold?' });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(patchPolicy).toHaveBeenCalledWith('gp_4', {
        policy_type: 'require_approval',
        rules: { action: 'require_approval', action_types: ['bash_command'], short_list: true },
      }),
    );
  });

  it('opens the cap dialog when a write returns 409 SHORT_LIST_FULL', async () => {
    fetchPolicyRules.mockResolvedValue({ action: 'warn', action_types: ['bash_command'] });
    patchPolicy.mockResolvedValue(FULL);
    renderSection(summaryOf(LINES));

    fireEvent.click(screen.getByRole('button', { name: 'Hold instead' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make it a hold?' }));

    expect(await screen.findByText('The Short List is full (10 of 10). Remove one line to add this one.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove and add' })).toBeTruthy();
  });

  it('renders the Install card for an empty Short List and installs the pack', async () => {
    installPack.mockResolvedValue(OK);
    const { onChanged } = renderSection(summaryOf([]));

    expect(screen.getByText('Install the Short List')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(installPack).toHaveBeenCalledWith('catastrophe-only'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('adds the suggested real-money line', async () => {
    createPolicy.mockResolvedValue(OK);
    renderSection(summaryOf(LINES, [SUGGESTION]));

    expect(screen.getByText('Suggested — Real money')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to the Short List' }));
    await waitFor(() =>
      expect(createPolicy).toHaveBeenCalledWith({
        name: 'Hold real-money actions',
        policy_type: 'require_approval',
        rules: JSON.stringify(SUGGESTION.rule.rules),
      }),
    );
  });

  it('calls onPickFromDecisions from the footer button', () => {
    const { onPick } = renderSection(summaryOf(LINES));
    fireEvent.click(screen.getByRole('button', { name: 'Pick from recent decisions' }));
    expect(onPick).toHaveBeenCalled();
  });

  it('lists a dormant line with the install note and turns it on', async () => {
    patchPolicy.mockResolvedValue(OK);
    const dormant = line({
      id: 'gp_d',
      name: 'Role constraint',
      tier: 'HOLD',
      policy_type: 'role_constraint',
      active: false,
      scope: 'agents acting outside their declared role',
    });
    const { onChanged } = renderSection(summaryOf([...LINES, dormant]));

    // Five lines, but only the four ACTIVE ones spend a slot.
    expect(screen.getByText('4 of 10 lines')).toBeTruthy();
    expect(screen.getByText('+ Add a line from a decision you have seen. 6 slots left.')).toBeTruthy();
    expect(
      screen.getByText('Installed dormant — this rule can only interrupt. Turn it on to add it to the Short List.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    await waitFor(() => expect(patchPolicy).toHaveBeenCalledWith('gp_d', { active: true }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('opens the cap dialog when turning a dormant line on hits the cap', async () => {
    patchPolicy.mockResolvedValue(FULL);
    renderSection(summaryOf([...LINES, line({ id: 'gp_d', policy_type: 'role_constraint', active: false })]));

    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(await screen.findByText('The Short List is full (10 of 10). Remove one line to add this one.')).toBeTruthy();
  });

  it('renders no suggestion card when suggestions is empty', () => {
    renderSection(summaryOf(LINES, []));
    expect(screen.queryByRole('button', { name: 'Add to the Short List' })).toBeNull();
    expect(screen.queryByText(/^Suggested/)).toBeNull();
  });

  it('undoes a shape exception by PATCHing the rules without that key', async () => {
    fetchPolicyRules.mockResolvedValue({ action: 'require_approval', shape_exceptions: ['git log', 'ls'] });
    patchPolicy.mockResolvedValue(OK);
    renderSection(summaryOf([line({ id: 'gp_9', tier: 'HOLD', shape_exceptions: ['git log', 'ls'] })]));

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const undo = await screen.findByRole('button', { name: 'Undo exception for git log' });
    fireEvent.click(undo);

    await waitFor(() =>
      expect(patchPolicy).toHaveBeenCalledWith('gp_9', {
        rules: { action: 'require_approval', shape_exceptions: ['ls'] },
      }),
    );
  });
});

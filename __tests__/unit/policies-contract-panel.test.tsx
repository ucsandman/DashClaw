import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const LONG_PATH = 'C:\\Users\\sandm\\.claude\\plugins\\cache\\claude-plugins-official\\superpowers\\skills\\debugging\\dashclaw_pretool.py';

const CONTRACT = {
  governed: true,
  mode_id: 'claude-code',
  interrupts: [
    { policy_id: 'gp_i1', text: 'paid spend reaches $5.00', fired_7d: 2, editable: null, rules: null },
  ],
  blocks: [],
  silent: [],
  custom: [],
  grants: [
    { policy_id: 'gp_g1', label: `file_write → ${LONG_PATH}`, shape_key: `file_write::${LONG_PATH}`, created_at: null },
    { policy_id: 'gp_g2', label: 'file_write → C:\\Users\\sandm\\proj\\b.py', shape_key: 'file_write::C:\\Users\\sandm\\proj\\b.py', created_at: null },
    { policy_id: 'gp_g3', label: 'api → stripe.com', shape_key: 'api::stripe.com', created_at: null },
  ],
  friction: { interrupts_7d: 2, est_seconds: 40 },
};

vi.mock('@/policies/lib/contractClient', () => ({
  fetchContract: vi.fn(async () => CONTRACT),
  patchPolicyParam: vi.fn(),
}));

import ContractPanel from '@/policies/components/ContractPanel';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(cleanup);

function renderPanel() {
  return render(
    <ContractPanel onChangeMode={() => {}} onContractChanged={() => {}} />,
  );
}

describe('ContractPanel suppressed patterns (interruption contract redesign)', () => {
  it('collapses the suppress-rules to a one-line rollup by default — no raw path wall', async () => {
    const { container, getByText } = renderPanel();
    await waitFor(() => expect(getByText(/suppressed pattern/i)).toBeTruthy());
    // The interrupt sentences stay visible.
    expect(getByText(/paid spend reaches/)).toBeTruthy();
    // Rollup counts all grants.
    expect(container.textContent).toContain('3 suppressed patterns');
    // The raw full-path labels must NOT render while collapsed.
    expect(container.textContent).not.toContain('dashclaw_pretool.py');
    expect(container.textContent).not.toContain('stripe.com');
  });

  it('expands to action-type groups inside a bounded scroll region and persists the open state', async () => {
    const { container, getByText, getByRole } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("suppressed patterns"));

    fireEvent.click(getByRole('button', { name: /show suppressed patterns/i }));

    // Grouped by action type, counts shown.
    expect(getByText('file_write')).toBeTruthy();
    expect(getByText('api')).toBeTruthy();
    // Long paths render basename-first; full path lives on the title attribute.
    expect(container.textContent).toContain('dashclaw_pretool.py');
    const titles = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
    expect(titles).toContain(LONG_PATH);
    // Bounded height + internal scroll.
    const region = container.querySelector('[aria-label="Suppressed patterns"]');
    expect(region).toBeTruthy();
    expect(region!.className).toContain('overflow-y-auto');
    expect(region!.className).toMatch(/max-h-/);
    // Open state persisted (matches the dismissed-signals localStorage pattern).
    expect(localStorage.getItem('dashclaw_contract_grants_open')).toBe('true');
  });

  it('per-rule remove loops through the existing DELETE /api/policies endpoint', async () => {
    const { container, getByRole, getAllByRole } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("suppressed patterns"));
    fireEvent.click(getByRole('button', { name: /show suppressed patterns/i }));

    const removeButtons = getAllByRole('button', { name: /^remove suppress rule/i });
    expect(removeButtons.length).toBe(3);
    fireEvent.click(removeButtons[removeButtons.length - 1]!);

    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.filter((c: any[]) => c[1]?.method === 'DELETE');
      expect(calls.length).toBe(1);
      expect(String(calls[0][0])).toContain('/api/policies?id');
    });
  });

  it('offers a clear-group action using the existing bulk ids endpoint', async () => {
    const { container, getByRole, getAllByRole } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("suppressed patterns"));
    fireEvent.click(getByRole('button', { name: /show suppressed patterns/i }));

    const clearButtons = getAllByRole('button', { name: /clear group/i });
    expect(clearButtons.length).toBe(2); // file_write + api
    fireEvent.click(clearButtons[0]!);

    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.filter((c: any[]) => c[1]?.method === 'DELETE');
      expect(calls.length).toBe(1);
      const url = String(calls[0][0]);
      expect(url).toContain('/api/policies?ids=');
      expect(url).toContain('gp_g1');
      expect(url).toContain('gp_g2');
    });
  });

  it('starts expanded when the persisted preference says open', async () => {
    localStorage.setItem('dashclaw_contract_grants_open', 'true');
    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("suppressed patterns"));
    expect(container.querySelector('[aria-label="Suppressed patterns"]')).toBeTruthy();
  });
});

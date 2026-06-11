// __tests__/unit/contract-panel.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ContractPanel from '@/policies/components/ContractPanel';

const contract = {
  governed: true,
  mode_id: 'claude-code',
  interrupts: [
    { policy_id: 'gp_x', text: 'paid spend reaches $5.00', fired_7d: 1, editable: { param: 'approval_threshold', value: 5 }, rules: { approval_threshold: 5, max_spend_usd: 25 } },
    { policy_id: 'gp_d', text: 'action is one of: deploy, migrate, workflow_execute', fired_7d: 0 },
  ],
  silent: [{ policy_id: 'gp_w', text: 'message, post, email, calendar, sync, api calls (recorded for review)', fired_7d: 23 }],
  blocks: [{ policy_id: 'gp_x', text: 'paid spend exceeds $25.00', fired_7d: 0, editable: { param: 'max_spend_usd', value: 25 }, rules: { approval_threshold: 5, max_spend_usd: 25 } }],
  grants: [{ policy_id: 'gp_g', label: 'api → api.stripe.com', shape_key: 'api::api.stripe.com' }],
  custom: [],
  friction: { interrupts_7d: 2, est_seconds: 40 },
};

describe('ContractPanel', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders interrupt sentences with fire counts and the friction line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => contract })));
    const { container } = render(<ContractPanel onChangeMode={() => {}} onContractChanged={() => {}} />);
    await waitFor(() => {
      expect(container.textContent).toContain('paid spend reaches $5.00');
      expect(container.textContent).toContain('Interrupt me only when');
      expect(container.textContent).toMatch(/2 interrupts/);
    });
  });

  it('renders grants as removable lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => contract })));
    const { container } = render(<ContractPanel onChangeMode={() => {}} onContractChanged={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain('api → api.stripe.com'));
  });
});

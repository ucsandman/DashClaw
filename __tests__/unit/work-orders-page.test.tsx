import React from 'react';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { digestJson } from '@/lib/integrity/canonicalize';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/work-orders',
}));
vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1><div>{actions}</div>{children}</div>
  ),
}));

const RECEIPT_BODY = { work_order_id: 'wo_1' };
const REAL_HASH = digestJson(RECEIPT_BODY);
const WRONG_HASH = 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const ORDERS = {
  work_orders: [
    { id: 'wo_1', type: 'research_brief', status: 'completed', max_cost_usd: '0.25', claimed_by: 'worker-1', created_at: '2026-06-10T14:00:00Z', completed_at: '2026-06-10T14:02:31Z' },
    { id: 'wo_2', type: 'research_brief', status: 'queued', max_cost_usd: '0.40', claimed_by: null, created_at: '2026-06-11T10:10:00Z', completed_at: null },
  ],
  total: 2,
};
const TYPES = { types: [{ type: 'research_brief', version: '1.0', status: 'active', display_name: 'Research Brief', default_max_cost_usd: '0.5', default_timeout_seconds: 600, input_schema: {}, output_schema: {} }], total: 1 };

function makeFetch(receiptHash = REAL_HASH) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.includes('/api/work-orders/types') ? TYPES
      : url.includes('/api/work-orders/wo_1') ? { work_order: ORDERS.work_orders[0], receipt: { receipt: RECEIPT_BODY, receipt_hash: receiptHash } }
      : ORDERS;
    return { ok: true, json: async () => payload } as Response;
  });
}

import WorkOrdersPage from '@/work-orders/page';

beforeEach(() => {
  vi.stubGlobal('fetch', makeFetch());
  // Node 20 exposes crypto.subtle globally; jsdom may not — polyfill if absent.
  if (!globalThis.crypto?.subtle) {
    vi.stubGlobal('crypto', webcrypto);
  }
});

describe('WorkOrdersPage', () => {
  it('renders the ledger with orders and status chips', async () => {
    render(<WorkOrdersPage />);
    await waitFor(() => expect(screen.getByText('wo_1')).toBeTruthy());
    expect(screen.getAllByText('queued').length).toBeGreaterThan(0);
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0);
  });

  it('switches to the Contracts tab and lists registered types', async () => {
    render(<WorkOrdersPage />);
    await waitFor(() => expect(screen.getByText('wo_1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /contracts/i }));
    await waitFor(() => expect(screen.getByText('Research Brief')).toBeTruthy());
  });

  it('click row wo_1 → detail opens → Verify receipt hash → "hash verifies"', async () => {
    vi.stubGlobal('fetch', makeFetch(REAL_HASH));
    render(<WorkOrdersPage />);
    await waitFor(() => expect(screen.getByText('wo_1')).toBeTruthy());
    fireEvent.click(screen.getByText('wo_1'));
    await waitFor(() => expect(screen.getByText('Verify receipt hash')).toBeTruthy());
    fireEvent.click(screen.getByText('Verify receipt hash'));
    await waitFor(() => expect(screen.getByText('hash verifies')).toBeTruthy());
  });

  it('tamper test: wrong receipt hash → "HASH MISMATCH"', async () => {
    vi.stubGlobal('fetch', makeFetch(WRONG_HASH));
    render(<WorkOrdersPage />);
    await waitFor(() => expect(screen.getByText('wo_1')).toBeTruthy());
    fireEvent.click(screen.getByText('wo_1'));
    await waitFor(() => expect(screen.getByText('Verify receipt hash')).toBeTruthy());
    fireEvent.click(screen.getByText('Verify receipt hash'));
    await waitFor(() => expect(screen.getByText('HASH MISMATCH')).toBeTruthy());
  });
});

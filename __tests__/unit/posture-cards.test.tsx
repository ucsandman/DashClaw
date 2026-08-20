import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Spec 4.1-4.2: the /policies fold is two stat cards, and an inert rule that is
 * a BLOCK or a Short List line is an alert ABOVE them — never behind a
 * disclosure. A silently neutered catastrophe rule is the exact false
 * confidence this product exists to prevent.
 */

const { PostureCards } = await import('@/policies/components/PostureHero');

const BASE = {
  governed: true,
  modes: [],
  primaryMode: null,
  enforcement: { total: 4, warn: 1, require_approval: 2, block: 1 },
  rules: [],
  shields: [],
  decisions30d: { total: 12, allow: 8, warn: 2, require_approval: 1, block: 1 },
  scope: { allAgents: true },
  agents: { total: 2 },
  pendingApprovals: 3,
  inert: [],
  shortList: [],
  shortListCap: 10,
  suggestions: [],
  budgetReport: {
    policiesOverBudget: 0,
    shapesOverBudget: 0,
    window_hours: 24,
    budget: 50,
    shape_budget: 50,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summary(extra: Record<string, unknown> = {}): any {
  return { ...BASE, ...extra };
}

const INERT_GATE = {
  id: 'gp_gate',
  name: 'Secret-file writes',
  policy_type: 'require_approval',
  action_types: ['file_write'],
  suppressed_by: [{ id: 'gp_grant', name: '[Grant] file_write', target_prefix: '.env' }],
};

const SHORT_LIST_LINE = {
  id: 'gp_gate',
  name: 'Secret-file writes',
  tier: 'HOLD',
  policy_type: 'require_approval',
  scope: 'writes to .env',
  fired30d: 1,
  ungrantable: true,
  shape_exceptions: [],
  active: true,
  seeded: true,
};

function renderCards(props: Record<string, unknown> = {}) {
  return render(
    <PostureCards
      summary={summary(props.summary as Record<string, unknown> | undefined)}
      friction={(props.friction as { interrupts_7d: number; est_seconds: number } | null) ?? { interrupts_7d: 1, est_seconds: 20 }}
      inboxCount={0}
      onReviewSuppressed={() => {}}
    />
  );
}

describe('PostureCards (spec 4.1-4.2)', () => {
  beforeEach(() => {
    // ApprovalPausePanel self-fetches; a failed read renders nothing, which
    // keeps this test about the cards.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
  });

  it('renders exactly two stat cards and none of the cut ones', () => {
    renderCards();

    expect(screen.getAllByTestId('stat-card')).toHaveLength(2);
    expect(screen.getByText('Interruptions, last 7 days')).toBeTruthy();
    expect(screen.getByText('Pending approvals')).toBeTruthy();

    expect(screen.queryByText(/Enforcement/i)).toBeNull();
    expect(screen.queryByText(/Decisions/i)).toBeNull();
    expect(screen.queryByText(/Governed agents/i)).toBeNull();
  });

  it('states the interruption count and the attention it cost', () => {
    renderCards({ friction: { interrupts_7d: 41, est_seconds: 1200 } });

    expect(screen.getByText('41')).toBeTruthy();
    expect(screen.getByText('about 20 min of your time')).toBeTruthy();
  });

  it('links the pending-approvals card to the inbox', () => {
    renderCards();
    const link = screen.getByRole('link', { name: /Open Approvals inbox/i });
    expect(link.getAttribute('href')).toBe('/approvals');
  });

  it('says nothing about the budget when nothing is over it', () => {
    renderCards();
    expect(screen.queryByText(/crossed 50 interruptions/i)).toBeNull();
  });

  it('reports over-budget rules with the exact spec copy', () => {
    renderCards({
      summary: {
        budgetReport: {
          policiesOverBudget: 1,
          shapesOverBudget: 1,
          window_hours: 24,
          budget: 50,
          shape_budget: 50,
        },
      },
    });

    expect(
      screen.getByText(
        '2 rules crossed 50 interruptions in 24 hours and are warning instead of asking. They are in the list below.'
      )
    ).toBeTruthy();
  });

  it('raises an inert Short List line as an alert above the cards', () => {
    renderCards({ summary: { inert: [INERT_GATE], shortList: [SHORT_LIST_LINE] } });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Secret-file writes');
    const firstCard = screen.getAllByTestId('stat-card')[0] as HTMLElement;
    // eslint-disable-next-line no-bitwise
    expect(alert.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('raises an inert BLOCK line as an alert', () => {
    renderCards({
      summary: {
        inert: [{ ...INERT_GATE, id: 'gp_block', policy_type: 'block' }],
        shortList: [{ ...SHORT_LIST_LINE, id: 'gp_block', tier: 'BLOCK' }],
      },
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('leaves a warn-class inert rule for the ledger, not the fold', () => {
    renderCards({ summary: { inert: [{ ...INERT_GATE, policy_type: 'warn' }], shortList: [] } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByTestId('stat-card')).toHaveLength(2);
  });
});

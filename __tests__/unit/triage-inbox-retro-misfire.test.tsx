import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * /policies "Needs your call" — spec §4.4 (short-list redesign).
 *
 * Four structural properties, none of which the old inbox had:
 *  1. The queue order removes friction first. A page that opens with "here is
 *     more enforcement you could add" is a page people close.
 *  2. An empty inbox renders nothing at all. An empty to-do list still reads
 *     as homework on day 0.
 *  3. A warn group can be ruled on retrospectively — Yes/No writes a labeled
 *     adjudication. This is the ONLY way a quiet posture ever earns the ten
 *     labels the calibration controller needs to get quieter.
 *  4. A misfire (one command shape held 3x in 24h by a Short List line) is
 *     capped by a shape-scoped exception on that one line — the mechanism that
 *     was structurally absent on 2026-08-16 (1,759 interruptions on git log).
 */

const fetchReview = vi.fn();
const postVerdict = vi.fn();
const fetchLoosening = vi.fn();
const fetchProposals = vi.fn();
const fetchTightening = vi.fn();
const fetchCalibration = vi.fn();

vi.mock('@/policies/lib/contractClient', () => ({
  fetchReview: (...a: unknown[]) => fetchReview(...a),
  postVerdict: (...a: unknown[]) => postVerdict(...a),
}));
vi.mock('@/policies/lib/proposalsClient', () => ({
  fetchProposals: (...a: unknown[]) => fetchProposals(...a),
  dismissProposal: vi.fn(),
  undismissProposal: vi.fn(),
  acceptProposal: vi.fn(),
}));
vi.mock('@/policies/lib/tighteningClient', () => ({
  fetchTighteningProposals: (...a: unknown[]) => fetchTightening(...a),
  ratifyTighteningProposal: vi.fn(),
  dismissTighteningProposal: vi.fn(),
  undoTighteningDecision: vi.fn(),
}));
vi.mock('@/policies/lib/looseningClient', () => ({
  fetchLooseningProposals: (...a: unknown[]) => fetchLoosening(...a),
  ratifyLooseningProposal: vi.fn(),
  dismissLooseningProposal: vi.fn(),
  undoLooseningDecision: vi.fn(),
  isPrecedent: () => false,
  isBudget: () => false,
}));
vi.mock('@/policies/lib/calibrationClient', () => ({
  fetchCalibrationProposals: (...a: unknown[]) => fetchCalibration(...a),
  ratifyProposal: vi.fn(),
  dismissCalibrationProposal: vi.fn(),
  undoCalibrationDecision: vi.fn(),
  CALIBRATION_RULE_LABEL: { over_scored: 'scored too high' },
}));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));

const { default: TriageInbox } = await import('@/policies/components/TriageInbox.jsx');

function warnGroup(actionType = 'test', targetPrefix: string | null = 'npm test') {
  return {
    shape: {
      action_type: actionType,
      target_prefix: targetPrefix,
      key: `${actionType}::${targetPrefix ?? ''}`,
      label: targetPrefix ? `${actionType} → ${targetPrefix}` : actionType,
    },
    count: 34,
    latest_at: new Date().toISOString(),
    sample_id: 'gd_1',
    sample_goal: 'Bash: npm test',
  };
}

function misfire(overrides: Record<string, unknown> = {}) {
  return {
    policy_id: 'gp_secret',
    policy_name: 'Secret-file writes',
    shape_key: 'git log',
    count: 3,
    window_hours: 24,
    approvals: 0,
    denials: 0,
    latest_at: new Date().toISOString(),
    sample_goal: 'Bash: git log --oneline -5',
    ...overrides,
  };
}

const emptyish = {
  groups: [],
  interrupts: [],
  cursor: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  postVerdict.mockResolvedValue({ ok: true, adjudicated: true, labeled_total: 12, labeled_live: 4 });
  fetchLoosening.mockResolvedValue({ proposals: [], misfires: [] });
  fetchProposals.mockResolvedValue({
    policies: [{ id: 'gp_x' }],
    proposals: [
      {
        id: 'tp_1',
        severity: 'actionable',
        policy_id: 'gp_x',
        policy_name: 'Deploy gate',
        title: 'Deploy gate interrupts more than it helps',
        summary: 'Deploy gate interrupts more than it helps',
        evidence: {
          fired: { require_approval: 9 },
          approvals: { approved: 9, denied: 0 },
          override_rate: 0.1,
        },
        patch: { rules: { action_types: ['deploy'] } },
      },
    ],
  });
  fetchTightening.mockResolvedValue({
    proposals: [
      {
        id: 'tt_1',
        status: 'pending',
        title: 'Tighten writes under app/secrets/',
        action_type: 'write_file',
        risk_level: 'high',
        evidence: { observed_count: 5, risk_max: 88 },
      },
    ],
  });
  fetchCalibration.mockResolvedValue({
    proposals: [
      {
        candidate_id: 'cc_1',
        status: 'pending',
        rule: 'over_scored',
        suggested_name: 'Risk scorer overrates git log',
        count: 6,
        risk_min: 90,
        risk_max: 100,
      },
    ],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TriageInbox — queue order', () => {
  it('puts misfires first and enforcement last', async () => {
    fetchReview.mockResolvedValue({ ...emptyish, groups: [warnGroup()] });
    fetchLoosening.mockResolvedValue({
      proposals: [
        {
          id: 'lp_1',
          rule: 'relax_policy_scope',
          status: 'pending',
          policy_id: 'gp_y',
          policy_name: 'API calls',
          title: 'Relax API calls',
          evidence: { approvals: { approved: 8, denied: 0 }, override_rate: 0 },
        },
      ],
      misfires: [misfire()],
    });

    const { container } = render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/was held by/);

    const order = Array.from(container.querySelectorAll('button[aria-expanded]'))
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter((l) => l.startsWith('Collapse'))
      .map((l) => l.replace(/^Collapse /, '').replace(/ \(\d+\)$/, ''));

    expect(order).toEqual(['Misfires', 'Loosen', 'Calibration', 'Warn groups', 'Tuning', 'Tighten']);
  });

  it('counts misfires in the pending total it reports up', async () => {
    fetchReview.mockResolvedValue(emptyish);
    fetchLoosening.mockResolvedValue({ proposals: [], misfires: [misfire(), misfire({ shape_key: 'git status' })] });
    const onCount = vi.fn();

    render(<TriageInbox onChanged={() => {}} onCount={onCount} />);
    await screen.findAllByText(/was held by/);

    // 2 misfires + 1 tuning + 1 tighten + 1 calibration.
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(5));
  });
});

describe('TriageInbox — silence when empty', () => {
  it('renders nothing at all rather than an empty-state card', async () => {
    fetchReview.mockResolvedValue(emptyish);
    fetchLoosening.mockResolvedValue({ proposals: [], misfires: [] });
    fetchProposals.mockResolvedValue({ policies: [], proposals: [] });
    fetchTightening.mockResolvedValue({ proposals: [] });
    fetchCalibration.mockResolvedValue({ proposals: [] });

    const onCount = vi.fn();
    const { container } = render(<TriageInbox onChanged={() => {}} onCount={onCount} />);
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(0));

    expect(screen.queryByText('Nothing waiting')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Needs your call' })).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('TriageInbox — retrospective warn verdicts', () => {
  beforeEach(() => {
    fetchReview.mockResolvedValue({ ...emptyish, groups: [warnGroup()] });
  });

  it('asks the retrospective question on a warn row', async () => {
    render(<TriageInbox onChanged={() => {}} />);
    expect(await screen.findByText(/Would you have wanted these stopped\?/)).toBeTruthy();
  });

  it('posts retro_stop with the shape when the operator answers Yes, in one click', async () => {
    render(<TriageInbox onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Yes/ }));

    await waitFor(() =>
      expect(postVerdict).toHaveBeenCalledWith('retro_stop', {
        action_type: 'test',
        target_prefix: 'npm test',
      }),
    );
  });

  it('posts retro_fine when the operator answers No', async () => {
    render(<TriageInbox onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^No/ }));

    await waitFor(() =>
      expect(postVerdict).toHaveBeenCalledWith('retro_fine', {
        action_type: 'test',
        target_prefix: 'npm test',
      }),
    );
  });

  it('reports the running verdict count and refuses undo — adjudications are append-only', async () => {
    render(<TriageInbox onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Yes/ }));

    await screen.findByText(/Recorded — 12 verdicts so far/);
    const undo = screen.getByRole('button', { name: /Undo/i }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
  });

  it('surfaces a full Short List as the row error instead of a silent no-op', async () => {
    postVerdict.mockRejectedValue(
      new Error('The Short List is full (10 of 10). Remove one line to add this one.'),
    );

    render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/Would you have wanted these stopped\?/);
    fireEvent.click(screen.getByRole('button', { name: /More verdicts/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Promote to Hold/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm: promote to Hold/ }));

    expect(
      await screen.findByText('The Short List is full (10 of 10). Remove one line to add this one.'),
    ).toBeTruthy();
  });

  it('keeps the enforcement verbs as secondary actions with their new names', async () => {
    render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/Would you have wanted these stopped\?/);

    expect(screen.getByRole('button', { name: /^Stop warning/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /More verdicts/i }));
    expect(screen.getByRole('menuitem', { name: /Promote to Hold/ })).toBeTruthy();
  });
});

describe('TriageInbox — misfire queue', () => {
  beforeEach(() => {
    fetchReview.mockResolvedValue(emptyish);
    fetchLoosening.mockResolvedValue({ proposals: [], misfires: [misfire()] });
  });

  it('states which line held which shape, how often, and in what window', async () => {
    const { container } = render(<TriageInbox onChanged={() => {}} />);
    await screen.findByText(/was held by/);

    const lead = Array.from(container.querySelectorAll('div'))
      .map((d) => (d.textContent ?? '').replace(/[“”]/g, '"'))
      .filter((t) => t.startsWith('"git log" was held by'))
      .pop();
    expect(lead).toBe('"git log" was held by Secret-file writes 3 times in 24h.');
    // No adjudication outcome on these rows by design: volume alone is the line.
    expect(screen.getByText(/holds/).textContent).toContain('3 holds');
  });

  it('writes a shape-scoped exception on that one line after arm + confirm', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ ok: true }) };
      return {
        ok: true,
        json: async () => ({
          policies: [
            {
              id: 'gp_secret',
              name: 'Secret-file writes',
              // A seeded catastrophe line: it qualifies for the Short List by
              // its effective action, with no short_list flag of its own. The
              // exception write must not change what this line IS.
              rules: JSON.stringify({ threshold: 90, action: 'block', ungrantable: true }),
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TriageInbox onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Stop asking about "git log"/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm: stop asking/ }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      const body = JSON.parse(String((patch![1] as RequestInit).body));
      expect(body.id).toBe('gp_secret');
      expect(body.rules.shape_exceptions).toContain('git log');
      // The line keeps enforcing everything else — every stored key travels
      // back untouched, and nothing is invented (no short_list bolted on to
      // survive the route's admission check).
      expect(body.rules).toEqual({
        threshold: 90,
        action: 'block',
        ungrantable: true,
        shape_exceptions: ['git log'],
      });
    });
  });

  it('mutes the row for 24h on "Keep asking" without touching the policy', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    render(<TriageInbox onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Keep asking/ }));

    await screen.findByText(/Muted for 24h/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains the blast radius before the click', async () => {
    render(<TriageInbox onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Why\?/ }));
    expect(
      screen.getByText(/A shape-scoped exception on this one line\./),
    ).toBeTruthy();
  });
});

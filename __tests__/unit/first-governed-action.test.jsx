import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/components/PublicNavbar', () => ({ default: () => null }));
vi.mock('@/components/PublicFooter', () => ({ default: () => null }));
vi.mock('@/connect/HostedProvisionSection', () => ({ default: () => null }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => 'dashclaw-trial-session=tok' }),
}));
vi.mock('@/lib/sessionViewer.mjs', () => ({
  getViewerContextFromCookieHeader: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));
vi.mock('@/lib/repositories/hosted-workspace.repository', () => ({
  getHostedWorkspace: vi.fn(),
}));

import FirstGovernedActionCard, {
  FIRST_ACTION_AGENT_ID,
  FIRST_ACTION_TYPES,
} from '@/connect/FirstGovernedActionCard';
import { isSyntheticEvent } from '@/lib/calibration-mining.js';
import { getViewerContextFromCookieHeader } from '@/lib/sessionViewer.mjs';
import { getHostedWorkspace } from '@/lib/repositories/hosted-workspace.repository';
import ConnectPage from '@/connect/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.DASHCLAW_HOSTED;
});

/*
 * v5.2 funnel-visibility pin: the hosted funnel's firstAction step excludes
 * synthetic traffic via the shared predicate. If the guided card's defaults
 * ever drift into a synthetic pattern (e.g. someone renames the agent id to
 * "test-drive"), every browser activation silently vanishes from the funnel.
 */
describe('first governed action defaults are funnel-visible', () => {
  it('the browser agent id is not synthetic', () => {
    expect(isSyntheticEvent({ agent_id: FIRST_ACTION_AGENT_ID })).toBe(false);
  });

  it('every offered action type is not synthetic (alone and with the agent id)', () => {
    for (const actionType of FIRST_ACTION_TYPES) {
      expect(isSyntheticEvent({ action_type: actionType })).toBe(false);
      expect(
        isSyntheticEvent({ agent_id: FIRST_ACTION_AGENT_ID, action_type: actionType })
      ).toBe(false);
    }
  });
});

describe('FirstGovernedActionCard', () => {
  function mockGuard(response, { ok = true, status = 200 } = {}) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => response,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('sends exactly one POST /api/guard?record=true with the shown payload', async () => {
    const fetchMock = mockGuard({ decision: 'allow', recorded: true, action_id: 'act_1' });
    const { getByText } = render(<FirstGovernedActionCard />);

    fireEvent.click(getByText('Send governed action'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/guard?record=true');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.agent_id).toBe(FIRST_ACTION_AGENT_ID);
    expect(body.action_type).toBe(FIRST_ACTION_TYPES[0]);
    expect(typeof body.declared_goal).toBe('string');
  });

  it('allow + recorded renders the decision and the ledger deep link', async () => {
    mockGuard({
      decision: 'allow',
      risk_score: 12,
      recorded: true,
      action_id: 'act_ledger_42',
      matched_policies: [],
    });
    const { getByText, container } = render(<FirstGovernedActionCard />);

    fireEvent.click(getByText('Send governed action'));
    await waitFor(() => expect(getByText('Allowed')).toBeTruthy());

    const link = container.querySelector('a[href="/decisions/act_ledger_42"]');
    expect(link).toBeTruthy();
    expect(link.textContent).toContain('View it in your ledger');
  });

  it('block renders the truthful no-ledger copy and no ledger link', async () => {
    mockGuard({ decision: 'block', reasons: ['policy: no_deploys'], recorded: false });
    const { getByText, container } = render(<FirstGovernedActionCard />);

    fireEvent.click(getByText('Send governed action'));
    await waitFor(() => expect(getByText('Blocked')).toBeTruthy());

    expect(container.textContent).toContain('never reach the action ledger');
    expect(container.textContent).toContain('policy: no_deploys');
    expect(container.querySelector('a[href^="/decisions/"]')).toBeNull();
  });

  it('require_approval renders the waiting-on-operator state', async () => {
    mockGuard({
      decision: 'require_approval',
      reason: 'High risk requires approval',
      recorded: true,
      action_id: 'act_pending_7',
    });
    const { getByText, container } = render(<FirstGovernedActionCard />);

    fireEvent.click(getByText('Send governed action'));
    await waitFor(() => expect(getByText('Needs approval')).toBeTruthy());

    expect(container.textContent).toContain('waiting on an operator');
    expect(container.querySelector('a[href="/decisions/act_pending_7"]')).toBeTruthy();
  });

  it('a 403 renders the honest trial-envelope message', async () => {
    mockGuard({ error: 'Trial has expired' }, { ok: false, status: 403 });
    const { getByText, container } = render(<FirstGovernedActionCard />);

    fireEvent.click(getByText('Send governed action'));
    await waitFor(() => expect(container.textContent).toContain('Trial has expired'));

    expect(container.textContent).toContain('trial write envelope');
  });
});

describe('/connect renders the card only in the trial branch', () => {
  beforeEach(() => {
    vi.mocked(getViewerContextFromCookieHeader).mockReset();
    vi.mocked(getHostedWorkspace).mockReset();
  });

  it('trial session on a hosted instance: #first-action renders under the workspace card', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    vi.mocked(getViewerContextFromCookieHeader).mockResolvedValue({
      authType: 'trial',
      session: { orgId: 'org_trial_1' },
    });
    vi.mocked(getHostedWorkspace).mockResolvedValue({
      orgId: 'org_trial_1',
      hostedMode: true,
      trialEndsAt: '2026-08-01T00:00:00.000Z',
      trialActionCap: 500,
      trialActionsUsed: 3,
    });

    const ui = await ConnectPage({ searchParams: Promise.resolve({}) });
    const { container } = render(ui);

    expect(container.querySelector('#first-action')).toBeTruthy();
    expect(container.textContent).toContain('Send governed action');
  });

  it('hosted off: no #first-action for anyone', async () => {
    const ui = await ConnectPage({ searchParams: Promise.resolve({}) });
    const { container } = render(ui);

    expect(container.querySelector('#first-action')).toBeNull();
    expect(vi.mocked(getViewerContextFromCookieHeader)).not.toHaveBeenCalled();
  });

  it('hosted on but no trial session: no #first-action', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    vi.mocked(getViewerContextFromCookieHeader).mockResolvedValue({ authType: 'none', session: null });

    const ui = await ConnectPage({ searchParams: Promise.resolve({}) });
    const { container } = render(ui);

    expect(container.querySelector('#first-action')).toBeNull();
  });
});

describe('v5.1 empty states point at the guided action', () => {
  function readRepoFile(relativePath) {
    return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  }

  it('the /decisions empty state links to /connect#first-action', () => {
    expect(readRepoFile('app/decisions/page.tsx')).toContain('href="/connect#first-action"');
  });

  it('the post-mint success state links to /connect#first-action', () => {
    expect(readRepoFile('app/connect/HostedProvisionClient.jsx')).toContain('/connect#first-action');
  });
});

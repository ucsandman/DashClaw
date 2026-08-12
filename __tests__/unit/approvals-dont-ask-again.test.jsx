import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// "Allow, don't ask again" on the approval card: the button only exists below
// the risk ceiling, the panel names the blast radius before the click, and the
// confirm mints a grant then releases over the normal per-item approval route.

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>
  ),
}));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title }) => <div>{title}</div>,
}));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));

const SCRATCH = 'C:/Users/sandm/AppData/Local/Temp/claude/audit/scratchpad/build.mjs';

const action = (over = {}) => ({
  action_id: 'act_1',
  action_type: 'apply',
  agent_id: 'claude-code',
  status: 'pending_approval',
  risk_score: 65,
  declared_goal: 'edit the build script',
  context: JSON.stringify({ target: SCRATCH }),
  created_at: new Date().toISOString(),
  ...over,
});

/**
 * Records every call so a test can assert BOTH that the grant was minted and
 * that the release went out over the ordinary approval route — the whole point
 * of the design is that there is no second approval path.
 */
function makeFetch({ actions = [action()], policies = [], grantOk = true, releaseIds } = {}) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    if (u.includes('/grant')) {
      return grantOk
        ? { ok: true, json: async () => ({ ok: true, policy: { id: 'gp_1' }, release_ids: releaseIds ?? ['act_1'] }) }
        : { ok: false, json: async () => ({ error: 'Ceiling' }) };
    }
    if (u.startsWith('/api/approvals/')) return { ok: true, json: async () => ({ success: true }) };
    if (u.startsWith('/api/actions')) {
      return { ok: true, json: async () => ({ actions: u.includes('expired') ? [] : actions }) };
    }
    if (u.startsWith('/api/policies')) return { ok: true, json: async () => ({ policies }) };
    if (u === '/api/session/effective') {
      return { ok: true, json: async () => ({ authenticated: true, authType: 'local', role: 'admin', isAdmin: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  fn.calls = calls;
  return fn;
}

async function renderPage() {
  const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
  render(<ApprovalsPage />);
  await waitFor(() => expect(screen.getByText(/edit the build script|Reads information|All clear/i)).toBeTruthy());
}

/** The card's own Allow button shares a name with the panel's confirm, so
 *  every confirm assertion is scoped to the panel group. */
const panel = () => within(screen.getByRole('group', { name: /stop asking about this action/i }));

describe('approval card — the risk ceiling', () => {
  beforeEach(() => { global.fetch = undefined; });
  afterEach(() => vi.restoreAllMocks());

  it('offers the button below the ceiling', async () => {
    global.fetch = makeFetch({ actions: [action({ risk_score: 65 })] });
    await renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /don't ask again/i })).toBeTruthy());
  });

  // A grant minted above the ceiling could not cover the action anyway, so the
  // button must not exist rather than fail on click.
  it('replaces the button at the ceiling with an explanation', async () => {
    global.fetch = makeFetch({ actions: [action({ risk_score: 70 })] });
    await renderPage();
    await waitFor(() => expect(screen.getByText(/needs a human every time/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /don't ask again/i })).toBeNull();
  });

  it('replaces the button well above the ceiling', async () => {
    global.fetch = makeFetch({ actions: [action({ risk_score: 95 })] });
    await renderPage();
    await waitFor(() => expect(screen.getByText(/needs a human every time/i)).toBeTruthy());
  });
});

describe('approval card — the scope panel', () => {
  beforeEach(() => { global.fetch = undefined; });
  afterEach(() => vi.restoreAllMocks());

  it('opens the panel and shows the exact target', async () => {
    global.fetch = makeFetch();
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /don't ask again/i }));
    expect(screen.getByText(/stop asking about/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(SCRATCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    expect(screen.getByText(/covers this exact target only/i)).toBeTruthy();
  });

  it('names the blast radius on the confirm button when siblings match', async () => {
    global.fetch = makeFetch({
      actions: [action(), action({ action_id: 'act_2' })],
    });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /don't ask again/i }))[0]);
    expect(panel().getByRole('button', { name: /allow all 2/i })).toBeTruthy();
    expect(screen.getByText(/also releases 1 waiting action/i)).toBeTruthy();
  });

  // A sibling above the ceiling is not covered, so it must not be counted.
  it('excludes an above-ceiling sibling from the count', async () => {
    global.fetch = makeFetch({
      actions: [action(), action({ action_id: 'act_hot', risk_score: 95 })],
    });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /don't ask again/i }))[0]);
    expect(panel().getByRole('button', { name: /^allow$/i })).toBeTruthy();
  });

  it('excludes a sibling pointing somewhere else', async () => {
    global.fetch = makeFetch({
      actions: [action(), action({ action_id: 'act_far', context: JSON.stringify({ target: 'C:/Projects/DashClaw/app/page.tsx' }) })],
    });
    await renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /don't ask again/i }))[0]);
    expect(panel().getByRole('button', { name: /^allow$/i })).toBeTruthy();
  });

  it('closes on cancel without calling the grant route', async () => {
    global.fetch = makeFetch();
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /don't ask again/i }));
    fireEvent.click(panel().getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/stop asking about/i)).toBeNull());
    expect(global.fetch.calls.some((c) => c.url.includes('/grant'))).toBe(false);
  });
});

describe('approval card — confirming', () => {
  beforeEach(() => { global.fetch = undefined; });
  afterEach(() => vi.restoreAllMocks());

  it('mints the grant with the chosen lease and releases over the approval route', async () => {
    global.fetch = makeFetch({ releaseIds: ['act_1', 'act_2'] });
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /don't ask again/i }));
    fireEvent.change(panel().getByRole('combobox'), { target: { value: '1' } });
    fireEvent.click(panel().getByRole('button', { name: /^allow$/i }));

    await waitFor(() => {
      const grant = global.fetch.calls.find((c) => c.url.includes('/grant'));
      expect(grant).toBeTruthy();
      expect(grant.body.ttl_hours).toBe(1);
    });

    // Both returned ids released through the ORDINARY per-item route — there is
    // deliberately no second approval path inside the grant route.
    await waitFor(() => {
      const releases = global.fetch.calls.filter(
        (c) => c.method === 'POST' && !c.url.includes('/grant') && c.url.startsWith('/api/approvals/'),
      );
      expect(releases.map((r) => r.url)).toEqual(
        expect.arrayContaining(['/api/approvals/act_1', '/api/approvals/act_2']),
      );
      expect(releases.every((r) => r.body.decision === 'allow')).toBe(true);
    });
  });

  it('defaults the lease to 24h', async () => {
    global.fetch = makeFetch();
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /don't ask again/i }));
    fireEvent.click(panel().getByRole('button', { name: /^allow$/i }));
    await waitFor(() => {
      const grant = global.fetch.calls.find((c) => c.url.includes('/grant'));
      expect(grant.body.ttl_hours).toBe(24);
    });
  });

  // A refused grant must not silently approve the action anyway.
  it('does not release anything when the grant is refused', async () => {
    global.fetch = makeFetch({ grantOk: false });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /don't ask again/i }));
    fireEvent.click(panel().getByRole('button', { name: /^allow$/i }));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(global.fetch.calls.some(
      (c) => c.method === 'POST' && !c.url.includes('/grant') && c.url.startsWith('/api/approvals/'),
    )).toBe(false);
  });
});

describe('active grants strip', () => {
  beforeEach(() => { global.fetch = undefined; });
  afterEach(() => vi.restoreAllMocks());

  const grant = (over = {}) => ({
    id: 'gp_1',
    name: '[Grant] apply → build.mjs',
    policy_type: 'allow_grant',
    active: 1,
    created_at: new Date().toISOString(),
    rules: JSON.stringify({
      action_type: 'apply',
      target_prefix: SCRATCH,
      expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(),
      max_risk: 70,
    }),
    ...over,
  });

  it('renders nothing when there are no grants', async () => {
    global.fetch = makeFetch({ policies: [] });
    await renderPage();
    expect(screen.queryByText(/told me to stop asking about/i)).toBeNull();
  });

  it('lists a live grant with its remaining time', async () => {
    global.fetch = makeFetch({ policies: [grant()] });
    await renderPage();
    await waitFor(() => expect(screen.getByText(/1 thing you told me to stop asking about/i)).toBeTruthy());
    expect(screen.getByText(/22h left|23h left/)).toBeTruthy();
  });

  it('ignores non-grant policies', async () => {
    global.fetch = makeFetch({ policies: [grant({ policy_type: 'require_approval' })] });
    await renderPage();
    expect(screen.queryByText(/told me to stop asking about/i)).toBeNull();
  });

  it('ignores an inactive grant', async () => {
    global.fetch = makeFetch({ policies: [grant({ active: 0 })] });
    await renderPage();
    expect(screen.queryByText(/told me to stop asking about/i)).toBeNull();
  });

  it('hides an expired grant', async () => {
    global.fetch = makeFetch({ policies: [grant({
      rules: JSON.stringify({ action_type: 'apply', target_prefix: SCRATCH, expires_at: new Date(Date.now() - 1000).toISOString() }),
    })] });
    await renderPage();
    await waitFor(() => expect(screen.queryByText(/told me to stop asking about/i)).toBeNull());
  });

  it('revokes by deactivating the policy', async () => {
    global.fetch = makeFetch({ policies: [grant()] });
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /revoke/i }));
    await waitFor(() => {
      const patch = global.fetch.calls.find((c) => c.method === 'PATCH' && c.url === '/api/policies');
      expect(patch).toBeTruthy();
      expect(patch.body).toEqual({ id: 'gp_1', active: false });
    });
  });
});

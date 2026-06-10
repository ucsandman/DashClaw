import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Hosted Policy Coach with opt-in uploaded samples renders the FULL coach with
// an honest provenance badge — not the counts-only InsightsPanel.

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>
  ),
}));
vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: null }),
}));
vi.mock('../../app/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true, settled: true }),
}));

const SUGGESTION = {
  id: 'sug_1',
  type: 'destructive_command_approval',
  agent_id: 'clawdbot',
  severity: 'high',
  confidence: 80,
  enforceable: true,
  advisory: false,
  target: 'clawdbot',
  expected_effect: 'Route destructive commands to approval.',
  matching_sample_size: 5,
  sample_size: 12,
  evidence_examples: [],
  rule: { action: 'require_approval', risk_threshold: 70 },
};

function coachFetch({ source, remote = true }) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/api/behavior/suggestions')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          suggestions: [SUGGESTION], agents: [], sample_count: 12, sample_source: source,
        }),
      };
    }
    if (u.startsWith('/api/behavior/samples')) {
      return { ok: true, status: 200, json: async () => ({ remote, sample_count: 12, ready: true, samples: [] }) };
    }
    if (u.startsWith('/api/behavior/recorder')) {
      return { ok: true, status: 200, json: async () => ({ enabled: false, until: null, effective: false, upload_enabled: source === 'uploaded' }) };
    }
    if (u.startsWith('/api/behavior/insights')) {
      return { ok: true, status: 200, json: async () => ({ snapshot: null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

describe('Policy Coach — evidence provenance', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('uploaded samples render the full coach with the fleet-upload badge', async () => {
    global.fetch = coachFetch({ source: 'uploaded', remote: true });
    const { default: Page } = await import('../../app/policy-coach/page.jsx');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('evidence-provenance').textContent).toMatch(/anonymized fleet upload/i);
    });
    // Full coach (suggestions + simulate-before-adopt), not the counts panel.
    expect(screen.getByText(/policy suggestions/i)).toBeTruthy();
  });

  it('local samples show the local badge', async () => {
    global.fetch = coachFetch({ source: 'local', remote: false });
    const { default: Page } = await import('../../app/policy-coach/page.jsx');
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('evidence-provenance').textContent).toMatch(/local samples/i);
    });
  });

  it('the opt-in upload toggle renders with default-off state', async () => {
    global.fetch = coachFetch({ source: 'local', remote: false });
    const { default: Page } = await import('../../app/policy-coach/page.jsx');
    render(<Page />);

    const optin = await screen.findByTestId('upload-optin');
    expect(optin.textContent).toMatch(/anonymized upload is off/i);
    expect(optin.textContent).toMatch(/default off/i);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { POLICY_MODE_CATALOG } from '@/lib/policy-modes';
import ModesTab from '@/policies/components/ModesTab';

const MODES = Object.values(POLICY_MODE_CATALOG).map((m) => ({ ...m, policy_count: 9 }));

const CC_PREVIEW = {
  mode: POLICY_MODE_CATALOG['claude-code']!,
  policies: [
    {
      name: '[Claude Code Mode] Block extreme-risk actions',
      policy_type: 'risk_threshold',
      decision: 'block',
      rules: { threshold: 100, action: 'block', _mode: 'claude-code' },
    },
    {
      name: '[Claude Code Mode] Pause before deploy / migrate / workflow',
      policy_type: 'require_approval',
      decision: 'require_approval',
      rules: { action_types: ['deploy', 'migrate', 'workflow_execute'], _mode: 'claude-code' },
    },
  ],
  summary: { total: 2, warn: 0, require_approval: 1, block: 1 },
  friction: { available: false as const, reason: 'No recent action history to simulate against yet.' },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/session/effective') {
      return jsonResponse({ role: 'admin', authenticated: true, authType: 'local' });
    }
    if (url === '/api/policies/modes' && !init) {
      return jsonResponse({ modes: MODES });
    }
    if (url === '/api/policies/modes/preview') {
      return jsonResponse(CC_PREVIEW);
    }
    return jsonResponse({});
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModesTab', () => {
  it('renders a card for every built-in mode', async () => {
    render(<ModesTab />);
    expect(await screen.findByText('Claude Code Mode')).toBeTruthy();
    // all 8 modes have a card
    for (const m of MODES) {
      expect(screen.getByText(m.name)).toBeTruthy();
    }
    expect(MODES.length).toBe(8);
  });

  it('shows the legend, generated policy list, and Apply when a mode is selected', async () => {
    render(<ModesTab />);
    const ccButton = await screen.findByRole('button', { name: /Claude Code Mode/ });
    fireEvent.click(ccButton);

    // Legend (warn = record/surface · require approval = pause · block = deny)
    expect(await screen.findByText('require approval')).toBeTruthy();

    // Generated policy list from the preview response
    expect(
      await screen.findByText('[Claude Code Mode] Pause before deploy / migrate / workflow'),
    ).toBeTruthy();

    // Honest friction empty-state (no fabricated numbers)
    expect(screen.getByText(/Historical action simulation is not available yet/)).toBeTruthy();

    // Apply is present and enabled for an admin
    const apply = screen.getByText('Apply this mode');
    expect(apply).toBeTruthy();
    expect((apply as HTMLButtonElement).disabled).toBe(false);
  });
});

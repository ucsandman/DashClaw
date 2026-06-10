import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { default: ModelStrategyTestPanel } = await import('@/workflows/strategies/components/ModelStrategyTestPanel.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

describe('ModelStrategyTestPanel — live failover test', () => {
  it('runs a completion and renders provider/model/cost/output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: 'pong', provider: 'anthropic', model: 'claude-haiku-4-5',
        cost_usd: '0.00012', fallback_used: false, attempts: 1,
        strategy_id: 'ms_1', strategy_name: 'Default',
      }),
    })));

    render(<ModelStrategyTestPanel strategyId="ms_1" />);
    fireEvent.click(screen.getByRole('button', { name: /run failover test/i }));

    expect(await screen.findByText('pong')).toBeTruthy();
    expect(screen.getByText('anthropic')).toBeTruthy();
    expect(screen.getByText('claude-haiku-4-5')).toBeTruthy();
    expect(screen.getByText(/0\.00012/)).toBeTruthy();
  });

  it('renders the provider_errors chain on a 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'All providers failed',
        provider_errors: [
          { provider: 'anthropic', model: 'claude-opus-4-8', error: 'rate_limited' },
          { provider: 'openai', model: 'gpt-4o', error: 'invalid_api_key' },
        ],
      }),
    })));

    render(<ModelStrategyTestPanel strategyId="ms_1" />);
    fireEvent.click(screen.getByRole('button', { name: /run failover test/i }));

    expect(await screen.findByText(/rate_limited/)).toBeTruthy();
    expect(screen.getByText(/invalid_api_key/)).toBeTruthy();
    expect(screen.getByText('All providers failed')).toBeTruthy();
  });

  it('surfaces a generic error (e.g. missing BYOK credentials)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'No API key configured for anthropic' }),
    })));

    render(<ModelStrategyTestPanel strategyId="ms_1" />);
    fireEvent.click(screen.getByRole('button', { name: /run failover test/i }));

    expect(await screen.findByText('No API key configured for anthropic')).toBeTruthy();
  });
});

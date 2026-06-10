import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ strategyId: 'mst_1' }),
  useRouter: () => ({ push }),
}));

vi.mock('@/components/PageLayout.js', () => ({
  default: ({ title, subtitle, children, actions }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
}));

describe('ModelStrategyDetailPage', () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads persisted config into the builder and saves compiled config', async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      if (String(url) === '/api/model-strategies/mst_1' && !options.method) {
        return {
          ok: true,
          json: async () => ({
            strategy: {
              strategy_id: 'mst_1',
              name: 'Balanced Default',
              description: 'Stable production default',
              config: {
                primary: { provider: 'openai', model: 'gpt-4.1' },
                fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4' }],
                costSensitivity: 'balanced',
                latencySensitivity: 'medium',
                maxBudgetUsd: 0.5,
                maxRetries: 2,
              },
            },
          }),
        };
      }

      if (String(url) === '/api/model-strategies/mst_1' && options.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({
            strategy: {
              strategy_id: 'mst_1',
              name: 'Balanced Default',
              description: 'Stable production default',
              config: JSON.parse(options.body).config,
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { default: ModelStrategyDetailPage } = await import('@/workflows/strategies/[strategyId]/page.jsx');

    render(<ModelStrategyDetailPage />);

    expect(await screen.findByDisplayValue('Balanced Default')).toBeTruthy();
    expect(screen.getByLabelText(/primary provider/i).value).toBe('openai');
    expect(screen.getByLabelText(/primary model/i).value).toBe('gpt-4.1');
    expect(screen.getByText(/strategy summary/i)).toBeTruthy();
    expect(screen.queryByText(/config \(json\)/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/primary provider/i), { target: { value: 'anthropic' } });
    expect(screen.getByLabelText(/primary model/i).value).toBe('claude-sonnet-4-6');
    fireEvent.change(screen.getByLabelText(/primary model/i), { target: { value: 'claude-opus-4-6' } });
    fireEvent.change(screen.getByLabelText(/budget cap/i), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText(/max retries/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/model-strategies/mst_1',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        })
      );
    });

    const patchCall = global.fetch.mock.calls.find((call) => call[1]?.method === 'PATCH');
    const requestBody = JSON.parse(patchCall[1].body);

    expect(requestBody).toEqual({
      name: 'Balanced Default',
      description: 'Stable production default',
      config: {
        primary: {
          provider: 'anthropic',
          model: 'claude-opus-4-6',
        },
        fallback: [
          {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
        ],
        costSensitivity: 'balanced',
        latencySensitivity: 'medium',
        maxBudgetUsd: 1.25,
        maxRetries: 3,
      },
    });
  });

  it('surfaces advanced-mode warning for unsupported stored config shapes', async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      if (String(url) === '/api/model-strategies/mst_1' && !options.method) {
        return {
          ok: true,
          json: async () => ({
            strategy: {
              strategy_id: 'mst_1',
              name: 'Research Routing',
              description: 'Includes custom task routing',
              config: {
                primary: { provider: 'openai', model: 'gpt-4.1' },
                taskModes: {
                  research: {
                    provider: 'anthropic',
                    model: 'claude-sonnet-4-6',
                    fallback: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
                  },
                },
              },
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { default: ModelStrategyDetailPage } = await import('@/workflows/strategies/[strategyId]/page.jsx');

    render(<ModelStrategyDetailPage />);

    expect(await screen.findByText(/advanced config details require manual review/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /show advanced/i })).toBeTruthy();
  });
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
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

describe('NewModelStrategyPage', () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders guided builder controls instead of raw JSON by default', async () => {
    global.fetch = vi.fn();

    const { default: NewModelStrategyPage } = await import('@/workflows/strategies/new/page.jsx');

    render(<NewModelStrategyPage />);

    expect(screen.getByRole('heading', { name: /new model strategy/i })).toBeTruthy();
    expect(screen.getByLabelText(/primary provider/i)).toBeTruthy();
    expect(screen.getByLabelText(/primary model/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /add fallback/i })).toBeTruthy();
    expect(screen.getByLabelText(/budget cap/i)).toBeTruthy();
    expect(screen.getByLabelText(/latency sensitivity/i)).toBeTruthy();
    expect(screen.getByLabelText(/cost sensitivity/i)).toBeTruthy();
    expect(screen.getByText(/strategy summary/i)).toBeTruthy();
    expect(screen.queryByText(/config \(json\)/i)).toBeNull();
  });

  it('submits a compiled config object from the guided builder', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        strategy: {
          strategy_id: 'mst_1',
        },
      }),
    }));

    const { default: NewModelStrategyPage } = await import('@/workflows/strategies/new/page.jsx');

    render(<NewModelStrategyPage />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Research Default' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Use the best model for research' } });
    fireEvent.change(screen.getByLabelText(/primary provider/i), { target: { value: 'anthropic' } });
    expect(screen.getByLabelText(/primary model/i).value).toBe('claude-sonnet-4-6');
    fireEvent.change(screen.getByLabelText(/primary model/i), { target: { value: 'claude-opus-4-6' } });
    fireEvent.change(screen.getByLabelText(/fallback provider 1/i), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText(/fallback model 1/i), { target: { value: 'gpt-4.1' } });
    fireEvent.change(screen.getByLabelText(/max retries/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/budget cap/i), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText(/latency sensitivity/i), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText(/cost sensitivity/i), { target: { value: 'high-quality' } });
    fireEvent.change(screen.getByLabelText(/allowed providers/i), { target: { value: 'anthropic, openai' } });
    fireEvent.change(screen.getByLabelText(/blocked providers/i), { target: { value: 'perplexity' } });

    fireEvent.click(screen.getByRole('button', { name: /create strategy/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/model-strategies',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        })
      );
    });

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);

    expect(requestBody).toEqual({
      name: 'Research Default',
      description: 'Use the best model for research',
      config: {
        primary: {
          provider: 'anthropic',
          model: 'claude-opus-4-6',
        },
        fallback: [
          {
            provider: 'openai',
            model: 'gpt-4.1',
          },
        ],
        costSensitivity: 'high-quality',
        latencySensitivity: 'high',
        maxBudgetUsd: 1.5,
        maxRetries: 3,
        allowedProviders: ['anthropic', 'openai'],
        disallowedProviders: ['perplexity'],
      },
    });

    expect(push).toHaveBeenCalledWith('/workflows/strategies/mst_1');
  });

  it('keeps advanced options collapsed by default and compiles task-mode overrides when enabled', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        strategy: {
          strategy_id: 'mst_advanced',
        },
      }),
    }));

    const { default: NewModelStrategyPage } = await import('@/workflows/strategies/new/page.jsx');

    render(<NewModelStrategyPage />);

    expect(screen.queryByLabelText(/task mode 1/i)).toBeNull();
    expect(screen.queryByLabelText(/raw config json/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /show advanced/i }));
    fireEvent.click(screen.getByRole('button', { name: /add task mode/i }));

    fireEvent.change(screen.getByLabelText(/task mode 1/i), { target: { value: 'research' } });
    fireEvent.change(screen.getByLabelText(/task mode provider 1/i), { target: { value: 'anthropic' } });
    expect(screen.getByLabelText(/task mode model 1/i).value).toBe('claude-sonnet-4-6');
    fireEvent.change(screen.getByLabelText(/task mode model 1/i), { target: { value: 'claude-opus-4-6' } });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Advanced Research Strategy' } });
    fireEvent.click(screen.getByRole('button', { name: /create strategy/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.config.taskModes).toEqual({
      research: {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
      },
    });
  });
});

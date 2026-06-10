import { describe, expect, it } from 'vitest';
import {
  buildModelStrategySummary,
  compileModelStrategyConfig,
  createDefaultModelStrategyFormState,
  decompileModelStrategyConfig,
  requiresAdvancedStrategyConfig,
} from '../../app/workflows/strategies/lib/modelStrategyFormModel.js';
import { getDefaultProviderModel } from '../../app/lib/providers/providerRegistry';

describe('modelStrategyFormModel', () => {
  it('creates valid default form state from the provider registry', () => {
    const state = createDefaultModelStrategyFormState();

    expect(state.execution.primaryProvider).toBe('openai');
    expect(state.execution.primaryModel).toBe(getDefaultProviderModel('openai', 'model_strategies'));
    expect(state.execution.primaryModel).toBeTruthy();
    expect(state.execution.fallbacks).toEqual([
      { provider: 'anthropic', model: getDefaultProviderModel('anthropic', 'model_strategies') },
    ]);
    expect(state.execution.fallbacks[0].model).toBeTruthy();
    expect(state.constraints.costSensitivity).toBe('balanced');
    expect(state.constraints.latencySensitivity).toBe('medium');
  });

  it('compiles builder state into persisted config shape', () => {
    const config = compileModelStrategyConfig({
      execution: {
        primaryProvider: 'openai',
        primaryModel: 'gpt-5.4',
        fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
        maxRetries: 3,
      },
      constraints: {
        costSensitivity: 'low',
        latencySensitivity: 'high',
        maxBudgetUsd: 1.25,
        allowedProviders: ['openai', 'anthropic'],
        disallowedProviders: ['perplexity'],
      },
      advanced: {
        taskModes: [],
      },
    });

    expect(config).toEqual({
      primary: { provider: 'openai', model: 'gpt-5.4' },
      fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
      costSensitivity: 'low',
      latencySensitivity: 'high',
      maxBudgetUsd: 1.25,
      maxRetries: 3,
      allowedProviders: ['openai', 'anthropic'],
      disallowedProviders: ['perplexity'],
    });
  });

  it('decompiles persisted config into builder state', () => {
    const state = decompileModelStrategyConfig({
      primary: { provider: 'openai', model: 'gpt-4.1' },
      fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4' }],
      costSensitivity: 'balanced',
      latencySensitivity: 'medium',
      maxBudgetUsd: 0.5,
      maxRetries: 2,
      allowedProviders: ['openai'],
      disallowedProviders: ['perplexity'],
      taskModes: {
        research: { provider: 'anthropic', model: 'claude-opus-4-6' },
      },
    });

    expect(state.execution.primaryProvider).toBe('openai');
    expect(state.execution.primaryModel).toBe('gpt-4.1');
    expect(state.execution.fallbacks).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
    expect(state.constraints.allowedProviders).toEqual(['openai']);
    expect(state.constraints.disallowedProviders).toEqual(['perplexity']);
    expect(state.advanced.taskModes).toEqual([
      {
        taskMode: 'research',
        provider: 'anthropic',
        model: 'claude-opus-4-6',
      },
    ]);
  });

  it('builds a readable summary string', () => {
    const summary = buildModelStrategySummary({
      execution: {
        primaryProvider: 'openai',
        primaryModel: 'gpt-4.1',
        fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
        maxRetries: 2,
      },
      constraints: {
        costSensitivity: 'balanced',
        latencySensitivity: 'medium',
        maxBudgetUsd: 0.5,
        allowedProviders: [],
        disallowedProviders: [],
      },
      advanced: { taskModes: [] },
    });

    expect(summary).toContain('OpenAI GPT-4.1');
    expect(summary).toContain('Claude Sonnet 4.6');
    expect(summary).toContain('$0.50');
    expect(summary).toContain('retry twice');
  });

  it('detects when config requires advanced/raw fallback', () => {
    expect(
      requiresAdvancedStrategyConfig({
        primary: { provider: 'openai', model: 'gpt-4.1' },
        taskModes: {
          research: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            fallback: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
          },
        },
      })
    ).toBe(true);

    expect(
      requiresAdvancedStrategyConfig({
        primary: { provider: 'openai', model: 'gpt-4.1' },
        fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
        taskModes: {
          support: { provider: 'openai', model: 'gpt-4.1-mini' },
        },
      })
    ).toBe(false);
  });
});

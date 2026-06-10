import {
  getDefaultProviderModel,
  getModelLabel,
  getProviderLabel,
  isSupportedProvider,
  isSupportedProviderModel,
} from '../../lib/providers/providerRegistry';

const DEFAULT_STATE = {
  execution: {
    primaryProvider: 'openai',
    primaryModel: getDefaultProviderModel('openai', 'model_strategies') || 'gpt-4.1',
    fallbacks: [{
      provider: 'anthropic',
      model: getDefaultProviderModel('anthropic', 'model_strategies') || 'claude-sonnet-4-6',
    }],
    maxRetries: 2,
  },
  constraints: {
    costSensitivity: 'balanced',
    latencySensitivity: 'medium',
    maxBudgetUsd: 0.5,
    allowedProviders: [],
    disallowedProviders: [],
  },
  advanced: {
    taskModes: [],
    rawConfigText: '',
  },
};

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProviderList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => cleanString(value))
    .filter(Boolean);
}

function normalizeFallbacks(fallbacks) {
  if (!Array.isArray(fallbacks)) return [];

  return fallbacks
    .map((fallback) => ({
      provider: cleanString(fallback?.provider),
      model: cleanString(fallback?.model),
    }))
    .filter((fallback) => fallback.provider && fallback.model);
}

function normalizeTaskModes(taskModes) {
  if (!Array.isArray(taskModes)) return [];

  return taskModes
    .map((taskMode) => ({
      taskMode: cleanString(taskMode?.taskMode),
      provider: cleanString(taskMode?.provider),
      model: cleanString(taskMode?.model),
    }))
    .filter((taskMode) => taskMode.taskMode && taskMode.provider && taskMode.model);
}

function titleCase(value) {
  return cleanString(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeProvider(provider) {
  const normalized = cleanString(provider).toLowerCase();
  return getProviderLabel(normalized) || titleCase(provider);
}

function humanizeModel(model) {
  const normalized = cleanString(model);
  if (!normalized) return '';
  return titleCase(normalized);
}

function humanizeProviderModel(provider, model) {
  const normalizedProvider = cleanString(provider).toLowerCase();
  const normalizedModel = cleanString(model);
  return getModelLabel(normalizedProvider, normalizedModel) || humanizeModel(normalizedModel);
}

function normalizeProvider(provider, fallbackProvider = '') {
  const normalized = cleanString(provider).toLowerCase();
  if (isSupportedProvider(normalized)) {
    return normalized;
  }
  return cleanString(fallbackProvider).toLowerCase();
}

function normalizeModel(provider, model, useCase = 'model_strategies', fallbackModel = '') {
  const normalizedProvider = cleanString(provider).toLowerCase();
  const normalizedModel = cleanString(model);

  if (normalizedProvider && normalizedModel && isSupportedProviderModel(normalizedProvider, normalizedModel)) {
    return normalizedModel;
  }

  return getDefaultProviderModel(normalizedProvider, useCase)
    || getDefaultProviderModel(normalizedProvider)
    || cleanString(fallbackModel);
}

export function createDefaultModelStrategyFormState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export function compileModelStrategyConfig(formState) {
  const execution = formState?.execution || {};
  const constraints = formState?.constraints || {};
  const advanced = formState?.advanced || {};

  const config = {
    primary: {
      provider: cleanString(execution.primaryProvider),
      model: cleanString(execution.primaryModel),
    },
  };

  const fallbacks = normalizeFallbacks(execution.fallbacks);
  if (fallbacks.length > 0) {
    config.fallback = fallbacks;
  }

  if (cleanString(constraints.costSensitivity)) {
    config.costSensitivity = cleanString(constraints.costSensitivity);
  }
  if (cleanString(constraints.latencySensitivity)) {
    config.latencySensitivity = cleanString(constraints.latencySensitivity);
  }
  if (typeof constraints.maxBudgetUsd === 'number' && Number.isFinite(constraints.maxBudgetUsd)) {
    config.maxBudgetUsd = constraints.maxBudgetUsd;
  }
  if (Number.isInteger(execution.maxRetries)) {
    config.maxRetries = execution.maxRetries;
  }

  const allowedProviders = normalizeProviderList(constraints.allowedProviders);
  if (allowedProviders.length > 0) {
    config.allowedProviders = allowedProviders;
  }

  const disallowedProviders = normalizeProviderList(constraints.disallowedProviders);
  if (disallowedProviders.length > 0) {
    config.disallowedProviders = disallowedProviders;
  }

  const taskModes = normalizeTaskModes(advanced.taskModes);
  if (taskModes.length > 0) {
    config.taskModes = Object.fromEntries(
      taskModes.map((taskMode) => [
        taskMode.taskMode,
        {
          provider: taskMode.provider,
          model: taskMode.model,
        },
      ])
    );
  }

  return config;
}

export function requiresAdvancedStrategyConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }

  const supportedTopLevelKeys = new Set([
    'primary',
    'fallback',
    'costSensitivity',
    'latencySensitivity',
    'maxBudgetUsd',
    'maxRetries',
    'allowedProviders',
    'disallowedProviders',
    'taskModes',
  ]);

  for (const key of Object.keys(config)) {
    if (!supportedTopLevelKeys.has(key)) {
      return true;
    }
  }

  const taskModes = config.taskModes;
  if (taskModes && typeof taskModes === 'object' && !Array.isArray(taskModes)) {
    for (const override of Object.values(taskModes)) {
      if (!override || typeof override !== 'object' || Array.isArray(override)) {
        return true;
      }

      const overrideKeys = Object.keys(override);
      for (const key of overrideKeys) {
        if (!['provider', 'model'].includes(key)) {
          return true;
        }
      }

      if (!cleanString(override.provider) || !cleanString(override.model)) {
        return true;
      }
    }
  }

  return false;
}

export function decompileModelStrategyConfig(config) {
  const state = createDefaultModelStrategyFormState();
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};

  state.execution.primaryProvider = normalizeProvider(source.primary?.provider, state.execution.primaryProvider) || state.execution.primaryProvider;
  state.execution.primaryModel = normalizeModel(
    state.execution.primaryProvider,
    source.primary?.model,
    'model_strategies',
    state.execution.primaryModel
  ) || state.execution.primaryModel;
  state.execution.fallbacks = normalizeFallbacks(source.fallback).map((fallback) => {
    const provider = normalizeProvider(fallback.provider, state.execution.primaryProvider);
    return {
      provider,
      model: normalizeModel(provider, fallback.model, 'model_strategies', fallback.model),
    };
  });
  state.execution.maxRetries = Number.isInteger(source.maxRetries) ? source.maxRetries : state.execution.maxRetries;

  state.constraints.costSensitivity = cleanString(source.costSensitivity) || state.constraints.costSensitivity;
  state.constraints.latencySensitivity = cleanString(source.latencySensitivity) || state.constraints.latencySensitivity;
  state.constraints.maxBudgetUsd = typeof source.maxBudgetUsd === 'number' ? source.maxBudgetUsd : state.constraints.maxBudgetUsd;
  state.constraints.allowedProviders = normalizeProviderList(source.allowedProviders);
  state.constraints.disallowedProviders = normalizeProviderList(source.disallowedProviders);

  if (source.taskModes && typeof source.taskModes === 'object' && !Array.isArray(source.taskModes)) {
    state.advanced.taskModes = Object.entries(source.taskModes)
      .map(([taskMode, override]) => {
        const provider = normalizeProvider(override?.provider, state.execution.primaryProvider);
        return {
          taskMode,
          provider,
          model: normalizeModel(provider, override?.model, 'model_strategies', override?.model),
        };
      })
      .filter((override) => override.taskMode && override.provider && override.model);
  }

  state.advanced.rawConfigText = JSON.stringify(source, null, 2);

  return state;
}

export function buildModelStrategySummary(formState) {
  const execution = formState?.execution || {};
  const constraints = formState?.constraints || {};
  const primaryProvider = cleanString(execution.primaryProvider);
  const primaryModel = cleanString(execution.primaryModel);
  const fallbacks = normalizeFallbacks(execution.fallbacks);
  const retryCount = Number.isInteger(execution.maxRetries) ? execution.maxRetries : 0;
  const budget = typeof constraints.maxBudgetUsd === 'number'
    ? `$${constraints.maxBudgetUsd.toFixed(2)}`
    : null;

  const parts = [];

  if (primaryProvider && primaryModel) {
    parts.push(`Use ${humanizeProvider(primaryProvider)} ${humanizeProviderModel(primaryProvider, primaryModel)} first`);
  }

  if (fallbacks.length > 0) {
    const fallbackDescriptions = fallbacks.map(
      (fallback) => `${humanizeProvider(fallback.provider)} ${humanizeProviderModel(fallback.provider, fallback.model)}`
    );
    parts.push(`fall back to ${fallbackDescriptions.join(', then ')}`);
  }

  if (cleanString(constraints.costSensitivity)) {
    parts.push(`prefer ${cleanString(constraints.costSensitivity)} cost`);
  }

  if (cleanString(constraints.latencySensitivity)) {
    parts.push(`${cleanString(constraints.latencySensitivity)} latency`);
  }

  if (retryCount > 0) {
    const retryLabel = retryCount === 1 ? 'retry once' : retryCount === 2 ? 'retry twice' : `retry ${retryCount} times`;
    parts.push(retryLabel);
  }

  if (budget) {
    parts.push(`cap requests at ${budget}`);
  }

  return parts.join(', ') + (parts.length > 0 ? '.' : '');
}

import {
  getDefaultProviderModel as getRegistryDefaultProviderModel,
  getProviderModelOptions,
  getProviderOptions,
  isSupportedProviderModel as isRegistrySupportedProviderModel,
} from '../../lib/providers/providerRegistry';

export const WORKFLOW_AI_PROVIDER_OPTIONS = getProviderOptions().filter((provider) =>
  ['openai', 'anthropic', 'groq', 'together', 'perplexity'].includes(provider.value)
);

export const PROVIDER_MODEL_OPTIONS = Object.fromEntries(
  WORKFLOW_AI_PROVIDER_OPTIONS.map((provider) => [
    provider.value,
    getProviderModelOptions(provider.value),
  ])
);

export function getDefaultProviderModel(provider) {
  return (
    getRegistryDefaultProviderModel(provider, 'workflow_drafting')
    || getRegistryDefaultProviderModel(provider)
    || ''
  );
}

export function isSupportedProviderModel(provider, model) {
  return isRegistrySupportedProviderModel(provider, model);
}

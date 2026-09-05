export interface ProviderModel {
  id: string;
  label: string;
  status: string;
  capabilities: string[];
}

export interface ProviderEntry {
  id: string;
  label: string;
  apiStyle: string;
  baseUrl: string;
  credentialKey: string;
  supportedUseCases: string[];
  defaults: Record<string, string>;
  models: ProviderModel[];
}

const PROVIDER_REGISTRY: Record<string, ProviderEntry> = Object.freeze({
  openai: {
    id: 'openai',
    label: 'OpenAI',
    apiStyle: 'openai_chat_completions',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    credentialKey: 'OPENAI_API_KEY',
    supportedUseCases: ['workflow_drafting', 'model_strategies', 'policy_generation', 'semantic_guard', 'predictive_risk'],
    defaults: {
      workflow_drafting: 'gpt-5.4',
      model_strategies: 'gpt-4.1',
      semantic_guard: 'gpt-4.1-mini',
      policy_generation: 'gpt-4.1',
      predictive_risk: 'gpt-4.1-mini',
    },
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'gpt-5.4', label: 'GPT-5.4', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', status: 'active', capabilities: ['chat', 'fast', 'cheap'] },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', status: 'active', capabilities: ['chat', 'fast', 'cheap'] },
      { id: 'gpt-4.1', label: 'GPT-4.1', status: 'active', capabilities: ['chat'] },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', status: 'active', capabilities: ['chat', 'fast', 'cheap'] },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    apiStyle: 'anthropic_messages',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    credentialKey: 'ANTHROPIC_API_KEY',
    supportedUseCases: ['workflow_drafting', 'model_strategies', 'policy_generation', 'predictive_risk'],
    defaults: {
      workflow_drafting: 'claude-sonnet-4-6',
      model_strategies: 'claude-sonnet-4-6',
      policy_generation: 'claude-sonnet-4-6',
      predictive_risk: 'claude-haiku-4-5',
    },
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', status: 'active', capabilities: ['chat', 'fast', 'cheap'] },
    ],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    apiStyle: 'openai_compatible_chat',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    credentialKey: 'GROQ_API_KEY',
    supportedUseCases: ['workflow_drafting', 'model_strategies', 'predictive_risk'],
    defaults: {
      workflow_drafting: 'openai/gpt-oss-120b',
      model_strategies: 'llama-3.3-70b-versatile',
      predictive_risk: 'llama-3.1-8b-instant',
    },
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', status: 'active', capabilities: ['chat', 'fast'] },
      { id: 'moonshotai/kimi-k2-instruct-0905', label: 'Kimi K2 0905', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', status: 'active', capabilities: ['chat'] },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', status: 'active', capabilities: ['chat', 'fast', 'cheap'] },
    ],
  },
  together: {
    id: 'together',
    label: 'Together',
    apiStyle: 'openai_compatible_chat',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    credentialKey: 'TOGETHER_API_KEY',
    supportedUseCases: ['workflow_drafting', 'model_strategies', 'predictive_risk'],
    defaults: {
      workflow_drafting: 'moonshotai/Kimi-K2.5',
      model_strategies: 'deepseek-ai/DeepSeek-V3.1',
      predictive_risk: 'Qwen/Qwen3.5-9B',
    },
    models: [
      { id: 'moonshotai/Kimi-K2.5', label: 'Kimi K2.5', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'deepseek-ai/DeepSeek-V3.1', label: 'DeepSeek V3.1', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'MiniMaxAI/MiniMax-M2.5', label: 'MiniMax M2.5', status: 'active', capabilities: ['chat'] },
      { id: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen3.5 397B A17B', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'Qwen/Qwen3.5-9B', label: 'Qwen3.5 9B', status: 'active', capabilities: ['chat', 'fast'] },
    ],
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    apiStyle: 'openai_compatible_chat',
    baseUrl: 'https://api.perplexity.ai/chat/completions',
    credentialKey: 'PERPLEXITY_API_KEY',
    supportedUseCases: ['workflow_drafting', 'model_strategies', 'predictive_risk'],
    defaults: {
      workflow_drafting: 'sonar',
      model_strategies: 'sonar-pro',
      predictive_risk: 'sonar',
    },
    models: [
      { id: 'sonar', label: 'Sonar', status: 'active', capabilities: ['chat', 'fast'] },
      { id: 'sonar-pro', label: 'Sonar Pro', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'sonar-reasoning', label: 'Sonar Reasoning', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro', status: 'active', capabilities: ['chat', 'reasoning'] },
      { id: 'sonar-deep-research', label: 'Sonar Deep Research', status: 'active', capabilities: ['chat', 'reasoning'] },
    ],
  },
});

export function getProviderEntries(): ProviderEntry[] {
  return Object.values(PROVIDER_REGISTRY);
}

export function getProviderOptions(): Array<{ value: string; label: string }> {
  return getProviderEntries().map((provider) => ({
    value: provider.id,
    label: provider.label,
  }));
}

export function getProviderModelEntries(provider: string): ProviderModel[] {
  return PROVIDER_REGISTRY[provider]?.models || [];
}

export function getProviderModelOptions(provider: string): Array<{
  value: string;
  label: string;
  status: string;
  capabilities: string[];
}> {
  return getProviderModelEntries(provider).map((model) => ({
    value: model.id,
    label: model.label,
    status: model.status,
    capabilities: model.capabilities,
  }));
}

export function getDefaultProviderModel(provider: string, useCase: string | null = null): string {
  const providerEntry = PROVIDER_REGISTRY[provider];
  if (!providerEntry) return '';
  if (useCase && providerEntry.defaults?.[useCase]) {
    return providerEntry.defaults[useCase];
  }
  return providerEntry.models[0]?.id || '';
}

export function isSupportedProviderModel(provider: string, model: string): boolean {
  return getProviderModelEntries(provider).some((entry) => entry.id === model);
}

export function getProviderLabel(provider: string): string {
  return PROVIDER_REGISTRY[provider]?.label || provider;
}

export function getModelLabel(provider: string, model: string): string {
  return getProviderModelEntries(provider).find((entry) => entry.id === model)?.label || model;
}

export function getProviderApiStyle(provider: string): string | null {
  return PROVIDER_REGISTRY[provider]?.apiStyle || null;
}

export function getProviderBaseUrl(provider: string): string | null {
  return PROVIDER_REGISTRY[provider]?.baseUrl || null;
}

export function getProviderCredentialKey(provider: string): string | null {
  return PROVIDER_REGISTRY[provider]?.credentialKey || null;
}

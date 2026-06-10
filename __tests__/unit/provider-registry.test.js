import { describe, expect, it } from 'vitest';
import {
  getDefaultProviderModel,
  getModelLabel,
  getProviderApiStyle,
  getProviderBaseUrl,
  getProviderCredentialKey,
  getProviderModelOptions,
  getProviderOptions,
  isSupportedProviderModel,
} from '../../app/lib/providers/providerRegistry.js';

describe('providerRegistry', () => {
  it('returns current provider options', () => {
    const providerIds = getProviderOptions().map((entry) => entry.value);

    expect(providerIds).toContain('openai');
    expect(providerIds).toContain('anthropic');
    expect(providerIds).toContain('groq');
  });

  it('returns model options in declared order', () => {
    expect(getProviderModelOptions('anthropic')[0].value).toBe('claude-fable-5');
    expect(getProviderModelOptions('openai')[0].value).toBe('gpt-5.5');
    expect(getProviderModelOptions('perplexity')[0].value).toBe('sonar');
  });

  it('returns provider defaults for specific use cases', () => {
    expect(getDefaultProviderModel('openai', 'workflow_drafting')).toBe('gpt-5.4');
    expect(getDefaultProviderModel('openai', 'model_strategies')).toBe('gpt-4.1');
    expect(getDefaultProviderModel('openai', 'policy_generation')).toBe('gpt-4.1');
    expect(getDefaultProviderModel('openai', 'predictive_risk')).toBe('gpt-4.1-mini');
    expect(getDefaultProviderModel('anthropic', 'predictive_risk')).toBe('claude-haiku-4-5');
  });

  it('validates provider/model membership', () => {
    expect(isSupportedProviderModel('anthropic', 'claude-opus-4-6')).toBe(true);
    expect(isSupportedProviderModel('anthropic', 'gpt-5.4')).toBe(false);
  });

  it('returns labels and api compatibility metadata', () => {
    expect(getModelLabel('anthropic', 'claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
    expect(getProviderApiStyle('anthropic')).toBe('anthropic_messages');
  });

  it('returns base URLs for each provider', () => {
    expect(getProviderBaseUrl('openai')).toBe('https://api.openai.com/v1/chat/completions');
    expect(getProviderBaseUrl('anthropic')).toBe('https://api.anthropic.com/v1/messages');
    expect(getProviderBaseUrl('groq')).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(getProviderBaseUrl('unknown')).toBeNull();
  });

  it('returns credential key names for each provider', () => {
    expect(getProviderCredentialKey('openai')).toBe('OPENAI_API_KEY');
    expect(getProviderCredentialKey('anthropic')).toBe('ANTHROPIC_API_KEY');
    expect(getProviderCredentialKey('groq')).toBe('GROQ_API_KEY');
    expect(getProviderCredentialKey('together')).toBe('TOGETHER_API_KEY');
    expect(getProviderCredentialKey('perplexity')).toBe('PERPLEXITY_API_KEY');
    expect(getProviderCredentialKey('unknown')).toBeNull();
  });

  it('every provider has credentialKey, baseUrl, and apiStyle', () => {
    const providers = getProviderOptions().map((p) => p.value);
    for (const id of providers) {
      expect(getProviderCredentialKey(id)).toBeTruthy();
      expect(getProviderBaseUrl(id)).toBeTruthy();
      expect(getProviderApiStyle(id)).toBeTruthy();
    }
  });
});

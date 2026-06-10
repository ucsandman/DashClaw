/**
 * Provider execution module for runtime model routing.
 * Resolves BYOK credentials from org settings, calls provider APIs via raw fetch,
 * handles fallback chains, enforces budget caps, and returns normalized responses.
 *
 * Provider metadata (URLs, API styles, credential keys) comes from the canonical
 * provider registry. Add new providers there; this module only owns protocol handlers.
 */

import { getSettings } from './repositories/settings.repository';
import { decrypt } from './encryption';
import { estimateCost } from './billing';
import { getModelPricing } from './repositories/settings.repository';
import {
  getProviderApiStyle,
  getProviderBaseUrl,
  getProviderCredentialKey,
  getProviderLabel,
} from './providers/providerRegistry';
import type { SqlTag } from './types/db';

const PROVIDER_TIMEOUT = 30_000;

export interface ChatMessage {
  role: string;
  content: string;
}

export interface CompletionOptions {
  max_tokens?: number;
  temperature?: number;
  task_mode?: string | null;
}

interface ProviderUsage {
  input_tokens: number;
  output_tokens: number;
}

interface HandlerResult {
  content: string;
  usage: ProviderUsage;
  raw_model: string;
}

interface ChainEntry {
  provider: string;
  model: string;
}

export interface StrategyConfig {
  primary?: ChainEntry;
  fallback?: ChainEntry[];
  taskModes?: Record<string, ChainEntry>;
  disallowedProviders?: string[];
  allowedProviders?: string[];
  maxRetries?: number;
  maxBudgetUsd?: number;
}

interface ProviderError {
  provider: string;
  model: string;
  attempt?: number;
  error: string;
}

export interface CompletionResult {
  content: string;
  provider: string;
  model: string;
  usage: ProviderUsage;
  cost_usd: number;
  fallback_used: boolean;
  attempts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential loading (same pattern as integration-health.js)
// ─────────────────────────────────────────────────────────────────────────────

async function loadOrgCredentials(sql: SqlTag, orgId: string): Promise<Record<string, unknown>> {
  const settings = await getSettings(sql, orgId, { category: 'integration' });
  const creds: Record<string, unknown> = {};
  for (const s of settings as Array<{ value?: unknown; encrypted?: unknown; key: string }>) {
    let val = s.value;
    if (s.encrypted && val) {
      const decrypted = decrypt(val as string, `${orgId}:${s.key}`);
      if (decrypted) val = decrypted;
    }
    creds[s.key] = val;
  }
  return creds;
}

function getProviderKey(creds: Record<string, unknown>, provider: string): string | null {
  const keyName = getProviderCredentialKey(provider);
  if (!keyName) return null;
  return (creds[keyName] as string) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider-specific API callers
// ─────────────────────────────────────────────────────────────────────────────

async function providerFetch(url: string | null, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT);
  try {
    // `url` mirrors the registry's `string | null` baseUrl exactly (the original
    // JS passed it through untyped); fetch's typing wants a string here.
    return await fetch(url as string, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocol handlers — keyed by apiStyle from the provider registry.
// Adding a new provider with an existing apiStyle requires zero changes here.
// ─────────────────────────────────────────────────────────────────────────────

type ProviderHandler = (
  baseUrl: string | null,
  label: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: CompletionOptions
) => Promise<HandlerResult>;

async function openaiStyleCall(
  baseUrl: string | null,
  label: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: CompletionOptions
): Promise<HandlerResult> {
  const res = await providerFetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options.max_tokens ?? 1024,
      temperature: options.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || '',
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
    raw_model: data.model || model,
  };
}

async function anthropicStyleCall(
  baseUrl: string | null,
  label: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: CompletionOptions
): Promise<HandlerResult> {
  const systemParts = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  const systemText = systemParts.map((m) => m.content).join('\n') || undefined;

  const res = await providerFetch(baseUrl, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: nonSystem,
      max_tokens: options.max_tokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      ...(systemText ? { system: systemText } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  const textBlock = data.content?.find((b) => b.type === 'text');
  return {
    content: textBlock?.text || '',
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
    raw_model: data.model || model,
  };
}

const API_STYLE_HANDLERS: Record<string, ProviderHandler> = {
  openai_chat_completions: openaiStyleCall,
  openai_compatible_chat: openaiStyleCall,
  anthropic_messages: anthropicStyleCall,
};

function getProviderHandler(provider: string): ProviderHandler | null {
  const apiStyle = getProviderApiStyle(provider);
  if (!apiStyle) return null;
  return API_STYLE_HANDLERS[apiStyle] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a strategy config and an optional task_mode, produce an ordered list
 * of { provider, model } entries to try. Primary first, then fallback chain.
 * task_mode overrides primary when the strategy has taskModes configured.
 */
export function resolveProviderChain(config: StrategyConfig, taskMode: string | null = null): ChainEntry[] {
  const chain: ChainEntry[] = [];

  // Task-mode override goes first if present.
  if (taskMode && config.taskModes?.[taskMode]) {
    chain.push(config.taskModes[taskMode]);
  }

  // Primary
  if (config.primary) {
    // Avoid duplicate if task mode matched primary
    const dup = chain.find(
      (c) => c.provider === config.primary!.provider && c.model === config.primary!.model
    );
    if (!dup) chain.push(config.primary);
  }

  // Fallback chain
  for (const fb of config.fallback || []) {
    const dup = chain.find((c) => c.provider === fb.provider && c.model === fb.model);
    if (!dup) chain.push(fb);
  }

  // Filter out disallowed providers
  const disallowed = new Set(config.disallowedProviders || []);
  const allowed = config.allowedProviders ? new Set(config.allowedProviders) : null;

  return chain.filter((entry) => {
    if (disallowed.has(entry.provider)) return false;
    if (allowed && !allowed.has(entry.provider)) return false;
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main execution entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a chat completion using a model strategy with full fallback,
 * retry, and budget enforcement.
 *
 * @param sql - Database connection
 * @param orgId - Organization id
 * @param strategyConfig - Parsed config from a model_strategies row
 * @param messages - Chat messages
 * @param options - max_tokens, temperature, task_mode
 */
export async function executeCompletion(
  sql: SqlTag,
  orgId: string,
  strategyConfig: StrategyConfig,
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  const chain = resolveProviderChain(strategyConfig, options.task_mode);
  if (chain.length === 0) {
    throw new Error('No usable providers in strategy after filtering');
  }

  const creds = await loadOrgCredentials(sql, orgId);
  const maxRetries = strategyConfig.maxRetries ?? 1;
  const maxBudgetUsd = strategyConfig.maxBudgetUsd ?? Infinity;
  const customPricing = await getModelPricing(sql, orgId);

  const errors: ProviderError[] = [];

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i]!;
    const handler = getProviderHandler(provider);
    if (!handler) {
      errors.push({ provider, model, error: `Unsupported provider: ${provider}` });
      continue;
    }

    const baseUrl = getProviderBaseUrl(provider);
    const label = getProviderLabel(provider);
    const apiKey = getProviderKey(creds, provider);
    if (!apiKey) {
      errors.push({ provider, model, error: `No API key configured for ${provider}` });
      continue;
    }

    // Retry loop for this provider
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await handler(baseUrl, label, apiKey, model, messages, options);

        // Budget enforcement
        const cost = estimateCost(
          result.usage.input_tokens,
          result.usage.output_tokens,
          result.raw_model || model,
          customPricing as Parameters<typeof estimateCost>[3]
        );

        if (cost > maxBudgetUsd) {
          errors.push({
            provider,
            model,
            error: `Estimated cost $${cost.toFixed(4)} exceeds budget cap $${maxBudgetUsd}`,
          });
          break; // Don't retry same provider — budget will exceed again
        }

        return {
          content: result.content,
          provider,
          model: result.raw_model || model,
          usage: result.usage,
          cost_usd: cost,
          fallback_used: i > 0,
          attempts: errors.length + attempt + 1,
        };
      } catch (err) {
        const message = (err as Error)?.message;
        errors.push({
          provider,
          model,
          attempt: attempt + 1,
          error: message,
        });
        // Only retry on potentially transient errors (5xx, timeout)
        if (message?.includes('abort') || message?.match(/5\d\d/)) {
          continue;
        }
        break; // Non-retryable error (4xx, auth, etc.) — move to fallback
      }
    }
  }

  const err = new Error(
    `All providers failed. Tried: ${errors.map((e) => `${e.provider}/${e.model}: ${e.error}`).join('; ')}`
  ) as Error & { provider_errors?: ProviderError[] };
  err.provider_errors = errors;
  throw err;
}

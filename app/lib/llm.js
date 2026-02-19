/**
 * Lightweight LLM client for DashClaw.
 * Zero-dependency (uses native fetch).
 *
 * DESIGN PRINCIPLE: Nothing in DashClaw should break if no LLM is configured.
 * This module returns null/graceful fallbacks when no provider is available.
 *
 * Provider detection order:
 *   1. GUARD_LLM_KEY / OPENAI_API_KEY   OpenAI (gpt-4o-mini)
 *   2. ANTHROPIC_API_KEY   Anthropic (claude-3-haiku-20240307)
 *   3. GOOGLE_AI_API_KEY   Google AI (gemini-1.5-flash, free tier available)
 *
 * Usage:
 *   import { isLLMAvailable, tryLLMComplete } from './llm.js';
 *   if (isLLMAvailable()) { ... }
 *   const { result, error } = await tryLLMComplete('Rate this action...');
 */

import { scanSensitiveData } from './security.js';

// ----------------------------------------------
// Generic LLM Provider Abstraction (Phase 0)
// ----------------------------------------------

let _providerDetected = false;
let _cachedProvider = null;

function _detectProvider() {
  if (_providerDetected) return _cachedProvider;
  _providerDetected = true;

  const openaiKey = process.env.GUARD_LLM_KEY || process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_AI_API_KEY;

  if (openaiKey) {
    _cachedProvider = {
      name: 'openai',
      model: process.env.GUARD_LLM_MODEL || 'gpt-4o-mini',
      key: openaiKey,
      baseUrl: process.env.GUARD_LLM_BASE_URL || 'https://api.openai.com/v1',
    };
  } else if (anthropicKey) {
    _cachedProvider = {
      name: 'anthropic',
      model: 'claude-3-haiku-20240307',
      key: anthropicKey,
      baseUrl: 'https://api.anthropic.com/v1',
    };
  } else if (googleKey) {
    _cachedProvider = {
      name: 'google',
      model: 'gemini-1.5-flash',
      key: googleKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    };
  } else {
    _cachedProvider = null;
  }

  console.log(
    `[DashClaw] AI Provider: ${_cachedProvider?.name || 'none (all features work without AI)'}`
  );
  return _cachedProvider;
}

/**
 * Checks if any LLM provider is configured.
 * @returns {boolean}
 */
export function isLLMAvailable() {
  return _detectProvider() !== null;
}

/**
 * Returns provider info (name + model), or null if none configured.
 * @returns {{ name: string, model: string } | null}
 */
export function getLLMProviderInfo() {
  const p = _detectProvider();
  return p ? { name: p.name, model: p.model } : null;
}

/**
 * Attempts an LLM completion. Returns { result, error, provider }.
 * If no LLM configured, returns { result: null, error: 'no_llm_configured' }.
 * Never throws   always returns gracefully.
 *
 * @param {string} prompt
 * @param {{ maxTokens?: number, temperature?: number, model?: string }} [options]
 * @returns {Promise<{ result: string|null, error: string|null, provider: string|null }>}
 */
export async function tryLLMComplete(prompt, options = {}) {
  const provider = _detectProvider();

  if (!provider) {
    return {
      result: null,
      error: 'no_llm_configured',
      provider: null,
    };
  }

  const maxTokens = options.maxTokens || 500;
  const temperature = options.temperature ?? 0;
  const model = options.model || provider.model;

  try {
    if (provider.name === 'openai') {
      return await _openaiComplete(provider, prompt, model, maxTokens, temperature);
    } else if (provider.name === 'anthropic') {
      return await _anthropicComplete(provider, prompt, model, maxTokens, temperature);
    } else if (provider.name === 'google') {
      return await _googleComplete(provider, prompt, model, maxTokens, temperature);
    }
    return { result: null, error: `Unknown provider: ${provider.name}`, provider: provider.name };
  } catch (err) {
    return { result: null, error: err.message || String(err), provider: provider.name };
  }
}

async function _openaiComplete(provider, prompt, model, maxTokens, temperature) {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { result: null, error: `OpenAI ${res.status}: ${body}`, provider: 'openai' };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || null;
  return { result: text, error: null, provider: 'openai' };
}

async function _anthropicComplete(provider, prompt, model, maxTokens, temperature) {
  const res = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      temperature,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { result: null, error: `Anthropic ${res.status}: ${body}`, provider: 'anthropic' };
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || null;
  return { result: text, error: null, provider: 'anthropic' };
}

async function _googleComplete(provider, prompt, model, maxTokens, temperature) {
  const url = `${provider.baseUrl}/models/${model}:generateContent?key=${provider.key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { result: null, error: `Google AI ${res.status}: ${body}`, provider: 'google' };
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  return { result: text, error: null, provider: 'google' };
}

// ----------------------------------------------
// Guard-Specific Semantic Check (existing functionality)
// ----------------------------------------------

const GUARD_PROMPT_TEMPLATE = `
You are a security guardrail for an AI agent.
Analyze the following ACTION against the POLICY.

ACTION:
{action_context}

POLICY:
{policy_instruction}

Your task:
1. Determine if the action violates the policy.
2. If it violates, return allowed: false.
3. If it is safe/compliant, return allowed: true.
4. Provide a short reason.

Respond ONLY with valid JSON:
{
  "allowed": boolean,
  "reason": "string"
}
`;

export async function checkSemanticGuardrail(context, instruction, model = 'gpt-4o-mini') {
  const apiKey = process.env.GUARD_LLM_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = process.env.GUARD_LLM_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    console.warn('[Guard] No GUARD_LLM_KEY or OPENAI_API_KEY configured. Skipping semantic check.');
    return null;
  }

  const actionContext = JSON.stringify(
    {
      type: context.action_type,
      goal: context.declared_goal,
      systems: context.systems_touched,
      risk: context.risk_score,
    },
    null,
    2
  );

  const prompt = GUARD_PROMPT_TEMPLATE.replace('{action_context}', actionContext).replace(
    '{policy_instruction}',
    instruction
  );

  const scanned = scanSensitiveData(prompt);
  const safePrompt = scanned.redacted;
  if (!scanned.clean) {
    console.warn(
      `[Guard] Redacted ${scanned.findings.length} sensitive pattern(s) from semantic guardrail prompt.`
    );
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a JSON-only security compliance bot.' },
          { role: 'user', content: safePrompt },
        ],
        temperature: 0,
        max_tokens: 150,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.error(`[Guard] LLM request failed: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices[0]?.message?.content;

    if (!content) return null;

    return JSON.parse(content);
  } catch (error) {
    console.error('[Guard] Semantic check error:', error);
    return null;
  }
}

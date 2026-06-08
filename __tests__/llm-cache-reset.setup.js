/**
 * Global vitest setup: reset the llm.ts module-level provider cache after every
 * test.
 *
 * Vitest persists module state across files within a worker. A test that sets a
 * provider key (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_AI_API_KEY) and
 * exercises the real `_detectProvider()` (e.g. guard-engine, predictive-risk)
 * caches a provider in llm.ts. That cache outlives `unstubEnvs` (which resets
 * the env but NOT this in-module flag), so a later file — notably the eval
 * suite — can observe `isLLMAvailable() === true` even with no key set. That
 * leak is the root cause of the eval llm_judge/custom_function flake that
 * appeared ~1/3 of full-suite runs but never in isolation.
 *
 * Resetting the real cache after each test makes provider detection
 * test-isolated. Files that `vi.mock('@/lib/llm.js')` don't use the real cache,
 * so `__resetLLMCache` is absent/mocked there — the typeof guard makes this a
 * harmless no-op for them.
 */
import { afterEach } from 'vitest';
import * as llm from '@/lib/llm.js';

afterEach(() => {
  if (typeof llm.__resetLLMCache === 'function') llm.__resetLLMCache();
});

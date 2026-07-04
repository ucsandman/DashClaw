// Centralized, typed environment contract (Phase 3 — runtime validation alignment).
//
// Behavior-preserving by design: every var is OPTIONAL and `validateEnv()` is
// NON-throwing and OPT-IN. The app already starts with optional vars unset and
// their existing fallbacks (e.g. DASHCLAW_JTI_REPLAY_PROTECTION defaults to
// 'required' in replay-protection.ts); turning missing required vars into a hard startup
// throw would CHANGE behavior and is intentionally deferred (a startup-gate
// decision for the operator). This module establishes the typed contract +
// inferred type and a health-check function callers may opt into.

import { z } from 'zod';

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z.enum(['development', 'production', 'test']),
    NEXTAUTH_SECRET: z.string().min(1),
    // Governance knobs (validated shape; defaults live in the consuming modules).
    DASHCLAW_JTI_REPLAY_PROTECTION: z.enum(['off', 'best_effort', 'required']),
    DASHCLAW_ACT_BINDING: z.enum(['off', 'best_effort', 'required']),
    DASHCLAW_JTI_MAX_TTL_SECONDS: z.string(),
    DASHCLAW_GUARD_FALLBACK: z.enum(['allow', 'block', 'require_approval']),
    DASHCLAW_GUARD_DEADLINE_MS: z.string(),
    // v3.7 hardening knobs (defaults live in the consuming modules).
    DASHCLAW_X402_CURRENCIES: z.string(),
    DASHCLAW_EXPOSE_ERROR_DETAIL: z.string(),
    DISABLE_PROMPT_INJECTION_SCAN: z.string(),
    GUARD_LLM_KEY: z.string(),
    OPENAI_API_KEY: z.string(),
    TRUST_PROXY: z.string(),
    PREDICTIVE_RISK_ENABLED: z.string(),
  })
  .partial();

/** Inferred typed view of the known DashClaw environment surface. */
export type Env = z.infer<typeof EnvSchema>;

/**
 * Non-throwing shape check over an environment source. Unknown vars pass through
 * (object-strip on parse is not an error); only KNOWN vars with a declared shape
 * (e.g. an out-of-range enum) are flagged. Opt-in — does not run at import.
 */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): { ok: boolean; errors: string[] } {
  const result = EnvSchema.safeParse(source);
  if (result.success) return { ok: true, errors: [] };
  return { ok: false, errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** Typed accessor over the raw environment (no stripping; preserves all vars). */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env & NodeJS.ProcessEnv {
  return source as Env & NodeJS.ProcessEnv;
}

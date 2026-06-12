import { describe, it, expect } from 'vitest';
import { validateEnv, getEnv } from '@/lib/env';

describe('env schema (Phase 3 — centralized env contract)', () => {
  it('accepts a well-formed environment', () => {
    const r = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pass@host/db',
      DASHCLAW_JTI_REPLAY_PROTECTION: 'required',
      DASHCLAW_ACT_BINDING: 'best_effort',
      DASHCLAW_GUARD_FALLBACK: 'allow',
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('flags an out-of-range enum value', () => {
    const r = validateEnv({ DASHCLAW_JTI_REPLAY_PROTECTION: 'bogus' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/DASHCLAW_JTI_REPLAY_PROTECTION/);
  });

  it('accepts require_approval for DASHCLAW_GUARD_FALLBACK (global degradation contract)', () => {
    expect(validateEnv({ DASHCLAW_GUARD_FALLBACK: 'require_approval' }).ok).toBe(true);
    expect(validateEnv({ DASHCLAW_GUARD_FALLBACK: 'block' }).ok).toBe(true);
    expect(validateEnv({ DASHCLAW_GUARD_FALLBACK: 'banana' }).ok).toBe(false);
  });

  it('is behavior-preserving: missing optional vars are OK, unknown vars pass through', () => {
    expect(validateEnv({}).ok).toBe(true);
    expect(validateEnv({ SOME_UNREGISTERED_VAR: 'x' }).ok).toBe(true);
  });

  it('getEnv returns a typed view without dropping vars', () => {
    const env = getEnv({ DATABASE_URL: 'postgres://x', SOME_UNREGISTERED_VAR: 'keep' });
    expect(env.DATABASE_URL).toBe('postgres://x');
    expect(env.SOME_UNREGISTERED_VAR).toBe('keep');
  });
});

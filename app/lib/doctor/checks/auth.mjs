// app/lib/doctor/checks/auth.mjs
import { getAuthConfig } from '../../authConfig.mjs';
import { getSql } from '../../db';
import { getSetupStatus } from '../../setupStatus.mjs';

/**
 * @param {{ env?: object }} options
 */
export async function runChecks({ env = process.env } = {}) {
  const authConfig = getAuthConfig(env);
  const checks = [];

  // API key — accept either env var OR a DB-backed workspace key
  const hasEnvKey = Boolean(env.DASHCLAW_API_KEY);
  let hasDbKey = false;

  if (!hasEnvKey) {
    // Try the DB as a fallback, but only if the DB is reachable.
    try {
      const dbStatus = await getSetupStatus(env);
      if (dbStatus.configured) {
        const sql = getSql();
        const rows = await sql`SELECT 1 FROM api_keys WHERE revoked_at IS NULL LIMIT 1`;
        hasDbKey = rows.length > 0;
      }
    } catch {
      // DB unreachable — surface via database check, treat as no DB key
    }
  }

  const hasAnyKey = hasEnvKey || hasDbKey;

  checks.push({
    id: 'auth_api_key',
    category: 'auth',
    status: hasAnyKey ? 'pass' : 'fail',
    title: 'API Key',
    message: hasEnvKey
      ? 'DASHCLAW_API_KEY is set'
      : hasDbKey
        ? 'No env var, but a workspace API key exists in the database'
        : 'No API key configured — agents cannot authenticate',
    fix: hasAnyKey
      ? null
      : { type: 'auto', description: 'Generate a new API key', action: 'generate_api_key' },
  });

  // Sign-in methods
  const availableMethods = [
    ...authConfig.oauthProviders.map((p) => p.name),
    ...(authConfig.hasLocalPassword ? ['Local password'] : []),
  ];
  checks.push({
    id: 'auth_signin',
    category: 'auth',
    status: authConfig.hasAnySignInMethod ? 'pass' : 'warn',
    title: 'Sign-In Methods',
    message: authConfig.hasAnySignInMethod
      ? `Sign-in available via: ${availableMethods.join(', ')}`
      : 'No sign-in method configured — operators cannot access the dashboard',
    fix: null,
  });

  // Partial provider warnings
  for (const provider of authConfig.providerChecks || []) {
    if (provider.partiallyConfigured) {
      checks.push({
        id: `auth_${provider.id}_partial`,
        category: 'auth',
        status: 'warn',
        title: `${provider.name} OAuth (Partial)`,
        message: `Missing: ${provider.missingKeys.join(', ')}`,
        fix: null,
      });
    }
  }

  return checks;
}

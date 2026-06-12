// app/lib/doctor/fixes/index.mjs
import { apply as migrate } from './migrate.mjs';
import {
  applyGenerateSecret,
  applyGenerateEncryptionKey,
  applyGenerateApiKey,
} from './generate-secrets.mjs';
import { apply as fixCors } from './fix-cors.mjs';
import { apply as createDefaultPolicy } from './create-default-policy.mjs';
import { apply as regenerateArtifacts } from './regenerate-artifacts.mjs';
import { apply as normalizeTimestamps } from './normalize-timestamps.mjs';

/**
 * Registry of fix action keys → handlers.
 * scope: 'local' = requires filesystem (env writes). 'remote' = DB-only (safe via API).
 */
export const FIX_REGISTRY = {
  migrate:                  { handler: migrate, scope: 'remote' },
  generate_secret:          { handler: applyGenerateSecret, scope: 'local' },
  generate_encryption_key:  { handler: applyGenerateEncryptionKey, scope: 'local' },
  generate_api_key:         { handler: applyGenerateApiKey, scope: 'local' },
  fix_cors:                 { handler: fixCors, scope: 'local' },
  create_default_policy:    { handler: createDefaultPolicy, scope: 'remote' },
  regenerate_artifacts:     { handler: regenerateArtifacts, scope: 'local' },
  normalize_timestamps:     { handler: normalizeTimestamps, scope: 'remote' },
};

/**
 * Apply a fix by action key.
 * @param {string} action
 * @param {Object} [params]
 * @param {{ allowLocal?: boolean }} [options]
 */
export async function applyFix(action, params = {}, options = {}) {
  const { allowLocal = false } = options;
  const entry = FIX_REGISTRY[action];

  if (!entry) {
    return { applied: false, action, description: `Unknown fix action: ${action}` };
  }

  if (entry.scope === 'local' && !allowLocal) {
    return {
      applied: false,
      action,
      description: `Fix "${action}" requires local filesystem access — run npm run doctor instead`,
    };
  }

  const result = await entry.handler(params);
  return { ...result, action };
}

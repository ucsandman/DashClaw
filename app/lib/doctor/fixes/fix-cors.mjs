// app/lib/doctor/fixes/fix-cors.mjs
import { writeEnvUpdates } from './env-writer.mjs';

const ALLOWED_ORIGIN_VAR = 'ALLOWED_ORIGIN';

/**
 * @param {{ origin?: string }} params
 */
export async function apply({ origin } = {}) {
  if (!origin) return { applied: false, description: 'No origin provided — cannot auto-fix CORS' };
  const { backedUp } = writeEnvUpdates({ [ALLOWED_ORIGIN_VAR]: origin });
  return {
    applied: true,
    description: `Set ${ALLOWED_ORIGIN_VAR} to ${origin}${backedUp ? ' (backed up .env to .env.backup)' : ''}`,
  };
}

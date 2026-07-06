import { timingSafeEqual } from 'node:crypto';

/**
 * v8.3 entry-path drills: the hosted stranger drill needs to mint a trial
 * against the LIVE instance from a script, and Turnstile (correctly) blocks
 * scripts. This is the narrow, operator-held alternative: a long random
 * value in the HOSTED_DRILL_TOKEN env var, presented as the
 * x-hosted-drill-token header, substitutes for Turnstile on
 * POST /api/hosted/workspaces ONLY.
 *
 * Containment, in order of importance:
 * - Env unset (the default everywhere) = no bypass exists at all.
 * - Values shorter than MIN_TOKEN_LENGTH are refused outright, so a
 *   placeholder can never arm the bypass.
 * - Comparison is timing-safe.
 * - A drill mint is force-labeled source='drill' (the caller's self-reported
 *   attribution is ignored), so drill traffic is visible-and-excludable in
 *   the funnel, the reach cohort read, and the public aggregates — while the
 *   workspace row stays a real capped trial, because exercising the real
 *   path is the point.
 * - The per-IP provisioning rate limit still applies to drill mints.
 */
export const DRILL_MINT_SOURCE = 'drill';
const MIN_TOKEN_LENGTH = 24;

export function isDrillMint(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const configured = env.HOSTED_DRILL_TOKEN || '';
  if (configured.length < MIN_TOKEN_LENGTH) return false;
  const presented = request.headers.get('x-hosted-drill-token') || '';
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

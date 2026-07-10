#!/usr/bin/env node
// Pre-deploy readiness checker for DASHCLAW_HOSTED=true deployments.
// Exits 0 on ok or skipped, 1 on fail. Prints a readable report either way.
//
// HARD FAILS on every secret the hosted runtime genuinely requires to boot and
// let anyone sign in — not just the provisioning trio. Missing any of these
// ships a deployment that 503s, throws on first encrypt, or has a locked front
// door:
//   - DATABASE_URL            (all persistence)
//   - NEXTAUTH_SECRET         (middleware.js getToken → JWT session decode)
//   - NEXTAUTH_URL            (middleware host allowlist + OAuth callbacks)
//   - ENCRYPTION_KEY (32B)    (app/lib/encryption.ts throws if unset/wrong len)
//   - a sign-in provider pair (app/lib/authConfig.mjs — zero providers = nobody can sign in)
//   - TURNSTILE_SECRET_KEY    (public trial mint is abuse-open without it)
//   - DASHCLAW_API_KEY        (seeded admin key; format oc_live_<32hex>)
// Redis is a LOUD WARNING (not a fail) because the runtime degrades gracefully:
// the rate limiter (app/lib/hosted/rate-limit.ts) and realtime bus (app/lib/events.ts)
// both fall back to in-memory, which is only lossy across serverless cold starts.

import { getAuthConfig } from '../app/lib/authConfig.mjs';

const API_KEY_PATTERN = /^oc_live_[0-9a-f]{32}$/;

function finding(message, nextAction) {
  return { message, nextAction };
}

export function assessHostedReadiness(env = process.env) {
  if (env.DASHCLAW_HOSTED !== 'true') {
    return { status: 'skipped', failures: [], warnings: [], info: 'hosted mode not enabled' };
  }

  const failures = [];
  const warnings = [];

  if (!env.DATABASE_URL) {
    failures.push(finding(
      'DATABASE_URL missing',
      'Set DATABASE_URL to the pooled production Postgres connection string, then rerun hosted:check-ready.',
    ));
  }

  // NEXTAUTH_SECRET: middleware.js decodes every dashboard session with
  // getToken({ secret: NEXTAUTH_SECRET }). Unset → no session ever verifies →
  // authenticated routes reject everyone.
  if (!env.NEXTAUTH_SECRET) {
    failures.push(finding(
      'NEXTAUTH_SECRET missing',
      'Generate one with node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))" and set NEXTAUTH_SECRET. Without it middleware getToken cannot verify any session.',
    ));
  }

  // NEXTAUTH_URL: middleware builds its host allowlist from NEXTAUTH_URL
  // (ALLOWED_ORIGIN/NEXTAUTH_URL), and OAuth callbacks are constructed from it.
  if (!env.NEXTAUTH_URL) {
    failures.push(finding(
      'NEXTAUTH_URL missing',
      'Set NEXTAUTH_URL to the deployment origin (e.g. https://hosted.dashclaw.io). It seeds the middleware host allowlist and OAuth callback URLs.',
    ));
  }

  // ENCRYPTION_KEY: app/lib/encryption.ts throws on first use if this is unset
  // or not exactly 32 bytes. Validate the SAME way it does.
  if (!env.ENCRYPTION_KEY) {
    failures.push(finding(
      'ENCRYPTION_KEY missing',
      'Set ENCRYPTION_KEY to an exactly-32-byte string. app/lib/encryption.ts throws without it, so any encrypted field (managed secrets, integration tokens) fails at runtime.',
    ));
  } else if (env.ENCRYPTION_KEY.length !== 32 || Buffer.byteLength(env.ENCRYPTION_KEY, 'utf8') !== 32) {
    failures.push(finding(
      'ENCRYPTION_KEY must be exactly 32 bytes (32 ASCII characters)',
      'Regenerate with node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\').slice(0,32))". app/lib/encryption.ts rejects any other length.',
    ));
  }

  // Sign-in provider pair: with zero configured providers nobody can sign in to
  // the dashboard. authConfig treats a complete GitHub/Google/OIDC pair or the
  // local-admin password as a valid sign-in method.
  const authConfig = getAuthConfig(env);
  if (!authConfig.hasAnySignInMethod) {
    failures.push(finding(
      'no dashboard sign-in method configured — nobody can sign in',
      'Set a provider pair: GOOGLE_ID(+_CLIENT_ID)/GOOGLE_SECRET(+_CLIENT_SECRET), or GITHUB_ID/GITHUB_SECRET, or OIDC_CLIENT_ID/OIDC_CLIENT_SECRET/OIDC_ISSUER_URL (DASHCLAW_LOCAL_ADMIN_PASSWORD covers solo self-host only).',
    ));
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    failures.push(finding(
      'TURNSTILE_SECRET_KEY missing',
      'Create a Cloudflare Turnstile secret key and set TURNSTILE_SECRET_KEY in the deployment environment.',
    ));
  }
  if (!env.DASHCLAW_API_KEY) {
    failures.push(finding(
      'DASHCLAW_API_KEY missing',
      'Generate an oc_live_<32 hex chars> admin key and set DASHCLAW_API_KEY before deploying hosted mode.',
    ));
  } else if (!API_KEY_PATTERN.test(env.DASHCLAW_API_KEY)) {
    failures.push(finding(
      'DASHCLAW_API_KEY format invalid (expect oc_live_<32hex>)',
      'Regenerate DASHCLAW_API_KEY with node crypto.randomBytes(16).toString("hex") and the oc_live_ prefix.',
    ));
  }

  // Redis: LOUD WARNING, not a fail. Rate limiting (app/lib/hosted/rate-limit.ts)
  // and the realtime event bus (app/lib/events.ts) both fall back to in-memory.
  // That is functional but per-instance — on a serverless/multi-tenant host each
  // cold start resets the per-IP rate-limit map and drops in-flight SSE events.
  if (!env.REDIS_URL && !env.UPSTASH_REDIS_REST_URL) {
    warnings.push(finding(
      'no Redis configured (REDIS_URL or UPSTASH_REDIS_REST_URL) — rate limits and SSE run in-memory',
      'Set REDIS_URL or UPSTASH_REDIS_REST_URL. On serverless (Vercel), in-memory rate-limit state resets every cold start and SSE events are lost between invocations; Turnstile stays the primary abuse defence but per-IP limits are only a soft hint without a shared store.',
    ));
  }

  if (!env.HOSTED_CLEANUP_SECRET && !env.CRON_SECRET) {
    warnings.push(finding(
      'no cleanup secret configured (HOSTED_CLEANUP_SECRET or CRON_SECRET) — scheduled trial cleanup cannot authenticate',
      'Set HOSTED_CLEANUP_SECRET for GitHub Actions cleanup or CRON_SECRET for Vercel cron cleanup. Without it expired trials are only reclaimed by request-time enforcement + manual admin calls, not the daily sweep.',
    ));
  }
  if (!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    warnings.push(finding(
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY unset — Turnstile widget will not render (server still gates provisioning)',
      'Set NEXT_PUBLIC_TURNSTILE_SITE_KEY to the public Cloudflare Turnstile site key and redeploy.',
    ));
  }

  return {
    status: failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    failures,
    warnings,
  };
}

// CLI entrypoint
import { pathToFileURL } from 'url';
const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = assessHostedReadiness();
  const lines = [`[hosted:check-ready] status=${result.status}`];
  for (const f of result.failures) lines.push(`  FAIL: ${f.message} | NEXT: ${f.nextAction}`);
  for (const w of result.warnings) lines.push(`  WARN: ${w.message} | NEXT: ${w.nextAction}`);
  if (result.info) lines.push(`  INFO: ${result.info}`);
  console.log(lines.join('\n'));
  process.exit(result.status === 'fail' ? 1 : 0);
}

#!/usr/bin/env node
// Pre-deploy readiness checker for DASHCLAW_HOSTED=true deployments.
// Exits 0 on ok or skipped, 1 on fail. Prints a readable report either way.

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

  if (!env.HOSTED_CLEANUP_SECRET && !env.CRON_SECRET) {
    warnings.push(finding(
      'no cleanup secret configured (HOSTED_CLEANUP_SECRET or CRON_SECRET) — cleanup route is admin-only',
      'Set HOSTED_CLEANUP_SECRET for GitHub Actions cleanup or CRON_SECRET for Vercel cron cleanup.',
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

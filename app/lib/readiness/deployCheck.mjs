import { createSection, createCheck } from './factories.mjs';

function checkNextAuthUrl(env, host) {
  const configuredUrl = env.NEXTAUTH_URL || '';
  if (!configuredUrl) {
    return createCheck({
      id: 'nextauth_url',
      label: 'NEXTAUTH_URL is not configured',
      status: 'fail',
      detail: 'Auth redirects will fail until this is set.',
      likelyCause: 'NEXTAUTH_URL is missing from the deployment environment.',
      nextAction:
        'In Vercel → Settings → Environment Variables, set NEXTAUTH_URL to your deployment URL, then redeploy.',
    });
  }
  try {
    const configured = new URL(configuredUrl);
    const mismatch = configured.host !== host;
    if (mismatch) {
      return createCheck({
        id: 'nextauth_url',
        label: 'NEXTAUTH_URL does not match deployment host',
        status: 'warn',
        detail: `Configured: ${configured.host} — current: ${host}`,
        likelyCause: 'NEXTAUTH_URL points at a different host than the current request.',
        nextAction: `In Vercel, set NEXTAUTH_URL to https://${host} and redeploy.`,
      });
    }
    return createCheck({
      id: 'nextauth_url',
      label: 'NEXTAUTH_URL matches deployment host',
      status: 'pass',
      detail: 'Configured host matches current request.',
    });
  } catch {
    return createCheck({
      id: 'nextauth_url',
      label: 'NEXTAUTH_URL does not match deployment host',
      status: 'warn',
      detail: 'Configured value is not a valid URL.',
      likelyCause: 'NEXTAUTH_URL is present but cannot be parsed as an absolute URL.',
      nextAction: `In Vercel, set NEXTAUTH_URL to https://${host} and redeploy.`,
    });
  }
}

function checkRealtimeBackend(env) {
  const isVercel = Boolean(env.VERCEL);
  const hasUpstash = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
  const hasRedis = Boolean(env.REDIS_URL || hasUpstash);

  if (isVercel && !hasRedis) {
    return createCheck({
      id: 'realtime_backend',
      label: 'Live stream requires Redis on serverless',
      status: 'warn',
      detail:
        'Running in-memory mode. Each serverless invocation has a fresh event bus — Approvals will not show live decisions.',
      likelyCause: 'The deployment is running on Vercel without Redis or Upstash configured for shared realtime state.',
      nextAction:
        'Create a free Upstash Redis instance at upstash.com and add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to Vercel environment variables.',
    });
  }

  if (hasRedis) {
    return createCheck({
      id: 'realtime_backend',
      label: 'Realtime backend: Redis',
      status: 'pass',
      detail: 'Approvals live stream is active.',
    });
  }

  return createCheck({
    id: 'realtime_backend',
    label: 'Realtime backend: in-memory',
    status: 'info',
    detail: 'Acceptable for local development.',
  });
}

export function buildDeploySection(env, host) {
  const checks = [checkNextAuthUrl(env, host), checkRealtimeBackend(env)];

  const hasFailure = checks.some((c) => c.status === 'fail');
  const hasWarning = checks.some((c) => c.status === 'warn');
  const status = hasFailure ? 'fail' : hasWarning ? 'warn' : 'pass';
  const ok = !hasFailure;

  return createSection({
    id: 'deploy',
    title: 'Deploy Readiness',
    status,
    description: 'Vercel-specific configuration checks for production readiness.',
    summary: ok
      ? hasWarning
        ? 'Deploy configuration has recommendations.'
        : 'Deploy configuration looks correct.'
      : 'Deploy configuration needs attention.',
    whatWasChecked: 'NEXTAUTH_URL vs current host, realtime backend on serverless.',
    evidenceSummary: ok ? 'Deploy checks passed.' : 'Deploy configuration issues detected.',
    pendingProof: '',
    checks,
    ok,
  });
}

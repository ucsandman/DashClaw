// cli/lib/doctor.js
import { bold, dim, green, yellow, red } from './render.js';
import {
  buildContext,
  detectRepoRoot,
  runLocalChecks,
  applyLocalFixes,
} from './local-doctor.js';

// Brand orange (256-color ANSI). Used sparingly — header + key accents only.
const BRAND = (s) => `\x1b[38;5;208m${s}\x1b[0m`;

const ICONS = {
  pass: green('\u2713'),
  warn: yellow('\u26a0'),
  fail: red('\u2717'),
};

const CATEGORY_LABELS = {
  database: 'Database',
  config: 'Configuration',
  auth: 'Authentication',
  deployment: 'Deployment',
  sdk: 'SDK Connectivity',
  governance: 'Governance',
  'openclaw-plugin': 'OpenClaw Plugin',
  hosted: 'Hosted',
  'data-hygiene': 'Data Hygiene',
  'local-repo': 'Local Repo (this machine)',
  'local-machine': 'Machine Setup (this machine)',
};

const CATEGORY_ORDER = [
  'database', 'config', 'auth', 'deployment', 'sdk', 'governance',
  'openclaw-plugin', 'hosted', 'data-hygiene', 'local-repo', 'local-machine',
];

// Next-step guidance by check ID, used when the check has no auto-fix.
// Keep each line short and actionable.
const GUIDANCE = {
  db_connection: 'Check DATABASE_URL and that Postgres is reachable from your deployment.',
  env_NEXTAUTH_URL: 'Set NEXTAUTH_URL to your deployment URL (e.g. https://your.vercel.app).',
  env_CRON_SECRET: 'Set CRON_SECRET to protect /api/cron/* endpoints.',
  auth_signin: 'Configure an OAuth provider (GitHub/Google) or set DASHCLAW_LOCAL_ADMIN_PASSWORD.',
  deploy_nextauth_url: 'Set NEXTAUTH_URL to match your deployment domain.',
  deploy_cors: 'Set ALLOWED_ORIGIN if your agents run from a different domain.',
  sdk_reachable: 'Check DASHCLAW_BASE_URL and confirm your instance is deployed and awake.',
  sdk_auth: 'API key rejected — verify DASHCLAW_API_KEY matches the key on your instance.',
  gov_actions: 'Send your first governed action with claw.guard() via the SDK.',
  gov_stale: "Agents haven't reported in 7 days — check your agent pairings.",
  remote_unreachable: 'Check DASHCLAW_BASE_URL and confirm your instance is deployed and awake.',
  remote_auth: 'API key rejected — verify DASHCLAW_API_KEY matches the key on your instance.',
};

function hr(width = 72) {
  return dim('\u2500'.repeat(width));
}

/**
 * Return an actionable next-step string for a non-passing check, or null.
 * In report-only mode (the default), fixable checks point at --fix.
 */
function nextStepFor(check, { fixMode }) {
  if (!check || check.status === 'pass') return null;

  // Auto-fixable check: direct the user to the fix.
  if (check.fix?.type === 'auto') {
    if (!isFixableByCli(check)) {
      // Remote warn-status fix — POST /api/doctor/fix only applies on fail, so
      // --fix won't attempt it; don't promise what this CLI won't do.
      return `${check.fix.description} — run ${bold('npm run doctor -- --fix')} on the instance host.`;
    }
    if (!fixMode) {
      return `would fix: ${check.fix.description}. Run ${bold('dashclaw doctor --fix')} to apply.`;
    }
    // Fix runs in this invocation; describe what it does.
    return check.fix.description + '.';
  }

  // Fall back to the guidance table for warn/fail without an auto-fix.
  return GUIDANCE[check.id] || null;
}

function doctorUrl(base, category) {
  let url = `${base}/api/doctor?include_fixes=true`;
  if (category) url += `&category=${encodeURIComponent(category)}`;
  return url;
}

function doctorHeaders(apiKey) {
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey };
}

function unreachableCheck(base, detail) {
  return {
    id: 'remote_unreachable',
    category: 'sdk',
    status: 'fail',
    title: 'Instance Reachable',
    message: `Could not reach DashClaw at ${base} (${detail})`,
    fix: null,
  };
}

function authRejectedCheck(base, status) {
  return {
    id: 'remote_auth',
    category: 'sdk',
    status: 'fail',
    title: 'API Key Accepted',
    message: `API key rejected by ${base} (${status})`,
    fix: null,
  };
}

/**
 * Fetch /api/doctor, degrading to a synthetic fail check instead of exiting —
 * local checks still run and report when the instance is down.
 */
async function fetchRemoteResult({ base, apiKey, category, fetchImpl }) {
  const headers = doctorHeaders(apiKey);
  let res;
  try {
    res = await fetchImpl(doctorUrl(base, category), { headers });
  } catch (err) {
    return { result: null, degraded: unreachableCheck(base, err.cause?.code || err.message), headers };
  }

  if (res.status === 401 || res.status === 403) {
    return { result: null, degraded: authRejectedCheck(base, res.status), headers };
  }
  if (!res.ok && res.status !== 503) {
    const errText = await res.text().catch(() => '');
    return { result: null, degraded: unreachableCheck(base, `${res.status} ${errText.slice(0, 120)}`), headers };
  }

  try {
    return { result: await res.json(), degraded: null, headers };
  } catch (err) {
    return { result: null, degraded: unreachableCheck(base, `unparseable response: ${err.message}`), headers };
  }
}

function computeSummary(checks) {
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    if (check.status in summary) summary[check.status]++;
  }
  return summary;
}

/** Merge remote result + local checks into one report (engine status semantics). */
function mergeReport(remoteResult, degradedCheck, localChecks) {
  const remoteChecks = remoteResult?.checks || [];
  const checks = [...remoteChecks, ...(degradedCheck ? [degradedCheck] : []), ...localChecks];
  const summary = computeSummary(checks);
  const status = summary.fail > 0 ? 'unhealthy' : summary.warn > 0 ? 'needs_attention' : 'healthy';
  return { status, summary, checks, timestamp: remoteResult?.timestamp || new Date().toISOString() };
}

function renderHeader(base) {
  const hostLabel = base.replace(/^https?:\/\//, '');
  console.log();
  console.log(`  ${BRAND('[DashClaw]')} ${bold('Doctor')}   ${dim(hostLabel)}`);
  console.log();
}

function groupChecks(checks) {
  const grouped = {};
  for (const check of checks) {
    if (!grouped[check.category]) grouped[check.category] = [];
    grouped[check.category].push(check);
  }
  return grouped;
}

function renderCheck(check, fixMode) {
  const icon = ICONS[check.status] || '?';
  const titleStyled = check.status === 'pass' ? check.title : bold(check.title);
  console.log(`  ${icon} ${titleStyled}`);

  if (check.status !== 'pass') {
    console.log(`    ${dim(check.message)}`);
    const tip = nextStepFor(check, { fixMode });
    if (tip) {
      console.log(`    ${dim('\u2192')} ${tip}`);
    }
  }
}

function renderGroupedChecks(checks, fixMode) {
  const grouped = groupChecks(checks);
  const orderedCategories = [
    ...CATEGORY_ORDER,
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];
  for (const cat of orderedCategories) {
    const categoryChecks = grouped[cat];
    if (!categoryChecks || categoryChecks.length === 0) continue;

    console.log(`  ${bold(CATEGORY_LABELS[cat] || cat)}`);
    for (const check of categoryChecks) {
      renderCheck(check, fixMode);
    }
    console.log();
  }
}

/**
 * A check this invocation's --fix would actually attempt: any non-pass local
 * check with an auto fix, or a remote FAIL with an auto fix (the remote apply
 * path posts fail-status checks only — warn-status remote fixes are server-side).
 */
function isFixableByCli(check) {
  if (!check?.fix || check.fix.type !== 'auto' || check.status === 'pass') return false;
  return check.local ? true : check.status === 'fail';
}

function fixableChecks(checks) {
  return checks.filter(isFixableByCli);
}

async function applyRemoteFix({ base, headers, check, fetchImpl }) {
  try {
    const fixRes = await fetchImpl(`${base}/api/doctor/fix`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: check.fix.action }),
    });
    const fixResult = await fixRes.json();
    return { id: check.id, action: check.fix.action, applied: !!fixResult.applied, description: fixResult.description };
  } catch (err) {
    return {
      id: check.id,
      action: check.fix.action,
      applied: false,
      description: `Fix request failed: ${err.cause?.code || err.message}`,
    };
  }
}

function renderWhatChanged(fixResults) {
  console.log(`  ${bold('What changed')}`);
  if (fixResults.length === 0) {
    console.log(`  ${dim('Nothing \u2014 no auto-fixable issues found.')}`);
    console.log();
    return;
  }
  for (const result of fixResults) {
    if (result.applied) {
      console.log(`  ${green('\u2713')} Applied ${bold(result.action)}: ${result.description}`);
    } else {
      console.log(`  ${yellow('\u26a0')} Skipped ${bold(result.action)}: ${result.description}`);
    }
  }
  console.log();
}

function renderSummary(reporting) {
  const { pass, warn, fail } = reporting.summary;
  console.log(hr());
  console.log();

  const segments = [
    green(`${pass} passed`),
    warn > 0 ? yellow(`${warn} warning${warn !== 1 ? 's' : ''}`) : dim('0 warnings'),
    fail > 0 ? red(`${fail} failed`) : dim('0 failed'),
  ];
  console.log(`  ${segments.join('   ' + dim('\u00b7') + '   ')}`);
  console.log();
}

function renderFixHint(report, fixMode) {
  if (fixMode) return;
  const fixable = fixableChecks(report.checks).length;
  if (fixable > 0) {
    console.log(
      `  ${BRAND('\u2192')} ${fixable} issue${fixable !== 1 ? 's' : ''} can be auto-fixed. Run: ${bold('dashclaw doctor --fix')}`,
    );
  }
}

function renderHealthFooter(base, healthy) {
  if (!healthy) {
    console.log(`  ${dim('Docs:')} ${base}/setup`);
  } else {
    console.log(`  ${green('\u2713')} ${bold('All systems healthy')} — ${dim('ready to govern actions')}`);
  }
  console.log();
}

/**
 * Doctor flow: merged local + remote report; report-only by default; --fix
 * applies local fixes locally and remote auto-fixes via POST /api/doctor/fix,
 * re-checks, and prints a what-changed report. Returns the exit code.
 *
 * @param {{ baseUrl: string, apiKey: string, json?: boolean, fix?: boolean,
 *           noFix?: boolean, category?: string, repo?: string, cliVersion?: string }} options
 * @param {{ fetchImpl?: typeof fetch, local?: object }} [deps] - injectable for tests
 */
export async function runDoctorFlow(options, deps = {}) {
  const { baseUrl, apiKey, json, fix, noFix, category, repo, cliVersion = '0.0.0' } = options;
  const fetchImpl = deps.fetchImpl || fetch;
  const local = deps.local || { buildContext, detectRepoRoot, runLocalChecks, applyLocalFixes };

  // --no-fix is a no-op alias for the (report-only) default; it wins over --fix.
  const fixMode = !!fix && !noFix;
  const base = baseUrl.replace(/\/+$/, '');

  const ctx = local.buildContext({ cliVersion });
  ctx.repoRoot = repo || local.detectRepoRoot({ cwd: ctx.cwd, fs: ctx.fs });

  // Local checks run concurrently with the remote fetch — added wall-clock is
  // max(local, remote) - remote, not the sum.
  const [remote, localChecks] = await Promise.all([
    fetchRemoteResult({ base, apiKey, category, fetchImpl }),
    local.runLocalChecks(ctx),
  ]);

  let report = mergeReport(remote.result, remote.degraded, localChecks);
  let fixResults = [];

  if (fixMode) {
    const localFixable = fixableChecks(localChecks);
    const remoteFixable = (remote.result?.checks || []).filter(
      (c) => c.status === 'fail' && c.fix?.type === 'auto',
    );

    fixResults = await local.applyLocalFixes(localFixable, ctx);
    for (const check of remoteFixable) {
      fixResults.push(await applyRemoteFix({ base, headers: remote.headers, check, fetchImpl }));
    }

    // Re-check after applying so the report reflects the new state.
    if (fixResults.some((r) => r.applied)) {
      const [remote2, localChecks2] = await Promise.all([
        fetchRemoteResult({ base, apiKey, category, fetchImpl }),
        local.runLocalChecks(ctx),
      ]);
      report = mergeReport(remote2.result, remote2.degraded, localChecks2);
    }
  }

  const healthy = report.status === 'healthy';

  if (json) {
    console.log(JSON.stringify(fixMode ? { ...report, fixes: fixResults } : report, null, 2));
    return healthy ? 0 : 1;
  }

  renderHeader(base);
  renderGroupedChecks(report.checks, fixMode);
  if (fixMode) renderWhatChanged(fixResults);
  renderSummary(report);
  renderFixHint(report, fixMode);
  renderHealthFooter(base, healthy);

  return healthy ? 0 : 1;
}

/**
 * Run doctor and exit with its code (CLI entry).
 * @param {{ baseUrl: string, apiKey: string, json?: boolean, fix?: boolean,
 *           noFix?: boolean, category?: string, repo?: string, cliVersion?: string }} options
 */
export async function runDoctor(options) {
  const code = await runDoctorFlow(options);
  process.exit(code);
}

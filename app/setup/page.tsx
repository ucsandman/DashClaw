import Link from 'next/link';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import DashClawLogo from '../components/DashClawLogo';
import PageLayout from '../components/PageLayout';
import VerifyReceiptPanel from '../components/VerifyReceiptPanel';
import { getViewerContextFromCookieHeader } from '../lib/sessionViewer.mjs';
import { projectReadinessReport, getReadinessReport } from '../lib/readiness.mjs';
import { runDoctor } from '../lib/doctor/engine.mjs';
import { getSql } from '../lib/db';
import {
  getLatestLiveCanaryRunForOrg,
  canaryDisplayOrgId,
  type LiveCanaryRun,
} from '../lib/repositories/live-canary.repository';
import { LIVE_CANARY_STALE_MS } from '../lib/posture/findings';
import {
  getLatestEnforcementLivenessRunForOrg,
  listLatestEnforcementLivenessRunPerRuntime,
  deriveFleetEnforcementLiveness,
  type EnforcementLivenessRun,
} from '../lib/repositories/enforcement-liveness.repository';
import {
  getAgentLaneWitness,
  deriveSilentLaneWitnessState,
  getWitnessWindowMinutes,
  type AgentLaneWitnessAggregate,
} from '../lib/repositories/silent-lane-witness.repository';
import { getJtiReplayMode } from '../lib/replay-protection';
import { getActBindingMode } from '../lib/act-binding';
import { resolveDegradedAction } from '../lib/guard';
import { isHostedMode } from '../lib/hosted/flag';
import { getTrialFunnel, type TrialFunnel } from '../lib/repositories/hosted-workspace.repository';

// v3.6 enforcement-posture card: what this instance's hardening knobs resolve
// to right now, read through the same getters the guard uses so the card can
// never disagree with the engine. This page is unauthenticated, so a knob set
// BELOW its hardened default renders as "review recommended" with the value
// withheld (security review, in-ship): a hardened instance discloses nothing
// but the defaults, and a weakened one doesn't hand recon to visitors — the
// same norm as withholding raw DB errors above.
const ENFORCEMENT_MEANINGS: Record<string, Record<string, string>> = {
  DASHCLAW_JTI_REPLAY_PROTECTION: {
    required: 'Verified JWTs must carry a fresh jti; a replay-store outage fails closed. API-key callers are never touched by this knob.',
  },
  DASHCLAW_ACT_BINDING: {
    required: 'Verified tokens must carry a matching (action, target, goal) binding claim.',
    best_effort: 'A token bound to a different (action, target, goal) blocks; issuers that don’t mint the claim are unaffected.',
  },
  DASHCLAW_GUARD_FALLBACK: {
    require_approval: 'An evaluation that degrades (deadline, dependency failure) holds for a human instead of guessing.',
    block: 'Degraded evaluations block outright.',
  },
};

// Strictness order per knob; a value below the hardened default is "weakened".
const ENFORCEMENT_RANK: Record<string, string[]> = {
  DASHCLAW_JTI_REPLAY_PROTECTION: ['off', 'best_effort', 'required'],
  DASHCLAW_ACT_BINDING: ['off', 'best_effort', 'required'],
  DASHCLAW_GUARD_FALLBACK: ['allow', 'require_approval', 'block'],
};
const ENFORCEMENT_DEFAULTS: Record<string, string> = {
  DASHCLAW_JTI_REPLAY_PROTECTION: 'required',
  DASHCLAW_ACT_BINDING: 'best_effort',
  DASHCLAW_GUARD_FALLBACK: 'require_approval',
};

function statusTone(status: string): string {
  switch (status) {
    case 'verified':
      return 'border-status-success/40 bg-success-subtle text-success';
    case 'ready_unverified':
      return 'border-status-info/40 bg-info-subtle text-info';
    case 'needs_attention':
      return 'border-status-warning/40 bg-warning-subtle text-warning';
    default:
      return 'border-status-error/40 bg-error-subtle text-error';
  }
}

function checkTone(status: string): string {
  switch (status) {
    case 'pass':
      return 'text-success';
    case 'warn':
    case 'pending':
      return 'text-warning';
    case 'info':
    case 'skipped':
      return 'text-secondary';
    default:
      return 'text-error';
  }
}

function CheckList({ checks = [] }: { checks?: any[] }) {
  if (!checks.length) return null;

  return (
    <ul className="space-y-3">
      {checks.map((check) => (
        <li key={check.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-primary">{check.label}</div>
              <div className="mt-1 text-sm text-secondary">{check.detail}</div>
              {check.subDetail ? (
                <div className="mt-2 text-xs text-secondary">{check.subDetail}</div>
              ) : null}
              {check.nextAction ? (
                <div className="mt-2 text-xs text-secondary">Next: {check.nextAction}</div>
              ) : null}
            </div>
            <div className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${checkTone(check.status)}`}>
              {check.status}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RecommendationList({ recommendations = [] }: { recommendations?: any[] }) {
  if (!recommendations.length) return null;

  return (
    <div className="space-y-4">
      {recommendations.map((step) => (
        <div key={step.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-primary">{step.title}</h3>
            <span className={`text-xs font-semibold uppercase tracking-wide ${checkTone(step.variant === 'error' ? 'fail' : step.variant === 'warn' ? 'warn' : 'info')}`}>
              {step.variant}
            </span>
          </div>
          <p className="mt-2 text-sm text-secondary">{step.summary}</p>
          {Array.isArray(step.details) && step.details.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-secondary">
              {step.details.map((detail: string) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
          {step.code ? (
            <pre
              className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-primary/80 p-3 text-xs text-secondary"
              tabIndex={0}
              aria-label={`${step.title} command`}
            >
              <code>{step.code}</code>
            </pre>
          ) : null}
          {step.note ? <p className="mt-2 text-xs text-tertiary">{step.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

export const dynamic = 'force-dynamic';

// /setup is public (pre-onboarding), and the canary performs real DB writes.
// The memo holds the IN-FLIGHT promise, not the resolved value, so a burst of
// concurrent anonymous GETs shares one canary run instead of each launching
// their own (write-amplification DoS). One run per minute per instance; the
// authenticated doctor API/CLI always run fresh.
const CANARY_TTL_MS = 60_000;
let canaryMemo: { at: number; promise: Promise<{ result: any; error: boolean }> } | null = null;

function runCanaryMemoized(): Promise<{ result: any; error: boolean }> {
  if (canaryMemo && Date.now() - canaryMemo.at < CANARY_TTL_MS) return canaryMemo.promise;
  const promise = runDoctor({ categories: ['write-canary'] }).then(
    (result: any) => ({ result, error: false }),
    (err: unknown) => {
      // Full error is server-side only; this page is unauthenticated.
      console.error('[Setup] write-path canary failed to run:', err);
      return { result: null, error: true };
    },
  );
  canaryMemo = { at: Date.now(), promise };
  return promise;
}

// v3.4: latest live-host canary verdict (reported by the hourly live-canary
// GitHub Actions cron via POST /api/live-canary). Read-only, and scoped to
// the operator's canary org (DASHCLAW_CANARY_ORG_ID, default org_default) —
// this page is public and check text is free-form, so it must never render
// another tenant's writes (2026-07-04 security review). A read error (no
// DATABASE_URL, table not yet migrated) is RENDERED as an explicit
// unavailable state, never swallowed.
async function readLiveCanary(): Promise<{ run: LiveCanaryRun | null; error: boolean }> {
  try {
    const sql = getSql();
    return { run: await getLatestLiveCanaryRunForOrg(sql, canaryDisplayOrgId()), error: false };
  } catch (err) {
    console.error('[Setup] live-host canary read failed:', err);
    return { run: null, error: true };
  }
}

// v4.72.1 taught us a decision ledger can stay healthy while enforcement is // version-hardcode-allowed
// silently dead (a hook-timeout misconfig cancelled the pretool hook; blocks
// failed open). This probe drives a synthetic held action through the real
// hook seam and records whether it actually executed. Same public-page org
// rule as the live canary: only the operator's own runs, never another
// tenant's on a shared host.
// `run` is the newest probe overall (its detail/checks are what the card
// expands). `perSeam` is the latest run for EACH seam, which is what the
// badge derives from — the newest run alone let a healthy Claude Code probe
// mask a dead Codex one (drizzle/0072).
async function readEnforcementLiveness(): Promise<{
  run: EnforcementLivenessRun | null;
  perSeam: EnforcementLivenessRun[];
  error: boolean;
}> {
  try {
    const sql = getSql();
    const orgId = canaryDisplayOrgId();
    const [run, perSeam] = await Promise.all([
      getLatestEnforcementLivenessRunForOrg(sql, orgId),
      listLatestEnforcementLivenessRunPerRuntime(sql, orgId),
    ]);
    return { run, perSeam, error: false };
  } catch (err) {
    console.error('[Setup] enforcement-liveness read failed:', err);
    return { run: null, perSeam: [], error: true };
  }
}

// v8.3 silent-lane witness: the prior question to enforcement-liveness's "did
// the block actually stop execution?" — "did governance see the activity at
// all?" Same public-page org rule as the canary/liveness reads above.
async function readSilentLaneWitness(): Promise<{ agents: AgentLaneWitnessAggregate[]; error: boolean }> {
  try {
    const sql = getSql();
    const windowMinutes = getWitnessWindowMinutes();
    const agents = await getAgentLaneWitness(sql, canaryDisplayOrgId(), windowMinutes);
    return { agents, error: false };
  } catch (err) {
    console.error('[Setup] silent-lane-witness read failed:', err);
    return { agents: [], error: true };
  }
}

function relativeAgo(iso: string | null | undefined): string {
  const ms = iso ? Date.now() - Date.parse(iso) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return 'an unknown time';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'moments';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export const metadata: Metadata = {
  title: 'Setup',
};

export default async function SetupPage() {
  // Dual-shell: a signed-in operator clicking "Setup" in the sidebar stays
  // inside the app shell like every other tab; anonymous visitors (pre-
  // onboarding, broken instance, hosted stranger) keep the standalone public
  // rendering with its own header — and all its disclosure guarantees.
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? '';
  const viewer = await getViewerContextFromCookieHeader(cookieHeader);
  const signedIn = viewer.isAuthenticated;

  // Demo sandbox visitors browse every other page inside the app shell (demo
  // pages are public), so /setup rendering standalone reads as "the sidebar
  // vanished". Mirror the middleware's demo rule: explicit demo deployments,
  // or the demo cookie on a marketing host. Self-host anonymous visitors keep
  // the standalone public shell and its disclosure guarantees.
  const host = requestHeaders.get('host') ?? '';
  const isMarketingHost = host === 'dashclaw.io' || host.endsWith('.dashclaw.io');
  const demoShell =
    process.env.DASHCLAW_MODE === 'demo' ||
    (isMarketingHost && /(?:^|;\s*)dashclaw_demo=1(?:;|$)/.test(cookieHeader));
  const inShell = signedIn || demoShell;

  // The canary runs alongside the readiness report: real writes under the
  // isolated canary org, so a dead write path fails HERE before an agent
  // ever hits it. An engine error is rendered, never swallowed.
  const [report, canary, liveCanary, enforcementLiveness, silentLaneWitness] = await Promise.all([
    getReadinessReport(process.env),
    runCanaryMemoized(),
    readLiveCanary(),
    readEnforcementLiveness(),
    readSilentLaneWitness(),
  ]);
  const view = projectReadinessReport(report, { isAuthenticated: true });
  const overall = view.verification;

  // v4.6 funnel truth: the trial activation funnel, hosted instances only.
  // Aggregate-only (no org identifiers — same disclosure norm as the rest of
  // this unauthenticated page); an error renders as an error line, never
  // silence.
  let trialFunnel: TrialFunnel | null = null;
  let trialFunnelError = false;
  if (isHostedMode()) {
    try {
      trialFunnel = await getTrialFunnel(getSql());
    } catch (err) {
      trialFunnelError = true;
      console.error('[setup] trial funnel query failed:', err);
    }
  }

  const canaryChecks = (canary.result?.checks || []).map((c: any) => ({
    id: c.id,
    label: c.title,
    // Raw DB error text stays off this unauthenticated page (schema
    // disclosure); the authenticated Doctor panel/CLI carry the full error.
    detail: c.status === 'fail'
      ? 'Write failed. The exact database error is on the Doctor panel and in server logs.'
      : c.message,
    status: c.status,
    nextAction: c.status === 'fail'
      ? 'Open the Doctor panel (/doctor) and apply the auto-fix, or run pending migrations.'
      : null,
  }));
  const canaryStatus = canary.error
    ? 'fail'
    : canaryChecks.length === 0
      ? 'skipped'
      : canaryChecks.some((c: any) => c.status === 'fail')
        ? 'fail'
        : canaryChecks.some((c: any) => c.status === 'warn')
          ? 'warn'
          : 'pass';

  // v3.4 live-host canary card state. Staleness shares LIVE_CANARY_STALE_MS
  // with the posture finding so the two surfaces can never disagree about
  // what "fresh" means. A canary that stopped reporting is itself a warn.
  const liveRun = liveCanary.run;
  const liveRunStale = liveRun
    ? // eslint-disable-next-line react-hooks/purity -- server component: staleness is evaluated per request, there is no client re-render for this to destabilize
      Date.now() - Date.parse(liveRun.finished_at) > LIVE_CANARY_STALE_MS
    : false;
  const liveStatus = liveCanary.error
    ? 'warn'
    : !liveRun
      ? 'skipped'
      : liveRun.status === 'fail'
        ? 'fail'
        : liveRunStale
          ? 'warn'
          : 'pass';
  const liveChecks = (liveRun?.checks ?? []).map((c) => ({
    id: c.id,
    label: c.title,
    detail: c.status === 'fail'
      ? (c.detail || 'Probe failed.') + (c.target ? ` (${c.target})` : '')
      : (c.target || c.detail || 'Answered as expected.'),
    status: c.status,
    nextAction: null,
  }));
  const liveReportedAt = liveRun
    ? new Date(liveRun.finished_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  // v8.2 enforcement-liveness card. State comes from the same derivation the
  // API route and posture finding use, so this card can never disagree with
  // them about what "holding" means. A read error is treated the same as
  // "stale" for the badge (we cannot prove enforcement held), but rendered
  // with its own message so it's never confused with an actually-stale probe.
  const livenessRun = enforcementLiveness.run;
  // The badge derives from EVERY seam, not the newest run: Claude Code and
  // Codex both report `source: session-start`, so the newest-row derivation
  // rendered 'holding' while a Codex seam sat dead (drizzle/0072). Worst seam
  // wins, and each one is named in the breakdown below.
  // eslint-disable-next-line react-hooks/purity -- server component: liveness is evaluated per request, same shared derivation the API route calls with Date.now()
  const livenessFleet = deriveFleetEnforcementLiveness(enforcementLiveness.perSeam, Date.now());
  const livenessState = livenessFleet.state;
  const livenessSeams = livenessFleet.seams;
  const livenessStatus = enforcementLiveness.error
    ? 'warn'
    : !livenessRun
      ? 'skipped'
      : livenessState === 'holding'
        ? 'pass'
        : livenessState === 'stale'
          ? 'warn'
          : 'fail';
  const livenessChecks = (livenessRun?.checks ?? []).map((c) => ({
    id: c.id,
    label: c.title,
    detail: c.detail || (c.status === 'pass' ? 'Held as expected.' : 'See detail above.'),
    status: c.status,
    nextAction: null,
  }));

  // v8.3 silent-lane witness card. One row per agent in 'governed' or
  // 'recorded-ungoverned' state over the trailing window — 'quiet' agents
  // (no claim either way) don't render, same as the spec's acceptance bar.
  // recorded-ungoverned sorts first: it's the state an operator needs to see.
  const witnessWindowMinutes = getWitnessWindowMinutes();
  const laneWitnessRows = silentLaneWitness.agents
    // eslint-disable-next-line react-hooks/purity -- server component: evaluated per request, same shared derivation the posture signal calls with Date.now()
    .map((a) => deriveSilentLaneWitnessState(a, witnessWindowMinutes, Date.now()))
    .filter((r) => r.state !== 'quiet')
    .sort((a, b) => (a.state === b.state ? a.agentId.localeCompare(b.agentId) : a.state === 'recorded-ungoverned' ? -1 : 1));

  // v3.6: enforcement posture. Values come from the guard's own getters, so
  // this card is the instance's live truth, not a copy of the docs.
  const enforcementRows = [
    { label: 'JWT replay protection', env: 'DASHCLAW_JTI_REPLAY_PROTECTION', value: getJtiReplayMode() as string },
    { label: 'Action binding', env: 'DASHCLAW_ACT_BINDING', value: getActBindingMode() as string },
    { label: 'Degraded-evaluation fallback', env: 'DASHCLAW_GUARD_FALLBACK', value: resolveDegradedAction() as string },
  ].map((row) => {
    const rank = ENFORCEMENT_RANK[row.env] ?? [];
    const weakened = rank.indexOf(row.value) < rank.indexOf(ENFORCEMENT_DEFAULTS[row.env] ?? '');
    return {
      ...row,
      weakened,
      meaning: weakened
        ? 'Set below the hardened default. The value is withheld on this public page; verify it on the authenticated Doctor panel (/doctor) or in your deployment env.'
        : ENFORCEMENT_MEANINGS[row.env]?.[row.value] ?? '',
    };
  });

  // v3.7: issuer trust is binary (configured/not), fail-closed either way
  // since the flip, so it bypasses the rank logic. The issuer URL itself is
  // never disclosed on this public page.
  const issuerConfigured = Boolean(process.env.DASHCLAW_ALLOWED_ISSUER);
  enforcementRows.push({
    label: 'Verified agent identity (JWKS)',
    env: 'DASHCLAW_ALLOWED_ISSUER',
    value: issuerConfigured ? 'configured' : 'not configured',
    weakened: false,
    meaning: issuerConfigured
      ? 'An issuer allow-list is configured; only its signed JWTs can reach verified status. The issuer URL is withheld on this public page.'
      : 'No issuer configured. Bearer tokens never reach verified status (fail-closed). Set this to your IdP to enable verified identity.',
  });

  const body = (
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Anonymous visitors get the standalone header: this page is the
            post-install landing surface (`dashclaw up` opens it) and renders
            pre-auth — it must still hand the operator a way INTO the
            instance, not dead-end them on a status report. Signed-in
            operators are inside the app shell, which already carries nav. */}
        {!inShell && (
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-90">
            <DashClawLogo size={20} />
            <span className="text-lg font-semibold text-primary">DashClaw</span>
          </Link>
          <nav aria-label="Instance" className="flex flex-wrap items-center gap-5 text-sm text-secondary">
            <Link href="/approvals" className="transition-colors hover:text-primary">Approvals</Link>
            <Link href="/decisions" className="transition-colors hover:text-primary">Decisions</Link>
            <Link href="/connect" className="transition-colors hover:text-primary">Connect</Link>
            <Link href="/settings" className="transition-colors hover:text-primary">Settings</Link>
            <Link href="/docs" className="transition-colors hover:text-primary">Docs</Link>
          </nav>
        </header>
        )}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {!inShell && (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-secondary">
              Setup
            </span>
            )}
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone(overall.overall)}`}>
              {overall.label}
            </span>
          </div>
          <div className="space-y-2">
            {/* In-shell, the PageLayout header already carries the title and
                summary — repeating them here would double the heading. */}
            {!inShell && (
              <>
                <h1 className="text-4xl font-semibold text-primary">Deployment truth surface</h1>
                <p className="max-w-3xl text-base text-secondary">{overall.summary}</p>
              </>
            )}
            <p className="text-sm text-tertiary">Checked at {new Date(view.checkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/approvals"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-surface-primary transition-colors hover:bg-brand-hover"
            >
              Open Approvals
            </Link>
            <Link
              href="/connect"
              className="rounded-lg border border-border-hover bg-surface-tertiary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
            >
              Connect an agent
            </Link>
            <Link
              href="/policies/packs"
              className="rounded-lg border border-border-hover bg-surface-tertiary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
            >
              Browse policy packs
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-secondary">Readiness</div>
            <div className="mt-2 text-2xl font-semibold text-primary">{overall.readiness}</div>
            <p className="mt-2 text-sm text-secondary">Overall state projected from database, config, auth, deploy, and SDK checks.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-secondary">Live verification</div>
            <div className="mt-2 text-2xl font-semibold text-primary">{overall.fullyVerified ? 'Attached' : 'Pending'}</div>
            <p className="mt-2 text-sm text-secondary">A setup page can be healthy without live proof. Proof becomes attached after a successful validation flow.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-secondary">Proof artifact</div>
            <div className="mt-2 text-2xl font-semibold text-primary">Ready</div>
            <p className="mt-2 text-sm text-secondary">Use <code>/api/setup/status</code> for machine checks and this page for operator truth.</p>
          </div>
        </section>

        <section className="grid min-w-0 gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="min-w-0 space-y-6">
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-primary">Write-path health</h2>
                  <p className="mt-1 text-sm text-secondary">
                    Live canary writes just exercised the heartbeat, action-ledger, and guard-audit
                    write paths against this database. A dead write path fails here before an agent hits it.
                  </p>
                </div>
                <span className={`text-xs font-semibold uppercase tracking-wide ${checkTone(canaryStatus)}`}>
                  {canaryStatus}
                </span>
              </div>
              <p className="mt-3 text-xs text-tertiary">
                Checked: real INSERTs under the isolated canary org, verified and deleted. Nothing synthetic
                reaches your ledger, posture, or rate-limit windows.
              </p>
              <div className="mt-4">
                {canary.error ? (
                  <p className="rounded-xl border border-status-error/40 bg-error-subtle p-3 text-sm text-error">
                    Canary could not run. The full error is logged server-side and on the
                    authenticated Doctor panel (/doctor).
                  </p>
                ) : canaryChecks.length === 0 ? (
                  <p className="text-sm text-secondary">
                    Skipped: no database configured yet. The canary runs once DATABASE_URL is set.
                  </p>
                ) : (
                  <CheckList checks={canaryChecks} />
                )}
              </div>
            </article>
            <article id="live-canary" className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-primary">Live host canary</h2>
                  <p className="mt-1 text-sm text-secondary">
                    A scheduled canary probes the production hosts as a real client: marketing,
                    docs, demo entry, trial mint, OAuth discovery, and the hosted MCP handshake,
                    and files its verdict here.
                  </p>
                </div>
                <span className={`text-xs font-semibold uppercase tracking-wide ${checkTone(liveStatus)}`}>
                  {liveStatus}
                </span>
              </div>
              <p className="mt-3 text-xs text-tertiary">
                Checked: unauthenticated requests against the public hosts, asserting each surface&rsquo;s
                expected contract. The canary&rsquo;s traffic never touches the action or guard ledgers.
              </p>
              <div className="mt-4">
                {liveCanary.error ? (
                  <p className="rounded-xl border border-status-warning/40 bg-warning-subtle p-3 text-sm text-warning">
                    Canary reports could not be read (database unreachable or not yet migrated).
                    The full error is logged server-side.
                  </p>
                ) : !liveRun ? (
                  <p className="text-sm text-secondary">
                    No canary reports yet. The <code>live-canary</code> GitHub Actions workflow probes
                    the hosts hourly and reports to <code>/api/live-canary</code> once its secrets are set.
                  </p>
                ) : (
                  <>
                    {liveRunStale ? (
                      <p className="mb-3 rounded-xl border border-status-warning/40 bg-warning-subtle p-3 text-sm text-warning">
                        The canary has not reported since {liveReportedAt}. Treat the verdicts below as
                        historical until the next run lands; a silent canary is itself a finding.
                      </p>
                    ) : (
                      <p className="mb-3 text-xs text-tertiary">Last reported {liveReportedAt}.</p>
                    )}
                    <CheckList checks={liveChecks} />
                  </>
                )}
              </div>
            </article>
            <article id="enforcement-liveness" className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-primary">Enforcement liveness</h2>
                  <p className="mt-1 text-sm text-secondary">
                    A synthetic held action is driven through the real pretool hook seam, and this
                    checks that it did not execute. A healthy decision ledger can still hide a dead
                    hook (v4.72.1); this is the probe that catches that.{/* version-hardcode-allowed */}
                  </p>
                </div>
                <span className={`text-xs font-semibold uppercase tracking-wide ${checkTone(livenessStatus)}`}>
                  {livenessStatus}
                </span>
              </div>
              <p className="mt-3 text-xs text-tertiary">
                Checked: a synthetic action recorded as held, replayed through the same hook path a
                live agent uses, then verified as not-executed. Never reaches your action or guard ledgers.
              </p>
              <div className="mt-4">
                {enforcementLiveness.error ? (
                  <p className="rounded-xl border border-status-warning/40 bg-warning-subtle p-3 text-sm text-warning">
                    Enforcement-liveness reports could not be read (database unreachable or not yet migrated).
                    The full error is logged server-side.
                  </p>
                ) : !livenessRun ? (
                  <div className="text-sm text-secondary">
                    <p>
                      No probe run yet — it runs automatically at the start of your next Claude Code
                      session once <code>dashclaw install claude</code> has wired it (older installs
                      need a one-time re-run of that command).
                    </p>
                    <p className="mt-2 text-xs text-tertiary">
                      Or run it manually now: <code>npm run liveness:probe</code>
                    </p>
                  </div>
                ) : (
                  <>
                    {livenessState === 'stale' ? (
                      <p className="mb-3 rounded-xl border border-status-warning/40 bg-warning-subtle p-3 text-sm text-warning">
                        No probe run in the last 24h: a silent probe is the v4.72.1 failure shape.{/* version-hardcode-allowed */}
                        Run: <code>npm run liveness:probe</code>
                      </p>
                    ) : livenessState === 'broken' ? (
                      <p className="mb-3 rounded-xl border border-status-error/40 bg-error-subtle p-3 text-sm text-error">
                        {livenessRun.detail || 'The probe action executed or its outcome could not be proven.'}
                        {' '}Check the pretool hook&rsquo;s timeout and config (see the hook fields below) and rerun the probe.
                      </p>
                    ) : (
                      <p className="mb-3 text-xs text-tertiary">
                        Enforcement held the probe action {relativeAgo(livenessRun.finished_at)} ago.
                      </p>
                    )}
                    {/* Per-seam breakdown (drizzle/0072). The badge above is the
                        WORST seam; this names which one, so a dead Codex seam can
                        never hide behind a healthy Claude Code run. */}
                    {livenessSeams.length > 0 ? (
                      <div className="mb-3">
                        <div className="mb-1.5 text-xs font-medium text-secondary">
                          Seams reporting ({livenessSeams.length})
                        </div>
                        <ul className="grid gap-1.5">
                          {livenessSeams.map((seam) => (
                            <li
                              key={seam.runtime}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-primary/40 px-3 py-2 text-xs"
                            >
                              <code className="text-primary">{seam.runtime}</code>
                              <span className="text-tertiary">
                                {seam.finishedAt ? `last held ${relativeAgo(seam.finishedAt)} ago` : 'never reported'}
                              </span>
                              <span
                                className={`font-semibold uppercase tracking-wide ${
                                  checkTone(seam.state === 'holding' ? 'pass' : seam.state === 'stale' ? 'warn' : 'fail')
                                }`}
                              >
                                {seam.state}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="mb-3 grid gap-2 text-xs text-secondary sm:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-primary/40 p-3">
                        <div className="text-tertiary">Verdict</div>
                        <code className="text-primary">{livenessRun.verdict}</code>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-primary/40 p-3">
                        <div className="text-tertiary">Decision</div>
                        <code className="text-primary">{livenessRun.decision ?? 'none'}</code>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-primary/40 p-3">
                        <div className="text-tertiary">Witness</div>
                        <code className="text-primary">
                          {livenessRun.witness.executed ? 'executed' : 'not executed'} ({livenessRun.witness.path})
                        </code>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-primary/40 p-3">
                        <div className="text-tertiary">Hook</div>
                        <code className="text-primary">
                          {livenessRun.hook.installed ? (livenessRun.hook.mode || 'installed') : 'not installed'}
                          {livenessRun.hook.overflowed ? ' · timeout overflowed' : ''}
                          {livenessRun.hook.cancelled ? ' · cancelled' : ''}
                        </code>
                      </div>
                    </div>
                    <CheckList checks={livenessChecks} />
                  </>
                )}
              </div>
            </article>
            <article id="silent-lane-witness" className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-primary">Silent-lane witness</h2>
                  <p className="mt-1 text-sm text-secondary">
                    Agents that self-report activity (the Codex notify bridge, for now) with no guard
                    evaluation or hook-attributed row arriving from them in the trailing {witnessWindowMinutes}{' '}
                    minutes. Recorded but ungoverned is a standing posture, not an alarm — it clears the
                    moment a witness row lands.
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-tertiary">
                Checked: self-reported action rows against guard_decisions and hook-attributed rows for the
                same agent. Informational only — never changes an action&rsquo;s risk score, never blocks.
              </p>
              <div className="mt-4">
                {silentLaneWitness.error ? (
                  <p className="rounded-xl border border-status-warning/40 bg-warning-subtle p-3 text-sm text-warning">
                    Silent-lane witness reports could not be read (database unreachable or not yet migrated).
                    The full error is logged server-side.
                  </p>
                ) : laneWitnessRows.length === 0 ? (
                  <p className="text-sm text-secondary">
                    No agent activity or governance witness in the trailing {witnessWindowMinutes} minutes.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {laneWitnessRows.map((row) => (
                      <div key={row.agentId} className="rounded-xl border border-white/10 bg-primary/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <code className="text-sm font-medium text-primary">{row.agentId}</code>
                          <span
                            className={`text-xs font-semibold uppercase tracking-wide ${
                              row.state === 'governed' ? 'text-success' : 'text-warning'
                            }`}
                          >
                            {row.state === 'governed' ? 'governed' : 'recorded, ungoverned'}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-secondary">
                          Last activity: {row.lastActivitySource ?? 'none'}
                          {row.lastActivityAt ? ` (${relativeAgo(row.lastActivityAt)} ago)` : ''}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          Last witness: {row.lastWitnessAt ? `${relativeAgo(row.lastWitnessAt)} ago` : 'none in this window'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
            <article id="enforcement-posture" className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-primary">Enforcement posture</h2>
                  <p className="mt-1 text-sm text-secondary">
                    A block decision is never downgraded, on any surface. Hooks and server-executed
                    capabilities halt the action itself; SDK, MCP, and chat callers honor the decision.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {enforcementRows.map((row) => (
                  <div key={row.env} className="rounded-xl border border-white/10 bg-primary/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-primary">{row.label}</div>
                      {row.weakened ? (
                        <span className="text-xs font-semibold uppercase tracking-wide text-warning">review recommended</span>
                      ) : (
                        <code className="text-xs text-secondary">{row.value}</code>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-secondary">{row.meaning}</p>
                    <p className="mt-1 text-xs text-tertiary">
                      <code>{row.env}</code>: change it in your deployment env and redeploy.
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-tertiary">
                The per-surface enforced-vs-cooperative table lives in{' '}
                <a href="/docs#agent-identity" className="text-secondary underline underline-offset-2 hover:text-primary">
                  the docs
                </a>{' '}
                and <code>docs/architecture/enforcement-boundary.md</code>.
              </p>
            </article>
            {isHostedMode() ? (
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-primary">Trial activation funnel</h2>
                    <p className="mt-1 text-sm text-secondary">
                      Mint → first key used → first governed action → retained week 1, computed from
                      this instance&apos;s ledgers. Expired trials keep counting through deletion-time
                      snapshots{trialFunnel ? ` (${trialFunnel.source.archived} archived)` : ''}.
                    </p>
                  </div>
                  {trialFunnel?.source.truthfulSince ? (
                    <span className="text-xs text-tertiary">
                      evidence since {trialFunnel.source.truthfulSince.slice(0, 10)}
                    </span>
                  ) : null}
                </div>
                {trialFunnelError ? (
                  <p className="mt-4 text-sm text-error">
                    Funnel query failed. The exact database error is in server logs.
                  </p>
                ) : trialFunnel ? (
                  <>
                    <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                      {[
                        { label: 'Minted', value: trialFunnel.funnel.minted, of: null as number | null },
                        { label: 'First key used', value: trialFunnel.funnel.keyUsed, of: trialFunnel.funnel.minted },
                        { label: 'First governed action', value: trialFunnel.funnel.firstAction, of: trialFunnel.funnel.minted },
                        { label: 'Retained week 1', value: trialFunnel.funnel.retainedWeek1, of: trialFunnel.funnel.week1Eligible },
                      ].map((step) => (
                        <div key={step.label} className="rounded-xl border border-white/10 bg-primary/40 p-3">
                          <dt className="text-xs uppercase tracking-wide text-secondary">{step.label}</dt>
                          <dd className="mt-1 text-2xl font-semibold text-primary">{step.value}</dd>
                          <dd className="text-xs text-tertiary">
                            {step.of === null ? ' ' : step.of > 0 ? `${Math.round((step.value / step.of) * 100)}% of ${step.of}` : 'no eligible workspaces yet'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 space-y-1 text-xs text-tertiary">
                      {trialFunnel.funnel.week1Pending > 0 ? (
                        <p>
                          {trialFunnel.funnel.week1Pending} workspace{trialFunnel.funnel.week1Pending === 1 ? '' : 's'} minted
                          less than 7 days ago, too young to judge retention.
                        </p>
                      ) : null}
                      {trialFunnel.medianHoursToFirstAction !== null ? (
                        <p>Median time to first governed action: {trialFunnel.medianHoursToFirstAction}h.</p>
                      ) : null}
                      {/* v5.3 sharpened distinctions — annotations, not steps. */}
                      <p>
                        {trialFunnel.annotations.returned} returned after the mint sitting (seen again
                        &gt;1h after mint); {trialFunnel.annotations.returnedNeverConnected} of those never
                        used the key or acted. Visits are stamped only since this instance began stamping
                        them; older mints read as never returned.
                      </p>
                      {trialFunnel.annotations.medianHoursToFirstKeyUse !== null ? (
                        <p>Median time to first key use: {trialFunnel.annotations.medianHoursToFirstKeyUse}h.</p>
                      ) : null}
                      {trialFunnel.funnel.firstAction > 0 ? (
                        <p>
                          First governed actions: {trialFunnel.annotations.firstActionVia.browser} in the
                          browser, {trialFunnel.annotations.firstActionVia.agent} via an agent
                          {trialFunnel.annotations.firstActionVia.browser + trialFunnel.annotations.firstActionVia.agent < trialFunnel.funnel.firstAction
                            ? ', the rest predate door tracking'
                            : ''}.
                        </p>
                      ) : null}
                      {/* v7.2 graduation — an annotation, not a step. */}
                      <p>
                        {trialFunnel.annotations.graduated} graduated (exported the workspace record to
                        take it to an owned instance). Exports are stamped only since this instance began
                        stamping them; older workspaces read as never exported.
                      </p>
                    </div>
                    {trialFunnel.cohorts.length > 0 ? (
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-secondary">
                              <th className="py-1 pr-3 font-medium">Mint week</th>
                              <th className="py-1 pr-3 font-medium">Minted</th>
                              <th className="py-1 pr-3 font-medium">Key used</th>
                              <th className="py-1 pr-3 font-medium">First action</th>
                              <th className="py-1 pr-3 font-medium">Retained wk1</th>
                            </tr>
                          </thead>
                          <tbody className="text-primary">
                            {trialFunnel.cohorts.map((c) => (
                              <tr key={c.weekStart} className="border-t border-white/10">
                                <td className="py-1 pr-3">{c.weekStart}</td>
                                <td className="py-1 pr-3">{c.minted}</td>
                                <td className="py-1 pr-3">{c.keyUsed}</td>
                                <td className="py-1 pr-3">{c.firstAction}</td>
                                <td className="py-1 pr-3">{c.week1Eligible > 0 ? `${c.retainedWeek1}/${c.week1Eligible}` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {/* v6.4 reach attribution — per-channel mints. Owed since
                        the reach-attribution ship, which claimed this render;
                        it never landed (recorded in the maintainer log at v7.2). */}
                    {trialFunnel.annotations.bySource.length > 0 ? (
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-secondary">
                              <th className="py-1 pr-3 font-medium">Mint source</th>
                              <th className="py-1 pr-3 font-medium">Minted</th>
                              <th className="py-1 pr-3 font-medium">First action</th>
                            </tr>
                          </thead>
                          <tbody className="text-primary">
                            {trialFunnel.annotations.bySource.map((s) => (
                              <tr key={s.source} className="border-t border-white/10">
                                <td className="py-1 pr-3">{s.source}</td>
                                <td className="py-1 pr-3">{s.minted}</td>
                                <td className="py-1 pr-3">{s.firstAction}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </article>
            ) : null}
            {view.sections.map((section: any) => (
              <article key={section.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-primary">{section.title}</h2>
                    <p className="mt-1 text-sm text-secondary">{section.summary}</p>
                  </div>
                  <span className={`text-xs font-semibold uppercase tracking-wide ${checkTone(section.status)}`}>
                    {section.status}
                  </span>
                </div>
                {section.whatWasChecked ? (
                  <p className="mt-3 text-xs text-tertiary">Checked: {section.whatWasChecked}</p>
                ) : null}
                <div className="mt-4">
                  <CheckList checks={section.checks} />
                </div>
              </article>
            ))}
          </div>

          <div className="min-w-0 space-y-6" aria-label="Setup workflow and recommendations">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold text-primary">Workflow</h2>
              <div className="mt-4 space-y-3">
                {view.workflow.map((step: any) => (
                  <div key={step.id} className="rounded-xl border border-white/10 bg-primary/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-primary">{step.title}</div>
                      <div className={`text-xs font-semibold uppercase tracking-wide ${checkTone(step.status)}`}>{step.status}</div>
                    </div>
                    <p className="mt-2 text-sm text-secondary">{step.summary}</p>
                    {step.nextAction ? <p className="mt-2 text-xs text-tertiary">Next: {step.nextAction}</p> : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold text-primary">Recommended next steps</h2>
              <div className="mt-4">
                <RecommendationList recommendations={view.recommendations} />
              </div>
            </section>
          </div>
        </section>

        {/* Auditor surface for POST /api/integrity/verify: public + stateless,
            so it sits on the instance-truth page rather than behind a record. */}
        <section id="verify-receipt" className="mt-6">
          <VerifyReceiptPanel />
        </section>
      </div>
  );

  if (inShell) {
    return (
      <PageLayout
        agentFilter={false}
        title="Deployment truth surface"
        subtitle={overall.summary}
        breadcrumbs={['Configure', 'Setup']}
      >
        {body}
      </PageLayout>
    );
  }

  return (
    <main className="min-h-screen bg-primary px-6 py-10 text-primary">
      {body}
    </main>
  );
}

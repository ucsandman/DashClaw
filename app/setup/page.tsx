import { projectReadinessReport, getReadinessReport } from '../lib/readiness.mjs';
import { runDoctor } from '../lib/doctor/engine.mjs';
import { getSql } from '../lib/db';
import {
  getLatestLiveCanaryRunForOrg,
  canaryDisplayOrgId,
  type LiveCanaryRun,
} from '../lib/repositories/live-canary.repository';
import { LIVE_CANARY_STALE_MS } from '../lib/posture/findings';

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

export default async function SetupPage() {
  // The canary runs alongside the readiness report: real writes under the
  // isolated canary org, so a dead write path fails HERE before an agent
  // ever hits it. An engine error is rendered, never swallowed.
  const [report, canary, liveCanary] = await Promise.all([
    getReadinessReport(process.env),
    runCanaryMemoized(),
    readLiveCanary(),
  ]);
  const view = projectReadinessReport(report, { isAuthenticated: true });
  const overall = view.verification;

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
    ? Date.now() - Date.parse(liveRun.finished_at) > LIVE_CANARY_STALE_MS
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

  return (
    <main className="min-h-screen bg-primary px-6 py-10 text-primary">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-secondary">
              Setup
            </span>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone(overall.overall)}`}>
              {overall.label}
            </span>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold text-primary">Deployment truth surface</h1>
            <p className="max-w-3xl text-base text-secondary">{overall.summary}</p>
            <p className="text-sm text-tertiary">Checked at {new Date(view.checkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
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
                    Skipped — no database configured yet. The canary runs once DATABASE_URL is set.
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
                    A scheduled canary probes the production hosts as a real client — marketing,
                    docs, demo entry, trial mint, OAuth discovery, and the hosted MCP handshake —
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
                        historical until the next run lands — a silent canary is itself a finding.
                      </p>
                    ) : (
                      <p className="mb-3 text-xs text-tertiary">Last reported {liveReportedAt}.</p>
                    )}
                    <CheckList checks={liveChecks} />
                  </>
                )}
              </div>
            </article>
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
      </div>
    </main>
  );
}

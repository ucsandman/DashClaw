import Link from 'next/link';
import { headers } from 'next/headers';
import { getSql } from '../lib/db';
import { getReadinessReport, projectConnectNextStep, projectReadinessReport } from '../lib/readiness.mjs';
import { readLiveVerificationProofToken } from '../lib/liveVerificationProof.mjs';
import { getViewerContextFromCookieHeader } from '../lib/sessionViewer.mjs';
import { createFallbackOnboardingStatus, getOnboardingStatusForUserId, getViewerUserId } from '../lib/onboardingState.mjs';

import { ModeBadge } from './components/Common';
import { TopSummary } from './components/TopSummary';
import { ConnectNextStepPanel } from './components/ConnectNextStepPanel';
import { WorkflowPanel } from './components/WorkflowPanel';
import { VerificationSection } from './components/VerificationSection';
import { RecommendedSteps } from './components/RecommendedSteps';
import { ProofPanel } from './components/ProofPanel';
import { ApiKeyReveal } from './components/ApiKeyReveal';
import ModelPricingPanel from './components/ModelPricingPanel';
import GovernancePanel from './components/GovernancePanel';
import AgentIdentityPanel from './components/AgentIdentityPanel';
import CopyableValueRow from './components/CopyableValueRow';
import PageLayout from '../components/PageLayout';
import { LogIn } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings - DashClaw',
};

function getMaskedApiKey(env: any) {
  const key = env.DASHCLAW_API_KEY;
  if (!key) return '';
  return key.slice(0, 8) + '••••••••';
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<any> }) {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost';
  const cookieHeader = headerStore.get('cookie') || '';
  const resolvedSearchParams = await searchParams;
  const tab = resolvedSearchParams?.tab || 'setup';
  const liveProofToken = typeof resolvedSearchParams?.proof === 'string' ? resolvedSearchParams.proof : '';

  const viewer = await getViewerContextFromCookieHeader(cookieHeader, process.env);
  const liveProof = await readLiveVerificationProofToken(liveProofToken, process.env);
  const report = await getReadinessReport(process.env, { host, liveProof });
  const view = projectReadinessReport(report, {
    isAuthenticated: viewer.isAuthenticated,
    host,
  });
  let onboarding: any = null;
  if (viewer.isAuthenticated) {
    try {
      onboarding = await getOnboardingStatusForUserId(getViewerUserId(viewer), {
        sql: getSql(),
        env: process.env,
      } as any);
    } catch {
      onboarding = createFallbackOnboardingStatus();
    }
  }
  const connectNextStep = projectConnectNextStep({
    isAuthenticated: viewer.isAuthenticated,
    verification: view.verification,
    onboarding,
    host,
    sdk: view.sdk,
  });
  const proofDownloadHref = liveProofToken
    ? `/api/setup/proof?proof=${encodeURIComponent(liveProofToken)}&download=1`
    : '/api/setup/proof?download=1';

  // Workspace identity for the Environment panel. Middleware injects
  // x-org-id / x-user-id on /api/* routes only, so page routes have to
  // read these from the auth session directly. The fallback for the
  // local-admin user id matches the rule middleware applies when it
  // mints the header value (see middleware.js: orgId / userId resolve).
  const workspaceOrgId: string = viewer.isAuthenticated
    ? ((viewer.session as any)?.orgId || 'org_default')
    : '';
  const workspaceUserId: string = viewer.isAuthenticated
    ? ((viewer.session as any)?.userId
        || ((viewer.session as any)?.sub === 'local-admin' ? 'usr_local_admin' : ''))
    : '';

  const maskedApiKey = getMaskedApiKey(process.env);
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  const fullHost = `${protocol}://${host}`;

  const tabs = [
    { key: 'setup', label: 'Setup & Verify', href: '/settings' },
    { key: 'governance', label: 'Governance', href: '/settings?tab=governance' },
    { key: 'pricing', label: 'Model Pricing', href: '/settings?tab=pricing' },
    { key: 'identity', label: 'Agent Identity', href: '/settings?tab=identity' },
  ];

  const quickLinks = [
    { href: '/integrations', label: 'Integrations', hint: 'Configure services' },
    { href: '/webhooks', label: 'Webhooks', hint: 'Event notifications' },
    { href: '/api-keys', label: 'API keys', hint: 'Manage keys' },
    { href: '/docs', label: 'API documentation', hint: 'Reference' },
    { href: '/self-host', label: 'Deployment guide', hint: 'Self-host docs' },
  ];

  return (
    <PageLayout agentFilter={false}
      title="Settings"
      subtitle="Instance configuration, verification, model pricing, and agent identity"
      breadcrumbs={['System', 'Settings']}
      maturity="stable"
      actions={
        <div className="flex items-center gap-2">
          {!viewer.isAuthenticated && (
            <Link
              href="/login"
              className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
            >
              <LogIn size={14} aria-hidden="true" />
              Sign in
            </Link>
          )}
          <ModeBadge isAuthenticated={viewer.isAuthenticated} />
        </div>
      }
    >
      {/* Tab bar */}
      <div role="tablist" className="mb-6 flex items-center gap-1 border-b border-border">
        {tabs.map((t) => {
          const isActive = tab === t.key;
          return (
            <a
              key={t.key}
              href={t.href}
              role="tab"
              aria-selected={isActive}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'text-white' : 'text-tertiary hover:text-secondary'
              }`}
            >
              {t.label}
              {isActive && (
                <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />
              )}
            </a>
          );
        })}
      </div>

      {/* Setup & Verify tab */}
      {tab === 'setup' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Left Column: Connection & Verification */}
          <div className="space-y-6 lg:col-span-2">
            {/* Host */}
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] tabular-nums text-tertiary">
                Host: <span className="text-secondary">{host}</span>
              </div>
            </div>

            <TopSummary view={view} proofDownloadHref={proofDownloadHref} />

            <ConnectNextStepPanel
              maskedApiKey={maskedApiKey}
              host={fullHost}
              isAuthenticated={viewer.isAuthenticated}
              overallState={view.verification.overall}
            />

            {view.notice ? (
              <div className="rounded-xl border border-border bg-surface-secondary px-5 py-4">
                <p className="text-sm text-secondary">{view.notice}</p>
              </div>
            ) : null}
            {liveProofToken && !liveProof ? (
              <div role="alert" className="rounded-xl border border-error/30 bg-error-subtle px-5 py-4">
                <p className="text-sm text-error">
                  The supplied live validation proof token could not be verified. Run the validator again and use the latest setup URL it returns.
                </p>
              </div>
            ) : null}

            {/* Verification sections */}
            <div className="space-y-4">
              {view.sections.map((section: any) => (
                <VerificationSection key={section.id} section={section} />
              ))}
              <RecommendedSteps recommendations={view.recommendations} />
            </div>

            <WorkflowPanel workflow={view.workflow} />
          </div>

          {/* Right Column: Quick Access */}
          <div className="space-y-6">
            {/* Quick Links */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Quick links
              </div>
              <div className="space-y-2">
                {quickLinks.map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex items-center justify-between rounded-lg border border-border bg-surface-tertiary p-3 transition-colors hover:border-border-hover"
                  >
                    <span className="text-sm text-secondary group-hover:text-white">{link.label}</span>
                    <span className="text-xs text-tertiary">{link.hint}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Instance Info */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Instance
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Version</span>
                  <span className="font-mono text-xs tabular-nums text-white">{process.env.NEXT_PUBLIC_DASHCLAW_VERSION || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Mode</span>
                  <span className={`text-xs font-medium ${view.verification?.overall === 'green' ? 'text-success' : 'text-warning'}`}>
                    {process.env.DASHCLAW_MODE === 'demo' ? 'Demo' : 'Self-hosted'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Database</span>
                  <span className={`text-xs font-medium ${view.sections?.find((s: any) => s.id === 'database')?.status === 'green' ? 'text-success' : 'text-error'}`}>
                    {view.sections?.find((s: any) => s.id === 'database')?.status === 'green' ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-tertiary">Auth</span>
                  <span className={`text-xs font-medium ${viewer.isAuthenticated ? 'text-success' : 'text-secondary'}`}>
                    {viewer.isAuthenticated ? 'Configured' : 'Not configured'}
                  </span>
                </div>
              </div>
            </div>

            {/* Environment */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Environment
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-tertiary">Host</div>
                  <div className="break-all rounded border border-border bg-surface-tertiary p-2 font-mono text-xs text-secondary">
                    {host}
                  </div>
                </div>
                <CopyableValueRow
                  label="Org ID"
                  value={workspaceOrgId}
                  fallback={viewer.isAuthenticated ? '(no org id on session)' : '(sign in to see your org id)'}
                />
                <CopyableValueRow
                  label="Your user ID"
                  value={workspaceUserId}
                  fallback={viewer.isAuthenticated ? '(no user id on session)' : '(sign in to see your user id)'}
                />
                <ApiKeyReveal maskedApiKey={maskedApiKey} />
                <div>
                  <div className="mb-1 text-[11px] font-medium text-tertiary">Runtime</div>
                  <div className="rounded border border-border bg-surface-tertiary p-2 font-mono text-xs text-secondary">
                    Node {typeof process !== 'undefined' ? process.version : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Proof Panel */}
            <ProofPanel view={view} proofDownloadHref={proofDownloadHref} />

            {/* Auth Status */}
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Session
              </div>
              {viewer.isAuthenticated ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-success" />
                    <span className="text-sm text-success">Authenticated</span>
                  </div>
                  <Link
                    href="/approvals"
                    className="block rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-center text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
                  >
                    Go to Approvals
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-border" />
                    <span className="text-sm text-secondary">Not signed in</span>
                  </div>
                  <Link
                    href="/login"
                    className="block rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-center text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
                  >
                    Sign in
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Governance tab */}
      {tab === 'governance' && (
        <GovernancePanel />
      )}

      {/* Model Pricing tab */}
      {tab === 'pricing' && (
        <ModelPricingPanel />
      )}

      {tab === 'identity' && (
        <AgentIdentityPanel highlightPairingId={resolvedSearchParams?.pairing || null} />
      )}
    </PageLayout>
  );
}

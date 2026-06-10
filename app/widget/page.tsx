'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  AlertTriangle,
  AlertCircle,
  AppWindow,
  Pin,
  PinOff,
  Settings2,
} from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import { PosturePill, type PosturePillStatus } from './components/PosturePill';
import { WidgetMetrics } from './components/WidgetMetrics';
import { WidgetApprovals } from './components/WidgetApprovals';
import { WidgetLog } from './components/WidgetLog';
import { WidgetFooter } from './components/WidgetFooter';
import { WidgetSettings } from './components/WidgetSettings';
import { useWidgetSummary } from './useWidgetSummary';
import { useDocumentPiP } from './useDocumentPiP';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { isDemoMode } from '../lib/isDemoMode';
import {
  applyQueryOverrides,
  defaultWidgetPrefs,
  loadWidgetPrefs,
  saveWidgetPrefs,
  type WidgetPrefs,
} from '../lib/widgetPrefs';

const EMPTY_METRICS = { activeAgents: 0, pendingApprovals: 0, signals: 0, spend: null };

const ICON_BUTTON =
  'inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-tertiary transition-colors hover:border-border-hover hover:text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

function WidgetPageInner() {
  const { data, loading, error, connection, lastUpdated } = useWidgetSummary();
  const { isAdmin } = useEffectiveRole();
  const canDecide = isAdmin && !isDemoMode();
  const searchParams = useSearchParams();
  const pip = useDocumentPiP();

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True when this page is itself the popped-out floating window (opened via
  // window.open) — we hide the pop-out button there to avoid spawning more.
  const [isPopout, setIsPopout] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState<WidgetPrefs>(defaultWidgetPrefs);

  // Register the shared service worker so /widget is installable as a PWA.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useEffect(() => {
    setIsPopout(typeof window !== 'undefined' && window.opener != null);
  }, []);

  // Stored prefs hydrate after mount (SSR-safe); saving is fire-and-forget.
  useEffect(() => {
    setPrefs(loadWidgetPrefs());
  }, []);

  const handlePrefsChange = useCallback((next: WidgetPrefs) => {
    setPrefs(next);
    saveWidgetPrefs(next);
  }, []);

  // Read-only URL overrides (?hide=topSignal,spend / ?show=...) win over
  // stored prefs — lets chrome --app launchers pin a configuration.
  const hideParam = searchParams.get('hide');
  const showParam = searchParams.get('show');
  const overridesActive = Boolean(hideParam || showParam);
  const effective = useMemo(
    () => applyQueryOverrides(prefs, { hide: hideParam, show: showParam }),
    [prefs, hideParam, showParam],
  );

  // Pop the widget out into a small floating window. Reuses the named window, so
  // clicking again focuses the existing float instead of spawning duplicates.
  // (For true always-on-top use the Pin button — Document Picture-in-Picture,
  // Chromium 116+. This plain popup is the cross-browser fallback; pin it with
  // an OS tool like PowerToys Win+Ctrl+T on other browsers.)
  const popOut = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.open('/widget', 'dashclaw-widget', 'popup,width=380,height=720');
  }, []);

  const pinOnTop = useCallback(() => {
    pip.open({ width: 380, height: 720 }).catch(() => {
      // user gesture expired or the browser refused — the popup path remains.
    });
  }, [pip]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const handleDecision = useCallback(
    async (actionId: string, decision: 'allow' | 'deny') => {
      setProcessingId(actionId);
      try {
        const res = await fetch(`/api/approvals/${actionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        });
        if (!res.ok) {
          let msg = 'Decision failed';
          try {
            const b = await res.json();
            if (b?.error) msg = b.error;
          } catch {
            /* non-JSON */
          }
          throw new Error(msg);
        }
        // Optimistic: hide it now; the poll/realtime refetch reconciles.
        setDecidedIds((prev) => new Set(prev).add(actionId));
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Decision failed');
      } finally {
        setProcessingId(null);
      }
    },
    [showToast],
  );

  // Connection state (offline) overrides the server's operational posture.
  const status: PosturePillStatus = connection === 'offline' ? 'offline' : data?.status ?? 'calm';
  const metrics = data?.metrics ?? EMPTY_METRICS;
  const topSignal = data?.topSignals?.[0] ?? null;
  const totalSignals = data?.signals?.total ?? 0;
  const firstLoad = loading && !data;
  const pendingApprovals = (data?.pendingApprovals ?? []).filter(
    (a) => a.actionId && !decidedIds.has(a.actionId),
  );
  // Safety rail: a governance widget must not hide "needs you" state — the
  // approvals section renders whenever a decision is actually waiting, even
  // if a pref or URL override hides it.
  const showApprovals = effective.sections.approvals || pendingApprovals.length > 0;
  const pinned = pip.pipWindow != null;

  const card = (variant: 'page' | 'pip') => (
    <div
      className={
        variant === 'pip'
          ? 'flex h-screen w-full flex-col overflow-hidden bg-surface-secondary'
          : 'flex h-screen w-full max-w-[380px] flex-col overflow-hidden border border-border bg-surface-secondary sm:h-auto sm:max-h-[88vh] sm:rounded-2xl sm:shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_70px_rgba(0,0,0,0.55)]'
      }
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <DashClawLogo size={16} />
          <span className="truncate text-xs font-semibold text-white">DashClaw</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <PosturePill status={status} />
          {variant === 'pip' ? (
            <button
              type="button"
              onClick={pip.close}
              aria-label="Unpin — close the floating window"
              title="Unpin — close the floating window"
              className={ICON_BUTTON}
            >
              <PinOff size={13} aria-hidden="true" />
            </button>
          ) : (
            <>
              {pip.supported && !pinned ? (
                <button
                  type="button"
                  onClick={pinOnTop}
                  aria-label="Pin on top — floating always-on-top window"
                  title="Pin on top — a true always-on-top window (closes with this tab)"
                  className={ICON_BUTTON}
                >
                  <Pin size={13} aria-hidden="true" />
                </button>
              ) : null}
              {!isPopout ? (
                <button
                  type="button"
                  onClick={popOut}
                  aria-label="Pop out into a floating window"
                  title="Pop out into a floating window — pin it always-on-top with PowerToys (Win+Ctrl+T) on non-Chromium browsers"
                  className={ICON_BUTTON}
                >
                  <AppWindow size={13} aria-hidden="true" />
                </button>
              ) : null}
            </>
          )}
          <Link
            href="/mission-control"
            target={isPopout || variant === 'pip' ? '_blank' : undefined}
            rel={isPopout || variant === 'pip' ? 'noopener noreferrer' : undefined}
            aria-label="Open the full dashboard"
            title="Open the full dashboard"
            className={ICON_BUTTON}
          >
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Widget settings"
            aria-expanded={settingsOpen}
            title="Widget settings — choose sections and metrics"
            className={ICON_BUTTON}
          >
            <Settings2 size={13} aria-hidden="true" />
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <WidgetSettings prefs={prefs} onChange={handlePrefsChange} overridesActive={overridesActive} />
      ) : null}

      {effective.sections.metrics ? <WidgetMetrics metrics={metrics} enabled={effective.metrics} /> : null}

      {showApprovals ? (
        <WidgetApprovals
          approvals={pendingApprovals}
          canDecide={canDecide}
          processingId={processingId}
          onDecide={handleDecision}
        />
      ) : null}

      {effective.sections.topSignal && topSignal ? (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-xs">
          {topSignal.severity === 'red' ? (
            <AlertTriangle size={12} className="shrink-0 text-error" aria-hidden="true" />
          ) : (
            <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden="true" />
          )}
          <span className={`truncate ${topSignal.severity === 'red' ? 'text-error' : 'text-warning'}`}>
            {topSignal.label}
          </span>
          {totalSignals > 1 ? (
            <span className="ml-auto shrink-0 tabular-nums text-tertiary">+{totalSignals - 1}</span>
          ) : null}
        </div>
      ) : null}

      {effective.sections.recentLog ? (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
          <div className="px-3 pt-2 text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">Recent</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WidgetLog
              actions={data?.recentActions ?? []}
              loading={firstLoad}
              error={!data && error ? error : null}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 border-t border-border" />
      )}

      <WidgetFooter connection={connection} lastUpdated={lastUpdated} />

      {toast ? (
        <div
          role="alert"
          className="border-t border-error/30 bg-error-subtle px-3 py-2 text-center text-xs text-error"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );

  return (
    <main className="flex min-h-screen w-full justify-center bg-surface-primary text-primary sm:items-center sm:p-4">
      {pinned && pip.pipWindow ? (
        <>
          <div className="flex w-full max-w-[380px] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface-secondary px-6 py-10 text-center">
            <Pin size={18} className="text-tertiary" aria-hidden="true" />
            <p className="text-sm text-secondary">Pinned — the widget is floating always-on-top.</p>
            <p className="text-xs text-tertiary">It closes with this tab. Keep the tab open.</p>
            <button
              type="button"
              onClick={pip.close}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <PinOff size={13} aria-hidden="true" /> Unpin
            </button>
          </div>
          {createPortal(card('pip'), pip.pipWindow.document.body)}
        </>
      ) : (
        card('page')
      )}
    </main>
  );
}

// Next 16: useSearchParams must live under a Suspense boundary or the
// production build fails (vitest will not catch it).
export default function WidgetPage() {
  return (
    <Suspense fallback={null}>
      <WidgetPageInner />
    </Suspense>
  );
}

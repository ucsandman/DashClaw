'use client';

// DashClaw Pulse — the /widget surface. One question, answerable from across
// the room: "is any of this mine?"
//
// Spec: docs/decisions/2026-08-09-widget-pulse.md (OWED + grafts). The spine:
// absence equals health; the alert channel is the window perimeter (luminance
// and shape, never hue alone); activity never touches the alert channel; zero
// chroma at rest; unknown never renders as calm. Every visual decision is
// computed by the pure composePulse() in app/lib/widget/pulse.ts — this file
// only fetches, listens, and renders.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '../hooks/useRealtime';
import { composePulse, baselineKindForEvent } from '../lib/widget/pulse';

const POLL_MS = 30_000;
const TICK_MS = 5_000;
const REFETCH_DEBOUNCE_MS = 1_000;
const REFETCH_EVENTS = new Set([
  'action.created',
  'action.updated',
  'signal.detected',
  'decision.created',
  'guard.decision.created',
]);

const BASELINE_COLOR = {
  success: 'var(--color-success)',
  brand: 'var(--color-brand)',
  error: 'var(--color-error)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
};

const FAVICON_COLOR = {
  neutral: '--color-text-disabled',
  brand: '--color-brand',
  error: '--color-error',
  dim: '--color-text-disabled',
};

/** Glyph characters per kind — shape channel, never color alone. */
const DASH_CHAR = { 'dash-solid': '—', 'dash-hollow': '┈', 'dash-hatched': '╌' };

function setFavicon(tone) {
  try {
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue(FAVICON_COLOR[tone] || FAVICON_COLOR.neutral).trim();
    if (!color) return;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.globalAlpha = tone === 'dim' ? 0.45 : 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(16, 16, 7, 0, Math.PI * 2);
    ctx.fill();
    let link = document.querySelector('link#pulse-favicon');
    if (!link) {
      link = document.createElement('link');
      link.id = 'pulse-favicon';
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');
  } catch {
    /* favicon is best-effort chrome */
  }
}

export default function WidgetPage() {
  const [data, setData] = useState(null);
  const [lastDataAt, setLastDataAt] = useState(null);
  const [lastTransportAt, setLastTransportAt] = useState(null);
  const [sseUnhealthy, setSseUnhealthy] = useState(false);
  // Render-clock: composePulse is pure, so "now" is state — advanced by the
  // 5s ticker and on every fetch/event — never Date.now() during render.
  const [now, setNow] = useState(0);

  // Baseline strip: one segment in flight, bursts queue, frenzy → steady lit.
  const [segment, setSegment] = useState(null);
  const [steadyUntil, setSteadyUntil] = useState(0);
  const queueRef = useRef([]);
  const inFlightRef = useRef(false);
  const segmentIdRef = useRef(0);
  const debounceRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchPulse = useCallback(async () => {
    try {
      const res = await fetch('/api/widget/pulse', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      setData(json);
      setLastDataAt(Date.now());
      setNow(Date.now());
    } catch {
      // A failed fetch leaves lastDataAt untouched; the freshness ladder in
      // composePulse degrades honestly to DRIFTING then STALE (H3/H4).
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setNow(Date.now());
    fetchPulse();
    const poll = setInterval(fetchPulse, POLL_MS);
    const ticker = setInterval(() => {
      if (mountedRef.current) setNow(Date.now());
    }, TICK_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(poll);
      clearInterval(ticker);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchPulse]);

  const pumpRef = useRef(() => {});
  const pumpBaseline = useCallback(() => {
    if (inFlightRef.current || !mountedRef.current) return;
    const kind = queueRef.current.shift();
    if (!kind) return;
    inFlightRef.current = true;
    segmentIdRef.current += 1;
    setSegment({ kind, id: segmentIdRef.current });
    setTimeout(() => {
      inFlightRef.current = false;
      if (!mountedRef.current) return;
      setSegment(null);
      setTimeout(() => pumpRef.current(), 150);
    }, 900);
  }, []);
  useEffect(() => {
    pumpRef.current = pumpBaseline;
  }, [pumpBaseline]);

  const enqueueBaseline = useCallback(
    (kind) => {
      const now = Date.now();
      if (steadyUntil > now) {
        setSteadyUntil(now + 2000);
        return;
      }
      queueRef.current.push(kind);
      // Frenzy governor: a burst collapses to a steady lit strip, not a strobe.
      if (queueRef.current.length > 6) {
        queueRef.current = [];
        setSteadyUntil(now + 3000);
        return;
      }
      pumpBaseline();
    },
    [pumpBaseline, steadyUntil],
  );

  useRealtime(
    useCallback(
      (event, payload) => {
        const now = Date.now();
        if (event === 'heartbeat') {
          setLastTransportAt(now);
          return;
        }
        if (event === 'sse.open') {
          setSseUnhealthy(false);
          // H4: refetch before repaint — a reopened pipe must not resurrect
          // a stale calm from cached data.
          fetchPulse();
          return;
        }
        if (event === 'sse.error') {
          setSseUnhealthy(true);
          return;
        }
        if (!REFETCH_EVENTS.has(event)) return;
        setLastTransportAt(now);
        const kind = baselineKindForEvent(event, payload);
        if (kind) enqueueBaseline(kind);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchPulse();
        }, REFETCH_DEBOUNCE_MS);
      },
      [enqueueBaseline, fetchPulse],
    ),
  );

  const view = composePulse({ data, lastDataAt, lastTransportAt, sseUnhealthy }, now);

  // Next streams the layout <title> after hydration and can clobber a title set
  // once by this effect; keying on the 5s tick reasserts it so the posture title
  // always wins the race.
  useEffect(() => {
    if (document.title !== view.title) document.title = view.title;
  }, [view.title, now]);

  useEffect(() => {
    setFavicon(view.faviconTone);
  }, [view.faviconTone]);

  // The whole field is the one click target: open the full dashboard.
  const openApprovals = useCallback(() => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.opener.location.href = '/approvals';
        return;
      }
    } catch {
      /* opener is cross-origin or gone — fall through */
    }
    window.open('/approvals', '_blank', 'noopener,noreferrer');
  }, []);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openApprovals();
      }
    },
    [openApprovals],
  );

  const steady = steadyUntil > now;
  const ringStyle = {
    borderColor: view.ring.colorVar,
    opacity: view.ring.opacity,
    borderStyle: view.ring.dashed ? 'dashed' : 'solid',
  };

  return (
    <div
      className={`pulse-field fixed inset-0 flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-surface-primary pb-16 ${view.hatch ? 'pulse-hatch' : ''}`}
      style={{ containerType: 'size' }}
      role="button"
      tabIndex={0}
      onClick={openApprovals}
      onKeyDown={onKeyDown}
      aria-label={`${view.caption || view.posture}. ${view.presence.aria}. Opens approvals.`}
    >
      {/* Ring — the peripheral channel. Keyed so a posture change replays the
          one-shot arm swell (motion #2). */}
      <div
        key={`${view.posture}-${view.overdue}`}
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 rounded-xl border-[3px] pulse-ring--armed ${view.ring.breathe ? 'pulse-ring--breathe' : ''}`}
        style={ringStyle}
      />
      {/* Reduced-motion static tell: double ring = elevated (spec §9 #3). */}
      {view.ring.breathe && (
        <div
          aria-hidden="true"
          className="pulse-inner-ring pulse-inner-ring--armed pointer-events-none fixed rounded-[9px] border"
          style={{ inset: 3, borderColor: 'var(--color-error)' }}
        />
      )}

      {/* Signal rail — the displaced obligation annotates, never silent (R2). */}
      {view.rail && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed w-[2px]"
            style={{ left: 3, top: 12, bottom: 12, background: view.rail.severity === 'red' ? 'var(--color-error)' : 'var(--color-warning)' }}
          />
          {view.rail.count != null && (
            <div
              className="pointer-events-none fixed font-mono text-xs"
              style={{ left: 8, top: 8, color: 'var(--color-error)' }}
            >
              !{view.rail.count}
            </div>
          )}
        </>
      )}

      {/* Presence notch — verdict != live only. Never drives the ring (R4). */}
      {view.presence.notch !== 'none' && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed h-[10px] w-[10px] rotate-45"
          style={{
            top: 12,
            right: 12,
            ...(view.presence.notch === 'warning-filled'
              ? { background: 'var(--color-warning)' }
              : {
                  border: `1px ${view.presence.notch === 'outline-dashed' ? 'dashed' : 'solid'} var(--color-text-disabled)`,
                  opacity: view.presence.notch === 'outline-dashed' ? 0.55 : 1,
                }),
          }}
        />
      )}

      {/* Glyph + caption — the foveal channel. Keyed for the 160ms crossfade
          (motion #4). role=status so screen readers hear posture changes. */}
      <div role="status" className="flex flex-col items-center" aria-live="polite">
        <div
          key={`${view.glyph.kind}-${view.glyph.text}`}
          className="pulse-glyph-swap tabular-nums font-light leading-none"
          style={{
            fontSize: 'clamp(48px, 34cqh, 132px)',
            color: view.glyph.colorVar,
            opacity: view.glyph.opacity,
          }}
        >
          {view.glyph.kind === 'count' || view.glyph.kind === 'count-signal'
            ? view.glyph.text
            : DASH_CHAR[view.glyph.kind] || '—'}
        </div>
        {/* Signals-own-the-glyph underline bar — shape channel, never
            orange-vs-red alone. */}
        {view.glyph.kind === 'count-signal' && (
          <div aria-hidden="true" className="mt-1 h-[3px] w-16" style={{ background: 'var(--color-error)' }} />
        )}
        {view.caption && (
          <div
            className={`pulse-caption mt-3.5 max-w-[calc(100%-48px)] truncate text-center text-xs ${view.captionSecondary ? 'text-secondary' : 'text-tertiary'}`}
          >
            {view.caption}
          </div>
        )}
      </div>

      {/* Baseline strip — activity, never urgency (R5). */}
      <div aria-hidden="true" className="fixed bottom-0 left-0 right-0 h-[3px] overflow-hidden" style={{ background: 'var(--color-bg-tertiary)' }}>
        {steady ? (
          <div className="h-full w-full" style={{ background: 'var(--color-border-hover)' }} />
        ) : (
          segment && (
            <div
              key={segment.id}
              className="pulse-baseline-segment h-full w-16"
              style={{ background: BASELINE_COLOR[segment.kind] || 'var(--color-info)' }}
            />
          )
        )}
      </div>

      {/* Reveal layer — the only place detail lives; hover/focus only. */}
      <div
        className="pulse-reveal fixed flex flex-col gap-2 px-4 py-4 text-xs"
        style={{ inset: 3, background: 'var(--color-bg-primary)' }}
      >
        <div className="text-secondary">{view.reveal.summary}</div>
        <div className="border-t border-border" />
        {view.reveal.rows.map((row) => (
          <div key={row.actionId || row.actionType} className="flex items-baseline gap-2 text-secondary">
            <span className="min-w-0 flex-1 truncate">{row.actionType}</span>
            <span className="truncate text-tertiary">{row.agentName}</span>
            <span className="tabular-nums" style={row.riskHigh ? { color: 'var(--color-error)' } : undefined}>
              risk {row.riskScore}
            </span>
            <span className="tabular-nums text-tertiary">{row.age}</span>
          </div>
        ))}
        {/* Slice 2 approve/deny lands in a reserved 36px row per pending item —
            zero layout change (spec §2.6). */}
        <div className="mt-auto flex flex-col gap-1 text-tertiary">
          {view.reveal.signalLine && <div className="truncate">{view.reveal.signalLine}</div>}
          {view.reveal.presenceLine && <div className="truncate">◇ {view.reveal.presenceLine}</div>}
          <div className="text-disabled">click anywhere → approvals</div>
        </div>
      </div>
    </div>
  );
}

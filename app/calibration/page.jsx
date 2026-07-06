'use client';

/**
 * /calibration — the calibrated interruption controller's operator surface.
 * Theory: docs/architecture/governance-core-theory.md §1.
 *
 * Every human step here is a click (HUMAN-EXPERIENCE.md): set the target
 * false-interruption rate, flip the mode (off → shadow → active, two-step
 * confirm on active), watch observed vs target, reset agent alarms. The
 * controller only ever tightens; when the calibrated threshold says the org
 * over-interrupts, this page points at the /policies proposal rails — the
 * human-ratified loosening path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Crosshair, Gauge, BellRing, ListChecks, RotateCcw, ShieldQuestion, ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';

const MODES = [
  { id: 'off', label: 'Off', hint: 'No assessment. Feedback still accumulates from approvals.' },
  { id: 'shadow', label: 'Shadow', hint: 'Records what the calibrated threshold WOULD do on every decision. Changes nothing.' },
  { id: 'active', label: 'Active', hint: 'Raises allow/warn to require_approval at the calibrated threshold. Tighten-only; blocks stay absolute.' },
];

function fmtPct(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtTheta(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return v > 100 ? '>100' : (Math.round(v * 10) / 10).toString();
}

// Inline trend, hand-rolled SVG colored by className (currentColor pattern
// shared with /posture and /drift).
function Sparkline({ points, className = 'text-secondary', height = 36, refLine = null }) {
  if (!points || points.length < 2) {
    return <div className="h-9 text-[11px] text-disabled flex items-center">Not enough data yet</div>;
  }
  const w = 220;
  const min = Math.min(...points, refLine ?? Infinity);
  const max = Math.max(...points, refLine ?? -Infinity);
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * w;
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={`w-full ${className}`} preserveAspectRatio="none" aria-hidden="true">
      {refLine != null && (
        <line x1="0" x2={w} y1={y(refLine)} y2={y(refLine)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="4 4" strokeWidth="1" />
      )}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function StatTile({ label, value, sub, tone = 'text-primary' }) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-tertiary">{sub}</div>}
    </div>
  );
}

export default function CalibrationPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingActive, setPendingActive] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  const flash = useCallback((msg, isError = false) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ msg, isError });
    noticeTimer.current = setTimeout(() => setNotice(null), 3500);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/calibration/controller');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setData(body);
      setTargetInput(String(Math.round(body.settings.target_rate * 100)));
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body, okMsg) => {
    setSaving(true);
    try {
      const res = await fetch('/api/calibration/controller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      flash(okMsg);
      await load();
    } catch (err) {
      flash(err.message || 'Update failed', true);
    } finally {
      setSaving(false);
    }
  }, [flash, load]);

  const setMode = (mode) => {
    if (mode === 'active' && !pendingActive) {
      setPendingActive(true);
      return;
    }
    setPendingActive(false);
    post({ mode }, mode === 'off' ? 'Controller turned off' : `Controller set to ${mode} mode`);
  };

  const saveTarget = () => {
    const pct = Number(targetInput);
    if (!Number.isFinite(pct) || pct < 1 || pct > 50) {
      flash('Target must be between 1% and 50%', true);
      return;
    }
    post({ target_rate: pct / 100 }, `Target false-interruption rate set to ${pct}%`);
  };

  const settings = data?.settings;
  const state = data?.state;
  const events = data?.events ?? [];
  const chrono = [...events].reverse();
  const thetaSeries = chrono.map((e) => e.theta_after);
  // Rolling observed rate (window 20) over the adjudication stream.
  const rateSeries = [];
  {
    const win = [];
    for (const e of chrono) {
      win.push(e.loss ? 1 : 0);
      if (win.length > 20) win.shift();
      rateSeries.push(win.reduce((s, v) => s + v, 0) / win.length);
    }
  }
  const alarms = (data?.alarms ?? []).filter((a) => a.alarmed_at);
  const watchlist = (data?.alarms ?? []).filter((a) => !a.alarmed_at).slice(0, 5);
  const policies = data?.risk_threshold_policies ?? [];
  const lowestPolicy = policies.length > 0 ? policies[0] : null;
  const overInterrupting = lowestPolicy && state && state.theta > lowestPolicy.threshold;
  const onTarget = state?.observed_window_rate == null || settings == null
    ? null
    : state.observed_window_rate <= settings.target_rate * 1.25;

  return (
    <PageLayout
      title="Calibration"
      subtitle="Distribution-free control of the interruption error rate — shadow first, tighten-only when active"
      agentFilter={false}
    >
      <div className="px-4 sm:px-6 py-5 space-y-4 max-w-6xl">
        {loading && <div className="text-sm text-tertiary">Loading controller state…</div>}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle p-3 text-sm text-error flex items-center justify-between">
            <span>Failed to load: {error}</span>
            <button onClick={load} className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-border-hover">Retry</button>
          </div>
        )}

        {data && (
          <>
            {/* Controls */}
            <Card hover={false}>
              <CardHeader title="Controller" icon={Crosshair} />
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Controller mode">
                    {MODES.map((m) => {
                      const active = settings.mode === m.id;
                      const confirming = m.id === 'active' && pendingActive;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setMode(m.id)}
                          disabled={saving}
                          title={m.hint}
                          className={`px-4 py-1.5 text-sm transition-colors ${
                            active
                              ? 'bg-brand/10 text-brand font-semibold'
                              : confirming
                                ? 'bg-warning-subtle text-warning font-semibold'
                                : 'bg-surface-secondary text-secondary hover:text-primary'
                          }`}
                        >
                          {confirming ? 'Confirm activate?' : m.label}
                        </button>
                      );
                    })}
                  </div>
                  {pendingActive && (
                    <button onClick={() => setPendingActive(false)} className="text-xs text-tertiary hover:text-primary">Cancel</button>
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <label htmlFor="target-rate" className="text-[12px] text-tertiary">Target false-interruption rate</label>
                    <input
                      id="target-rate"
                      type="number"
                      min="1"
                      max="50"
                      value={targetInput}
                      onChange={(e) => setTargetInput(e.target.value)}
                      className="w-16 rounded-md border border-border bg-surface-primary px-2 py-1 text-sm tabular-nums text-primary"
                    />
                    <span className="text-sm text-tertiary">%</span>
                    <button
                      onClick={saveTarget}
                      disabled={saving}
                      className="rounded-md border border-border bg-surface-tertiary px-3 py-1 text-sm text-secondary hover:border-border-hover hover:text-primary"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <p className="text-[12px] leading-relaxed text-tertiary max-w-3xl">
                  {MODES.find((m) => m.id === settings.mode)?.hint}
                  {' '}Feedback comes from your approve/deny verdicts on interruptions; expired approvals teach nothing.
                  Activation is a human decision made here — the controller may only add interruptions, never remove them.
                </p>
                {notice && (
                  <div role="status" className={`rounded-md px-3 py-2 text-sm ${notice.isError ? 'bg-error-subtle text-error' : 'bg-success-subtle text-success'}`}>
                    {notice.msg}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Posture */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile
                label="Calibrated threshold θ"
                value={fmtTheta(state.theta)}
                sub={lowestPolicy ? `policy interrupts at ${lowestPolicy.threshold}` : 'no risk_threshold policy active'}
              />
              <StatTile
                label="Observed rate (last 50)"
                value={fmtPct(state.observed_window_rate)}
                sub={`target ${fmtPct(settings.target_rate, 0)}`}
                tone={onTarget == null ? 'text-primary' : onTarget ? 'text-success' : 'text-warning'}
              />
              <StatTile
                label="Adjudications"
                value={state.labeled_total}
                sub={`${state.labeled_benign} approved · ${state.labeled_denied} denied`}
              />
              <StatTile
                label="Agent alarms"
                value={alarms.length}
                sub={alarms.length > 0 ? 'anytime-valid evidence crossed' : `fires at e ≥ ${data.defaults.alarm_at}`}
                tone={alarms.length > 0 ? 'text-error' : 'text-primary'}
              />
            </div>

            {/* Trends */}
            <div className="grid md:grid-cols-2 gap-3">
              <Card hover={false}>
                <CardHeader title="Calibrated threshold over time" icon={Gauge} />
                <CardContent>
                  <div className="text-info"><Sparkline points={thetaSeries} refLine={lowestPolicy?.threshold ?? null} /></div>
                  <div className="mt-1 text-[11px] text-tertiary">Dashed line: lowest active risk_threshold policy{lowestPolicy ? ` (${lowestPolicy.threshold})` : ''}</div>
                </CardContent>
              </Card>
              <Card hover={false}>
                <CardHeader title="Observed false-interruption rate (rolling 20)" icon={ListChecks} />
                <CardContent>
                  <div className={onTarget === false ? 'text-warning' : 'text-success'}>
                    <Sparkline points={rateSeries} refLine={settings.target_rate} />
                  </div>
                  <div className="mt-1 text-[11px] text-tertiary">Dashed line: target rate {fmtPct(settings.target_rate, 0)}</div>
                </CardContent>
              </Card>
            </div>

            {/* Loosening evidence routes to the human rails */}
            {overInterrupting && (
              <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3 flex items-start gap-3">
                <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-info" />
                <div className="text-sm text-secondary">
                  The calibrated threshold ({fmtTheta(state.theta)}) sits above your policy threshold ({lowestPolicy.threshold}) —
                  your feedback says the current policy over-interrupts. Loosening enforcement is a human decision:
                  review the tuning proposals on the policies page.
                  <Link href="/policies" className="ml-2 inline-flex items-center gap-1 text-info hover:underline">
                    Review proposals <ArrowUpRight size={13} />
                  </Link>
                </div>
              </div>
            )}

            {/* Alarms */}
            <Card hover={false}>
              <CardHeader title="Agent alarms" icon={BellRing} count={alarms.length} />
              <CardContent>
                {alarms.length === 0 ? (
                  <p className="text-sm text-tertiary">
                    No standing alarms. An alarm fires the moment an agent&apos;s denial evidence (e-process) crosses
                    the anytime-valid threshold — false-alarm probability stays below 5% no matter how often you look.
                    {watchlist.length > 0 && ' Highest current e-values:'}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {alarms.map((a) => (
                      <li key={a.agent_id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-primary">{a.agent_id}</div>
                          <div className="text-[12px] text-tertiary tabular-nums">
                            e = {a.e.toFixed(1)} · {a.denied}/{a.n} denied · alarmed {new Date(a.alarmed_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="rounded-full bg-error-subtle px-2 py-0.5 text-[11px] font-semibold text-error">escalating</span>
                          <button
                            onClick={() => post({ reset_agent_alarm: a.agent_id }, `Alarm reset for ${a.agent_id}`)}
                            disabled={saving}
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-secondary hover:border-border-hover hover:text-primary"
                          >
                            Reset alarm
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {watchlist.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {watchlist.map((a) => (
                      <span key={a.agent_id} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-tertiary tabular-nums">
                        {a.agent_id}: e {a.e.toFixed(2)}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent adjudications */}
            <Card hover={false}>
              <CardHeader
                title="Recent adjudications"
                icon={ListChecks}
                count={events.length}
                action={
                  <button
                    onClick={() => {
                      if (window.confirm('Reset the calibrated threshold and all agent e-values to their starting point?')) {
                        post({ reset_state: true }, 'Calibrated state reset');
                      }
                    }}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-tertiary hover:border-border-hover hover:text-primary"
                  >
                    <RotateCcw size={12} /> Reset state
                  </button>
                }
              />
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-sm text-tertiary">
                    No labeled feedback yet. Every approve/deny you make on a pending interruption becomes a
                    calibration label here — the controller learns from your verdicts, whatever the mode.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                          <th className="py-1.5 pr-3 font-semibold">When</th>
                          <th className="py-1.5 pr-3 font-semibold">Agent</th>
                          <th className="py-1.5 pr-3 font-semibold">Risk</th>
                          <th className="py-1.5 pr-3 font-semibold">Verdict</th>
                          <th className="py-1.5 pr-3 font-semibold">θ movement</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {events.slice(0, 30).map((e, i) => (
                          <tr key={`${e.action_id ?? 'ev'}_${i}`}>
                            <td className="py-2 pr-3 whitespace-nowrap text-tertiary">{new Date(e.created_at).toLocaleString()}</td>
                            <td className="py-2 pr-3 max-w-[180px] truncate text-secondary">{e.agent_id ?? '—'}</td>
                            <td className="py-2 pr-3 tabular-nums text-secondary">{Math.round(e.risk_score)}</td>
                            <td className="py-2 pr-3">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                e.label === 'benign'
                                  ? (e.loss ? 'bg-warning-subtle text-warning' : 'bg-success-subtle text-success')
                                  : 'bg-error-subtle text-error'
                              }`}>
                                {e.label === 'benign' ? (e.loss ? 'approved · false interruption' : 'approved') : 'denied'}
                              </span>
                            </td>
                            <td className="py-2 pr-3 tabular-nums text-tertiary">
                              {fmtTheta(e.theta_before)} → {fmtTheta(e.theta_after)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}

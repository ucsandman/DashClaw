'use client';

/**
 * Calibration — section 4.5 of /policies (was the standalone /calibration
 * page; spec docs/superpowers/specs/2026-08-20-policies-calibration-onboarding-redesign.md §5).
 * Theory: docs/architecture/governance-core-theory.md §1.
 *
 * Two things live here and nothing else above the fold: what the controller
 * has LEARNED (an honest verdict count, split live vs retrospective) and what
 * it still needs from you. Every knob it ever had is intact behind the one
 * "Controller settings" disclosure.
 *
 * The Greek letter is gone from the UI on purpose (spec §5.4) — the machine
 * ids on /api/calibration/controller are unchanged, this is a label layer.
 * Every human step is a click (HUMAN-EXPERIENCE.md): switch relief on, set
 * the acceptable rate, reset an agent, forget the learned state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import styles from '../policies.module.css';

interface ControllerEvent {
  action_id?: string | null;
  agent_id?: string | null;
  risk_score: number;
  theta_before: number;
  theta_after: number;
  label: string;
  loss: number;
  source?: string | null;
  created_at: string;
}

interface ControllerAlarm {
  agent_id: string;
  e: number;
  n: number;
  denied: number;
  alarmed_at: string | null;
}

interface ControllerSnapshot {
  settings: { mode: string; target_rate: number };
  state: {
    theta: number;
    labeled_total: number;
    labeled_live: number;
    labeled_benign: number;
    labeled_denied: number;
    loss_sum: number;
    observed_rate: number | null;
    observed_window_rate: number | null;
    observed_window: number;
    relief_ceiling: number;
    relief_ready: boolean;
    active_eligible: boolean;
  };
  defaults: Record<string, number>;
  alarms: ControllerAlarm[];
  events: ControllerEvent[];
  risk_threshold_policies: Array<{ id: string; name: string; threshold: number; action: string }>;
}

/** Mode ids stay machine-side; these are the words humans read (spec §5.4). */
const MODES = [
  { id: 'off', label: 'Off', hint: 'No assessment. Verdicts still accumulate.' },
  { id: 'shadow', label: 'Preview', hint: 'Records what it WOULD do on every decision. Changes nothing.' },
  { id: 'relief', label: 'Fewer interruptions', hint: 'Stops asking below the learned threshold: an approval request becomes a warning, still recorded. Only ever removes interruptions — never adds one, never reaches allow, never touches a block.' },
  { id: 'active', label: 'Fewer and more', hint: 'Both arms: also asks about actions above the learned threshold. Blocks stay absolute.' },
];

function fmtPct(v: number | null | undefined, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** The learned pause-above-risk score. Never printed with a Greek letter. */
function fmtRisk(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—';
  return v > 100 ? '>100' : (Math.round(v * 10) / 10).toString();
}

function verdictWording(e: ControllerEvent) {
  if (e.label !== 'benign') return 'denied';
  return e.loss ? 'approved — we should not have asked' : 'approved';
}

function sourceWording(source: string | null | undefined) {
  if (source === 'warn_review') return 'Warn review';
  if (source === 'seed') return 'Seed';
  return 'Approval';
}

// Inline trend, hand-rolled SVG colored by className (currentColor pattern
// shared with /posture and /drift). Kept from the page: the only place the
// controller's behaviour over time is visible.
function Sparkline({ points, className = 'text-secondary', height = 36, refLine = null }: {
  points: number[]; className?: string; height?: number; refLine?: number | null;
}) {
  if (!points || points.length < 2) {
    return <div className="flex h-9 items-center text-[11px] text-tertiary">Not enough data yet</div>;
  }
  const w = 220;
  const min = Math.min(...points, refLine ?? Infinity);
  const max = Math.max(...points, refLine ?? -Infinity);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
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

function StatTile({ label, value, badge, sub, tone = 'text-primary', children }: {
  label: string; value: string; badge?: string; sub?: string; tone?: string; children?: React.ReactNode;
}) {
  return (
    <div className={`${styles.card} px-4 py-3`}>
      <div className={styles.metaLabel}>{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</span>
        {badge && <span className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${tone}`}>{badge}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-tertiary">{sub}</div>}
      {children}
    </div>
  );
}

export default function CalibrationSection({ onChanged }: { onChanged?: () => void } = {}) {
  const [data, setData] = useState<ControllerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingActive, setPendingActive] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [notice, setNotice] = useState<{ msg: string; isError: boolean } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const scrolled = useRef(false);

  const flash = useCallback((msg: string, isError = false) => {
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
      setError((err as Error).message || 'Failed to load');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // /policies#calibration is the deep link the sidebar and the old
  // /calibration route both land on. The anchor only exists once the fetch
  // resolves, so this waits for the first snapshot — then never again: a
  // later refresh must not yank a reading human back up the page.
  useEffect(() => {
    if (!data || scrolled.current) return;
    if (typeof window === 'undefined' || window.location.hash !== '#calibration') return;
    scrolled.current = true;
    anchorRef.current?.scrollIntoView({ block: 'start' });
  }, [data]);

  const post = useCallback(async (body: Record<string, unknown>, okMsg: string) => {
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
      onChanged?.();
    } catch (err) {
      flash((err as Error).message || 'Update failed', true);
    } finally {
      setSaving(false);
    }
  }, [flash, load, onChanged]);

  const setMode = (mode: string) => {
    // "Fewer and more" is the only mode that can ADD an interruption, so it
    // keeps the two-step confirm (MAINTAINER.md §3: never automatic).
    if (mode === 'active' && !pendingActive) {
      setPendingActive(true);
      return;
    }
    setPendingActive(false);
    post({ mode }, mode === 'off' ? 'Calibration turned off' : `Calibration set to ${MODES.find((m) => m.id === mode)?.label}`);
  };

  const saveTarget = () => {
    const pct = Number(targetInput);
    if (!Number.isFinite(pct) || pct < 1 || pct > 50) {
      flash('Target must be between 1% and 50%', true);
      return;
    }
    post({ target_rate: pct / 100 }, `Acceptable false interruptions set to ${pct}%`);
  };

  if (error) {
    return (
      <div id="calibration" className={styles.secHead}>
        <div className={styles.lhs}>
          <h2>Calibration</h2>
          <span className={styles.secHelp}>Failed to load: {error}</span>
        </div>
        <button type="button" onClick={load} className={`${styles.btn} ${styles.btnSm}`}>Retry</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div id="calibration" className={styles.secHead}>
        <div className={styles.lhs}>
          <h2>Calibration</h2>
          <span className={styles.secHelp}>Loading what it has learned…</span>
        </div>
      </div>
    );
  }

  const { settings, state } = data;
  const events = data.events ?? [];
  const chrono = [...events].reverse();
  const riskSeries = chrono.map((e) => e.theta_after);
  // Rolling observed rate (window 20) over the verdict stream.
  const rateSeries: number[] = [];
  {
    const win: number[] = [];
    for (const e of chrono) {
      win.push(e.loss ? 1 : 0);
      if (win.length > 20) win.shift();
      rateSeries.push(win.reduce((s, v) => s + v, 0) / win.length);
    }
  }
  const alarms = (data.alarms ?? []).filter((a) => a.alarmed_at);
  const watchlist = (data.alarms ?? []).filter((a) => !a.alarmed_at).slice(0, 5);
  // The lowest active risk_threshold line is the floor the Short List's block
  // sits at (100 on the seeded pack); no such policy means no floor to name.
  const shortListFloor = (data.risk_threshold_policies ?? [])[0]?.threshold ?? 100;
  const minLabels = data.defaults?.relief_min_labels ?? 10;
  const minLive = data.defaults?.relief_min_live_labels ?? 3;
  const liveLabels = state.labeled_live ?? 0;
  const retroLabels = Math.max(0, (state.labeled_total ?? 0) - liveLabels);
  const reliefReady = state.relief_ready === true;
  const reliefLive = reliefReady && (settings.mode === 'relief' || settings.mode === 'active');
  const onTarget = state.observed_window_rate == null
    ? null
    : state.observed_window_rate <= settings.target_rate * 1.25;

  const modeLabel = settings.mode === 'relief'
    ? `Fewer interruptions — ${fmtRisk(state.theta)}`
    : (MODES.find((m) => m.id === settings.mode)?.label ?? 'Off');

  return (
    <div id="calibration" ref={anchorRef}>
      <div className={styles.secHead}>
        <div className={styles.lhs}>
          <h2>Calibration</h2>
          <span className={styles.secHelp}>What it has learned, and what it still needs from you.</span>
        </div>
        <span className={styles.metaLabel}>{modeLabel}</span>
      </div>

      {/* The honest state sentence — the one piece of copy that says exactly
          how much evidence exists and where it came from (spec §5.3). */}
      <div className={`${styles.card} px-4 py-3`}>
        <div data-testid="calibration-state-sentence" className="text-sm leading-relaxed text-secondary">
          {!reliefReady ? (
            <>
              <p>
                {`Calibration learns from verdicts, not from traffic. You have given ${state.labeled_total ?? 0} (${liveLabels} from real approvals, ${retroLabels} from the warn rows above). Automatic tuning needs ${minLabels} verdicts, ${minLive} of them real approve/deny calls, before it can act.`}
              </p>
              {settings.mode === 'shadow' && (
                <p className="mt-1.5">
                  Preview mode is on: it is recording what it WOULD do and changing nothing. It can never touch a Short List line, never reach allow, never lift a block.
                </p>
              )}
            </>
          ) : reliefLive ? (
            <p>
              {`Calibration learns from verdicts, not from traffic. You have given ${state.labeled_total ?? 0} verdicts: ${liveLabels} from real approvals, ${retroLabels} from the warn rows above. Relief is on — it stops asking below risk ${fmtRisk(state.theta)}, and it can never touch a Short List line, a block, or reach allow.`}
              {settings.mode === 'active' && ` It also asks above risk ${fmtRisk(state.theta)}.`}
            </p>
          ) : (
            <p>
              {`Ready. It would stop asking below risk ${fmtRisk(state.theta)} and never go past ${Math.round(state.relief_ceiling ?? 0)}, the riskiest action you approved.`}
            </p>
          )}
        </div>
        <div className="mt-3">
          {!reliefReady ? (
            <a href="#needs-your-call" className={`${styles.btn} ${styles.btnSm}`}>Review the warn groups above</a>
          ) : reliefLive ? (
            <Link href="/decisions?decision=warn" className="inline-flex items-center gap-1 text-[13px] text-info hover:underline">
              See what it skipped <ArrowUpRight size={13} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => post({ mode: 'relief' }, 'Fewer interruptions is on')}
              disabled={saving}
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
            >
              Switch on fewer interruptions
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className={`mt-3 rounded-md px-3 py-2 text-sm ${notice.isError ? 'bg-error-subtle text-error' : 'bg-success-subtle text-success'}`}>
          {notice.msg}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <StatTile
          label="Pausing above risk"
          value={fmtRisk(state.theta)}
          sub={`Short List floor: ${shortListFloor}`}
        >
          <div className="mt-2 text-info"><Sparkline points={riskSeries} refLine={shortListFloor} /></div>
        </StatTile>
        <StatTile
          label="False interruptions — last 50"
          value={fmtPct(state.observed_window_rate)}
          badge={onTarget == null ? undefined : onTarget ? 'On target' : 'Over target'}
          sub={`target ${fmtPct(settings.target_rate, 0)}`}
          tone={onTarget == null ? 'text-primary' : onTarget ? 'text-success' : 'text-warning'}
        >
          <div className={`mt-2 ${onTarget === false ? 'text-warning' : 'text-success'}`}>
            <Sparkline points={rateSeries} refLine={settings.target_rate} />
          </div>
        </StatTile>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-tertiary">
        <span>{alarms.length === 0 ? 'No agents flagged.' : `${alarms.length} flagged — reset them in Controller settings.`}</span>
        {watchlist.length > 0 && (
          <>
            <span>{watchlist.length} near the line:</span>
            {watchlist.map((a) => (
              <span key={a.agent_id} className="rounded-full border border-border px-2 py-0.5 tabular-nums">
                {a.agent_id}
              </span>
            ))}
          </>
        )}
      </div>

      <div className="mt-3">
        <CollapsibleSection id="policies.calibration.settings" title="Controller settings" defaultOpen={false}>
          <div className={`${styles.card} space-y-5 px-4 py-4`}>
            {/* Mode */}
            <div>
              <div className={styles.metaLabel}>Mode</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Calibration mode">
                  {MODES.map((m) => {
                    const isCurrent = settings.mode === m.id;
                    const confirming = m.id === 'active' && pendingActive;
                    const blocked = m.id === 'active' && state.active_eligible !== true;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMode(m.id)}
                        disabled={saving || blocked}
                        title={blocked ? 'Offered once the observed rate holds under target for 7 straight days.' : m.hint}
                        className={`px-4 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          isCurrent
                            ? 'bg-brand/10 font-semibold text-brand'
                            : confirming
                              ? 'bg-warning-subtle font-semibold text-warning'
                              : 'bg-surface-secondary text-secondary hover:text-primary'
                        }`}
                      >
                        {confirming ? 'Confirm fewer and more?' : m.label}
                      </button>
                    );
                  })}
                </div>
                {pendingActive && (
                  <button type="button" onClick={() => setPendingActive(false)} className="text-xs text-tertiary hover:text-primary">Cancel</button>
                )}
              </div>
              <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-tertiary">
                Fewer and more is offered once the observed rate holds under target for 7 straight days. It is the only mode that can ADD an interruption.
              </p>
            </div>

            {/* Target rate */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="calibration-target-rate" className="text-[13px] text-secondary">Acceptable false interruptions</label>
                <input
                  id="calibration-target-rate"
                  type="number"
                  min="1"
                  max="50"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  className="w-16 rounded-md border border-border bg-surface-primary px-2 py-1 text-sm tabular-nums text-primary"
                />
                <span className="text-sm text-tertiary">%</span>
                <button type="button" onClick={saveTarget} disabled={saving} className={`${styles.btn} ${styles.btnSm}`}>Save</button>
              </div>
              <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-tertiary">
                Out of every 100 interruptions, how many may turn out to be things you would have approved. A lower number means more interruptions.
              </p>
            </div>

            {/* Agent alarms */}
            <div>
              <div className={styles.metaLabel}>Agents denied far more than chance explains</div>
              {alarms.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-tertiary">None. This flags an agent whose denial rate has crossed anytime-valid evidence, not a fixed count.</p>
              ) : (
                <ul className="mt-1.5 divide-y divide-border">
                  {alarms.map((a) => (
                    <li key={a.agent_id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-primary">{a.agent_id}</div>
                        <div className="text-[12px] tabular-nums text-tertiary">
                          {a.denied}/{a.n} denied · flagged {new Date(a.alarmed_at as string).toLocaleString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => post({ reset_agent_alarm: a.agent_id }, `Cleared the flag on ${a.agent_id}`)}
                        disabled={saving}
                        className={`${styles.btn} ${styles.btnSm}`}
                      >
                        Reset
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Verdict history */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className={styles.metaLabel}>What your verdicts taught it</div>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Forget everything calibration has learned — the threshold and every agent flag — and start over?')) {
                      post({ reset_state: true }, 'Calibration forgot what it had learned');
                    }
                  }}
                  disabled={saving}
                  className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                >
                  <RotateCcw size={12} /> Forget everything it learned
                </button>
              </div>
              {events.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-tertiary">
                  Nothing yet. Every approve/deny you give — on a pending approval, or retrospectively on a warn group above — becomes a verdict here.
                </p>
              ) : (
                <div className="mt-1.5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={`text-left ${styles.metaLabel}`}>
                        <th className="py-1.5 pr-3 font-medium">When</th>
                        <th className="py-1.5 pr-3 font-medium">Risk</th>
                        <th className="py-1.5 pr-3 font-medium">Verdict</th>
                        <th className="py-1.5 pr-3 font-medium">Source</th>
                        <th className="py-1.5 pr-3 font-medium">Threshold</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {events.slice(0, 30).map((e, i) => (
                        <tr key={`${e.action_id ?? 'ev'}_${i}`}>
                          <td className="whitespace-nowrap py-2 pr-3 text-tertiary">{new Date(e.created_at).toLocaleString()}</td>
                          <td className="py-2 pr-3 tabular-nums text-secondary">{Math.round(e.risk_score)}</td>
                          <td className="py-2 pr-3 text-secondary">{verdictWording(e)}</td>
                          <td className="py-2 pr-3 text-tertiary">{sourceWording(e.source)}</td>
                          <td className="py-2 pr-3 tabular-nums text-tertiary">
                            {fmtRisk(e.theta_before)} → {fmtRisk(e.theta_after)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}

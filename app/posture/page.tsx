'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, ShieldAlert, ShieldX, RefreshCw, AlertTriangle,
  ChevronRight, X, FileText, Clock, CheckCircle2, ShieldOff,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { bulkAction } from '../lib/bulkAction';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror the /api/posture + /api/posture/findings response shapes)
// ─────────────────────────────────────────────────────────────────────────────

type Dimension = 'identity' | 'enforcement' | 'spend' | 'auditability' | 'approval' | 'data_protection';
type FindingStatus = 'open' | 'drafted' | 'resolved' | 'snoozed' | 'accepted_risk';
type Severity = 'critical' | 'high' | 'medium' | 'low';

interface DimensionScore { dimension: Dimension; score: number; weight: number }
interface PostureFix { type: string; policyType?: string; rules?: unknown; deepLink?: string; actionIds?: string[]; proposalId?: string }
interface Finding {
  key: string;
  dimension: Dimension;
  severity: Severity;
  title: string;
  evidence: { observedCount: number; exampleActionIds: string[] };
  statusMeta?: { actor: string | null; note: string | null; updatedAt: string | null };
  scoreDelta: number;
  fix: PostureFix;
  status: FindingStatus;
}
interface PostureResponse {
  score: number;
  status: 'healthy' | 'needs_attention' | 'at_risk';
  cappedBy: 'incident' | null;
  dimensions: DimensionScore[];
  summary: { totalUnits: number; openFindings: number; pointsRecoverable: number };
  snapshots: { score: number; createdAt: string | null }[];
  snapshotTs: string | null;
}
interface FindingsResponse {
  findings: Finding[];
  riskAccepted: Finding[];
  counts: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentation metadata (token-first — no hardcoded hex)
// ─────────────────────────────────────────────────────────────────────────────

const ATTENTION_THRESHOLD = 70; // a dimension below this needs attention (orange = signal)

const STATUS_META: Record<PostureResponse['status'], { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  healthy: { label: 'Healthy', cls: 'text-success', Icon: ShieldCheck },
  needs_attention: { label: 'Needs attention', cls: 'text-warning', Icon: ShieldAlert },
  at_risk: { label: 'At risk', cls: 'text-error', Icon: ShieldX },
};

const DIMENSION_LABEL: Record<Dimension, string> = {
  identity: 'Identity',
  enforcement: 'Enforcement',
  spend: 'Spend',
  auditability: 'Audit',
  approval: 'Approval',
  data_protection: 'Data',
};
const DIMENSION_ORDER: Dimension[] = ['identity', 'enforcement', 'spend', 'auditability', 'approval', 'data_protection'];

const SEVERITY_META: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'Critical', cls: 'bg-error-subtle text-error border-error/20' },
  high: { label: 'High', cls: 'bg-warning-subtle text-warning border-warning/20' },
  medium: { label: 'Medium', cls: 'bg-info-subtle text-info border-info/20' },
  low: { label: 'Low', cls: 'bg-surface-tertiary text-secondary border-border-hover' },
};

const STATUS_BADGE: Partial<Record<FindingStatus, { label: string; cls: string }>> = {
  drafted: { label: 'Draft created', cls: 'bg-info-subtle text-info border-info/20' },
  snoozed: { label: 'Snoozed', cls: 'bg-surface-tertiary text-tertiary border-border-hover' },
  accepted_risk: { label: 'Risk accepted', cls: 'bg-surface-tertiary text-tertiary border-border-hover' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline — inline SVG, token-driven via currentColor (no hardcoded hex)
// ─────────────────────────────────────────────────────────────────────────────

function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;
  const w = 120, h = 32, pad = 2;
  const max = Math.max(100, ...points), min = Math.min(0, ...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1]![0].toFixed(1)},${h - pad} L${coords[0]![0].toFixed(1)},${h - pad} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true" role="img">
      <path d={area} fill="currentColor" opacity={0.1} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Score hero
// ─────────────────────────────────────────────────────────────────────────────

function ScoreHero({ data }: { data: PostureResponse }) {
  const meta = STATUS_META[data.status] ?? STATUS_META.needs_attention;
  const trend = [...data.snapshots].reverse().map((s) => s.score); // API is newest-first; sparkline wants oldest-first
  const recoverable = Math.round(data.summary?.pointsRecoverable ?? 0);
  const criticalGaps = data.dimensions.filter((d) => d.score < ATTENTION_THRESHOLD).length;
  const StatusIcon = meta.Icon;

  return (
    <div className="rounded-xl border border-border bg-surface-secondary p-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-5xl font-semibold tabular-nums text-primary" aria-label={`Posture score ${data.score} out of 100`}>{data.score}</span>
            <span className="text-lg text-tertiary tabular-nums">/ 100</span>
          </div>
          <div className="min-w-0">
            <div className={`flex items-center gap-1.5 text-sm font-medium ${meta.cls}`}>
              <StatusIcon size={16} aria-hidden="true" />
              <span>{meta.label}</span>
            </div>
            <div className="mt-0.5 text-xs text-tertiary">
              <span className="tabular-nums">{criticalGaps}</span> {criticalGaps === 1 ? 'dimension needs' : 'dimensions need'} attention
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          {trend.length >= 2 && (
            <div className="text-tertiary" role="img" aria-label={`Recent score trend, latest ${data.score}`}>
              <Sparkline points={trend} />
            </div>
          )}
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums text-primary">+{recoverable}</div>
            <div className="text-[11px] text-tertiary">points recoverable</div>
          </div>
        </div>
      </div>

      {data.cappedBy === 'incident' && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Score capped — an ungoverned high-risk action reached <span className="font-mono">allow</span> in the last 7 days. Govern the leak to lift the cap.</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension row
// ─────────────────────────────────────────────────────────────────────────────

function DimensionCard({ dim }: { dim: DimensionScore }) {
  const needsAttention = dim.score < ATTENTION_THRESHOLD;
  return (
    <div
      className={`rounded-lg border bg-surface-secondary p-3 ${needsAttention ? 'border-brand/30' : 'border-border'}`}
      data-attention={needsAttention ? 'true' : 'false'}
      role="group"
      aria-label={`${DIMENSION_LABEL[dim.dimension]} ${dim.score} of 100${needsAttention ? ', needs attention' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">{DIMENSION_LABEL[dim.dimension]}</span>
        {needsAttention && <AlertTriangle size={11} className="text-brand" aria-hidden="true" />}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums text-primary">{dim.score}</div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-tertiary" role="presentation" aria-hidden="true">
        <div
          className={`h-full rounded-full ${needsAttention ? 'bg-brand' : 'bg-zinc-500'}`}
          style={{ width: `${Math.max(0, Math.min(100, dim.score))}%` }}
        />
      </div>
    </div>
  );
}

function DimensionRow({ dimensions }: { dimensions: DimensionScore[] }) {
  const byKey = new Map(dimensions.map((d) => [d.dimension, d]));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {DIMENSION_ORDER.map((d) => {
        const dim = byKey.get(d) ?? { dimension: d, score: 100, weight: 0 };
        return <DimensionCard key={d} dim={dim} />;
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Findings queue
// ─────────────────────────────────────────────────────────────────────────────

function evidenceLine(f: Finding): string {
  const n = f.evidence.observedCount;
  const noun = n === 1 ? 'observation' : 'observations';
  if (f.fix.type === 'create_policy_draft') {
    return `${n} ${noun} · no firing ${f.fix.policyType ?? 'policy'} · draft ready`;
  }
  if (f.fix.type === 'review_incident') return `${n} ungoverned ${n === 1 ? 'action' : 'actions'} reached allow`;
  if (f.fix.type === 'view_live_canary') return `${n} public ${n === 1 ? 'surface' : 'surfaces'} failing on the live hosts`;
  return `${n} ${noun}`;
}

function FindingRow({
  f,
  onReview,
  selected,
  onToggleSelect,
}: {
  f: Finding;
  onReview: (f: Finding) => void;
  selected: boolean;
  onToggleSelect: (e: MouseEvent) => void;
}) {
  const sev = SEVERITY_META[f.severity];
  const badge = STATUS_BADGE[f.status];
  return (
    <div className="flex items-start gap-3 border-t border-border px-4 py-3 first:border-t-0" data-entity-type="postureFinding" data-entity-id={f.key} data-entity-status={f.status}>
      <span className="mt-0.5 shrink-0">
        <SelectCheckbox checked={selected} onToggle={onToggleSelect} label={`Select ${f.title}`} size={15} />
      </span>
      <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sev.cls}`}>
        {sev.label}
      </span>
      <span className="mt-0.5 shrink-0 text-sm font-semibold tabular-nums text-primary" aria-label={`${f.scoreDelta} points recoverable`}>+{f.scoreDelta}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-primary">{f.title}</span>
          {badge && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>}
        </div>
        <div className="mt-0.5 text-xs text-tertiary">{evidenceLine(f)}</div>
      </div>
      <button
        type="button"
        onClick={() => onReview(f)}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-secondary transition-colors hover:border-border-hover hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        {f.fix.type === 'create_policy_draft' ? 'Review fix' : 'Review'}
        <ChevronRight size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve panel (modal) — honest draft preview
// ─────────────────────────────────────────────────────────────────────────────

function ResolvePanel({ finding, busy, onClose, onResolve }: {
  finding: Finding;
  busy: boolean;
  onClose: () => void;
  onResolve: (action: 'create_draft' | 'snooze' | 'accept_risk', note: string) => void;
}) {
  const [note, setNote] = useState('');
  const canDraft = finding.fix.type === 'create_policy_draft';
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus management (WCAG 2.4.3): move focus into the dialog on open, trap Tab
  // within it, and restore focus to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      trigger?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resolve-title"
        className="w-full max-w-lg rounded-xl border border-border bg-surface-elevated p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">Resolve finding</div>
            <h2 id="resolve-title" className="mt-1 text-sm font-medium text-primary">{finding.title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded p-1 text-tertiary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
            <X size={16} />
          </button>
        </div>

        {finding.fix.type === 'review_incident' && (
          <div className="mt-4 rounded-lg border border-border bg-surface-secondary p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">
              Tightening proposal
            </div>
            <p className="mt-2 text-xs text-secondary">
              {finding.fix.proposalId ? (
                <>This pattern is mirrored as a tightening proposal — ratifying it there creates the require_approval policy in one click and resolves this finding.</>
              ) : (
                <>These decisions carry no action type, so no action-type policy can govern them — review the evidence directly.</>
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {finding.fix.proposalId && (
                <Link href="/policies#tightening" className="text-brand hover:underline">
                  Review tightening proposal &rsaquo;
                </Link>
              )}
              <Link href={finding.fix.deepLink ?? '/decisions'} className="text-brand hover:underline">
                Evidence in the decisions ledger &rsaquo;
              </Link>
            </div>
          </div>
        )}

        {finding.fix.type === 'view_live_canary' && (
          <div className="mt-4 rounded-lg border border-border bg-surface-secondary p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">
              Live host canary
            </div>
            <p className="mt-2 text-xs text-secondary">
              The scheduled canary probes the production hosts as a real client. Its latest
              run found public surfaces not answering their expected contract — the
              per-probe verdicts are on the setup page.
            </p>
            <div className="mt-2 text-xs">
              <Link href={finding.fix.deepLink ?? '/setup#live-canary'} className="text-brand hover:underline">
                Open the live canary report &rsaquo;
              </Link>
            </div>
          </div>
        )}

        {canDraft && (
          <div className="mt-4 rounded-lg border border-border bg-surface-secondary p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-tertiary">
              <FileText size={12} aria-hidden="true" /> Draft preview
            </div>
            <div className="mt-2 text-xs text-secondary">
              Guard policy type <span className="font-mono text-primary">{finding.fix.policyType}</span>
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-surface-primary p-2 text-[11px] leading-relaxed text-secondary">
              {JSON.stringify(finding.fix.rules ?? {}, null, 2)}
            </pre>
            <p className="mt-3 text-xs text-tertiary">
              Creating this draft inserts an <span className="text-secondary">inactive</span> policy. It does <span className="text-secondary">not</span> change your posture score. Activate it at <span className="font-mono">/policies</span> and rescan once it fires to recover the points.
            </p>
          </div>
        )}

        <label className="mt-4 block text-[10px] font-semibold uppercase tracking-widest text-tertiary" htmlFor="resolve-note">Note (optional)</label>
        <input
          id="resolve-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why are you resolving this?"
          className="mt-1.5 w-full rounded-md border border-border bg-surface-primary px-3 py-2 text-sm text-primary placeholder:text-disabled focus:border-border-active focus:outline-none"
        />

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => onResolve('snooze', note)} className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:opacity-50">
            <Clock size={12} className="-mt-0.5 mr-1 inline" aria-hidden="true" />Snooze
          </button>
          <button type="button" disabled={busy} onClick={() => onResolve('accept_risk', note)} className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:opacity-50">
            Accept risk
          </button>
          {canDraft && (
            <button type="button" disabled={busy} onClick={() => onResolve('create_draft', note)} className="rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-50">
              {busy ? 'Creating…' : 'Create draft'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk-accepted ledger
// ─────────────────────────────────────────────────────────────────────────────

function RiskAcceptedLedger({ items }: { items: Finding[] }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-xl border border-border bg-surface-secondary">
      <summary className="cursor-pointer list-none rounded-lg px-4 py-3 text-sm text-secondary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">Risk accepted</span>
        <span className="ml-2 tabular-nums text-tertiary">({items.length})</span>
      </summary>
      <div className="border-t border-border">
        {items.map((f) => {
          const badge = STATUS_BADGE[f.status];
          // v3.1: quieting a finding is an attributed decision, not a disappearance.
          const meta = f.statusMeta;
          const when = meta?.updatedAt ? new Date(meta.updatedAt).toLocaleDateString() : null;
          const attribution = [meta?.actor, when].filter(Boolean).join(' · ');
          return (
            <div key={f.key} className="flex items-start gap-3 border-t border-border px-4 py-2.5 text-xs first:border-t-0">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-tertiary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-secondary">{f.title}</span>
                {(attribution || meta?.note) && (
                  <span className="mt-0.5 block truncate text-tertiary">
                    {attribution}
                    {attribution && meta?.note ? ' — ' : ''}
                    {meta?.note ?? ''}
                  </span>
                )}
              </div>
              {badge && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PosturePage() {
  const [posture, setPosture] = useState<PostureResponse | null>(null);
  const [findings, setFindings] = useState<FindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [active, setActive] = useState<Finding | null>(null);
  const [resolving, setResolving] = useState(false);
  const openFindings = findings?.findings ?? [];
  const selection = useSelection<Finding>(openFindings, (f) => f.key);
  useSelectAllHotkey(selection.toggleAll);

  const load = useCallback(async () => {
    try {
      const [pRes, fRes] = await Promise.all([
        fetch('/api/posture'),
        fetch('/api/posture/findings'),
      ]);
      if (pRes.ok) setPosture(await pRes.json());
      if (fRes.ok) setFindings(await fRes.json());
    } catch (err) {
      console.error('Failed to load posture:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      await fetch('/api/posture/scan', { method: 'POST' });
      await load();
    } catch (err) {
      console.error('Rescan failed:', err);
    } finally {
      setScanning(false);
    }
  }, [load]);

  const resolve = useCallback(async (action: 'create_draft' | 'snooze' | 'accept_risk', note: string) => {
    if (!active) return;
    setResolving(true);
    try {
      await fetch(`/api/posture/findings/${encodeURIComponent(active.key)}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note: note || undefined }),
      });
      setActive(null);
      await load(); // refetch — the score must NOT move on create_draft (honesty property, visible on-page)
    } catch (err) {
      console.error('Resolve failed:', err);
    } finally {
      setResolving(false);
    }
  }, [active, load]);

  async function bulkResolve(action: 'snooze' | 'accept_risk') {
    if (selection.count === 0) return;
    const { ok } = await bulkAction(selection.selectedIds, (key) =>
      fetch(`/api/posture/findings/${encodeURIComponent(key)}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      }),
    );
    selection.clear();
    if (ok.length) await load();
  }

  return (
    <PageLayout agentFilter={false}
      title="Governance posture"
      subtitle="One gaming-resistant score for what your fleet can do versus what it actually governs"
      breadcrumbs={['Governance', 'Posture']}
      maturity="beta"
      actions={
        <>
          <button
            type="button"
            onClick={rescan}
            disabled={scanning || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
            {scanning ? 'Scanning…' : 'Rescan'}
          </button>
          <BulkActionBar
            count={selection.count}
            actions={[
              { id: 'snooze', label: 'Snooze', icon: Clock, onClick: () => bulkResolve('snooze') },
              { id: 'accept', label: 'Accept risk', icon: ShieldOff, onClick: () => bulkResolve('accept_risk'), danger: true },
            ]}
            onClear={selection.clear}
          />
        </>
      }
    >
      {loading && !posture ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : posture ? (
        <div className="space-y-6">
          <ScoreHero data={posture} />
          <DimensionRow dimensions={posture.dimensions} />

          <div className="rounded-xl border border-border bg-surface-secondary">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-2">
                {openFindings.length > 0 && (
                  <SelectCheckbox checked={selection.allSelected} onToggle={() => selection.toggleAll()} label="Select all findings" size={15} />
                )}
                <span className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">Next — prioritized remediation queue</span>
              </span>
              <span className="text-xs tabular-nums text-tertiary">{findings?.findings.length ?? 0} open</span>
            </div>
            {findings && findings.findings.length > 0 ? (
              <div className="border-t border-border">
                {findings.findings.map((f) => (
                  <FindingRow
                    key={f.key}
                    f={f}
                    onReview={setActive}
                    selected={selection.isSelected(f.key)}
                    onToggleSelect={(e) => {
                      e.stopPropagation();
                      selection.selectClick(f.key, e.shiftKey);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="border-t border-border px-4 py-10 text-center text-sm text-tertiary">
                <ShieldCheck size={20} className="mx-auto mb-2 text-success" aria-hidden="true" />
                Queue is clear — no open coverage gaps.
              </div>
            )}
          </div>

          {findings && <RiskAcceptedLedger items={findings.riskAccepted} />}
        </div>
      ) : (
        <div className="text-sm text-error">Failed to load posture.</div>
      )}

      {active && (
        <ResolvePanel
          finding={active}
          busy={resolving}
          onClose={() => setActive(null)}
          onResolve={resolve}
        />
      )}
    </PageLayout>
  );
}

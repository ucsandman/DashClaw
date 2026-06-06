'use client';

import { useEffect, useState } from 'react';
import { Check, Eye, PauseCircle, Ban, Info } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { previewMode, importMode } from '../lib/modesClient';
import type { PolicyModeSummary, ModePreview } from '../lib/modesClient';

const DECISION_META: Record<string, { variant: string; label: string }> = {
  allow: { variant: 'success', label: 'Allow' },
  warn: { variant: 'info', label: 'Warn' },
  require_approval: { variant: 'warning', label: 'Approval' },
  block: { variant: 'error', label: 'Block' },
};

const GROUPS: Array<{ key: 'allows' | 'warns' | 'requiresApproval' | 'blocks'; title: string; icon: typeof Check; tone: string }> = [
  { key: 'allows', title: 'Allows', icon: Check, tone: 'text-success' },
  { key: 'warns', title: 'Warns — records & surfaces', icon: Eye, tone: 'text-info' },
  { key: 'requiresApproval', title: 'Requires approval — pauses', icon: PauseCircle, tone: 'text-warning' },
  { key: 'blocks', title: 'Blocks — denies', icon: Ban, tone: 'text-error' },
];

interface ModeDetailPanelProps {
  mode: PolicyModeSummary;
  isAdmin: boolean;
  settled: boolean;
  onApplied: () => void;
}

export default function ModeDetailPanel({ mode, isAdmin, settled, onApplied }: ModeDetailPanelProps) {
  const [preview, setPreview] = useState<ModePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setApplyMsg(null);
    setApplyErr(null);
    previewMode(mode.id)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode.id]);

  const handleApply = async () => {
    setApplying(true);
    setApplyErr(null);
    setApplyMsg(null);
    try {
      const result = await importMode(mode.id);
      const parts = [`${result.imported} applied`];
      if (result.skipped > 0) parts.push(`${result.skipped} already present`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
      setApplyMsg(parts.join(' · '));
      onApplied();
    } catch (e) {
      setApplyErr((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-secondary p-5">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{mode.name}</h3>
        <span className="text-[11px] italic text-tertiary">{mode.uxPromise}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-secondary">{mode.description}</p>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-border py-2 text-[11px] text-tertiary">
        <span><span className="text-info">warn</span> = record / surface</span>
        <span aria-hidden="true" className="text-zinc-700">&middot;</span>
        <span><span className="text-warning">require approval</span> = pause</span>
        <span aria-hidden="true" className="text-zinc-700">&middot;</span>
        <span><span className="text-error">block</span> = deny</span>
      </div>

      {/* Behavior breakdown */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {GROUPS.map((g) => {
          const items = mode[g.key];
          if (!items || items.length === 0) return null;
          const Icon = g.icon;
          return (
            <div key={g.key}>
              <div className="flex items-center gap-1.5">
                <Icon size={14} className={g.tone} aria-hidden="true" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">{g.title}</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {items.map((item, i) => (
                  <li key={i} className="text-xs leading-relaxed text-secondary">{item}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Tool-visibility notes */}
      {mode.toolVisibilityNotes.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface-tertiary p-3">
          <div className="flex items-center gap-1.5">
            <Info size={13} className="text-tertiary" aria-hidden="true" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">What DashClaw can see</span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {mode.toolVisibilityNotes.map((note, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-tertiary">{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Generated policies */}
      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">
          Generated policies{preview ? ` · ${preview.policies.length}` : ''}
        </div>
        {loading && (
          <div className="mt-2 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-error">Could not load preview: {error}</p>}
        {preview && !loading && (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {preview.policies.map((p, i) => {
              const meta = DECISION_META[p.decision] ?? { variant: 'default', label: p.decision };
              return (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs text-secondary">{p.name}</div>
                    <div className="font-mono text-[10px] text-tertiary">{p.policy_type}</div>
                  </div>
                  <Badge variant={meta.variant} size="xs">{meta.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Friction preview */}
      {preview && !loading && (
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">Friction preview</div>
          {preview.friction.available ? (
            <div className="mt-2 rounded-lg border border-border bg-surface-tertiary p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-secondary">
                <span><span className="font-semibold text-success">{preview.friction.summary.allow}</span> allow</span>
                <span aria-hidden="true" className="text-zinc-700">&middot;</span>
                <span><span className="font-semibold text-info">{preview.friction.summary.warn}</span> warn</span>
                <span aria-hidden="true" className="text-zinc-700">&middot;</span>
                <span><span className="font-semibold text-warning">{preview.friction.summary.require_approval}</span> approval</span>
                <span aria-hidden="true" className="text-zinc-700">&middot;</span>
                <span><span className="font-semibold text-error">{preview.friction.summary.block}</span> block</span>
              </div>
              <p className="mt-1.5 text-[11px] text-tertiary">
                Replayed against {preview.friction.sample_size} action{preview.friction.sample_size === 1 ? '' : 's'} from the last {preview.friction.window_days} days.
                {preview.friction.excluded_policy_types.length > 0 && (
                  <> Excluded (not deterministically simulable): {preview.friction.excluded_policy_types.join(', ')}.</>
                )}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-tertiary">
              Historical action simulation is not available yet. {preview.friction.reason}
            </p>
          )}
        </div>
      )}

      {/* Apply */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleApply}
          disabled={!isAdmin || applying || loading}
          className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/50 hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply this mode'}
        </button>
        {settled && !isAdmin && (
          <span className="text-xs text-tertiary">Admin access required to apply a mode.</span>
        )}
        {applyMsg && <span className="text-xs text-success">{applyMsg}</span>}
        {applyErr && <span className="text-xs text-error">{applyErr}</span>}
      </div>
    </div>
  );
}

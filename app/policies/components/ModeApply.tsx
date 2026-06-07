'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Check, Eye, PauseCircle, Ban, Sparkles } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { useEffectiveRole } from '../../hooks/useEffectiveRole';
import { fetchModes, previewMode, importMode } from '../lib/modesClient';
import type { PolicyModeSummary, ModePreview } from '../lib/modesClient';
import AgentScopePicker from './AgentScopePicker';
import ModeCard from './ModeCard';
import Disclosure from './Disclosure';

/** The recommended default mode for the guided front door. */
export const RECOMMENDED_MODE_ID = 'claude-code';

const LEVEL: Record<string, { label: string; dot: string }> = {
  low: { label: 'Low interruption', dot: 'bg-success' },
  medium: { label: 'Medium interruption', dot: 'bg-warning' },
  high: { label: 'High interruption', dot: 'bg-error' },
};
const LEVEL_FALLBACK = { label: 'Medium interruption', dot: 'bg-warning' };

const GROUPS: Array<{ key: 'allows' | 'warns' | 'requiresApproval' | 'blocks'; title: string; gloss: string; icon: typeof Check; tone: string }> = [
  { key: 'allows', title: 'Allows', gloss: 'runs without friction', icon: Check, tone: 'text-success' },
  { key: 'warns', title: 'Warns', gloss: 'records and surfaces', icon: Eye, tone: 'text-info' },
  { key: 'requiresApproval', title: 'Requires approval', gloss: 'pauses for a human', icon: PauseCircle, tone: 'text-warning' },
  { key: 'blocks', title: 'Blocks', gloss: 'denies outright', icon: Ban, tone: 'text-error' },
];

const X402_TYPE = 'x402_spend_limit';

async function patchPolicy(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/policies', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Update failed (${res.status})`);
  }
}

interface ModeApplyProps {
  /** Mode to recommend / preselect. Defaults to Claude Code Mode. */
  defaultModeId?: string;
  /** Fired after a mode is applied (and any scope/cap overrides land). */
  onApplied?: () => void;
}

/**
 * The guided apply surface: recommends one mode, shows its compiled
 * allow/warn/require-approval/block behavior plus a real interruption-noise
 * forecast, collects scope + spend cap inline, and applies it in a single
 * action. Other modes live behind a disclosure so the recommendation stays the
 * lede. Reuses the modes engine (modesClient), AgentScopePicker, and ModeCard.
 */
export default function ModeApply({ defaultModeId = RECOMMENDED_MODE_ID, onApplied }: ModeApplyProps) {
  const { isAdmin, settled } = useEffectiveRole();
  const capFieldId = useId();

  const [modes, setModes] = useState<PolicyModeSummary[]>([]);
  const [selectedId, setSelectedId] = useState(defaultModeId);
  const [preview, setPreview] = useState<ModePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [capInput, setCapInput] = useState('');
  const [capTouched, setCapTouched] = useState(false);

  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  useEffect(() => {
    fetchModes().then(setModes).catch(() => { /* preview drives the primary error surface */ });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingPreview(true);
    setError(null);
    setApplyMsg(null);
    setApplyErr(null);
    setCapTouched(false);
    previewMode(selectedId)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        const x402 = p.policies.find((pol) => pol.policy_type === X402_TYPE);
        const cap = x402 ? Number((x402.rules as { max_spend_usd?: number }).max_spend_usd) : NaN;
        setCapInput(Number.isFinite(cap) ? String(cap) : '');
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const x402Preview = useMemo(
    () => preview?.policies.find((p) => p.policy_type === X402_TYPE) ?? null,
    [preview],
  );
  const defaultCap = x402Preview ? Number((x402Preview.rules as { max_spend_usd?: number }).max_spend_usd) : null;
  const selectedMode = preview?.mode ?? modes.find((m) => m.id === selectedId) ?? null;
  const level = (selectedMode ? LEVEL[selectedMode.interruptionLevel] : undefined) ?? LEVEL_FALLBACK;

  const handleApply = useCallback(async () => {
    if (!preview) return;
    setApplying(true);
    setApplyErr(null);
    setApplyMsg(null);
    try {
      const result = await importMode(selectedId);
      const created = (result.policies as Array<{ id: string; policy_type: string }>) ?? [];

      // Scope: only narrow when specific agents were chosen (empty = all agents).
      if (agentIds.length > 0 && created.length > 0) {
        await Promise.all(
          created.map((p) => patchPolicy({ id: p.id, agent_ids: JSON.stringify(agentIds) })),
        );
      }

      // Spend cap: only patch the x402 policy when the operator changed the value.
      const parsedCap = parseFloat(capInput);
      if (capTouched && x402Preview && Number.isFinite(parsedCap) && parsedCap !== defaultCap) {
        const x402Created = created.find((p) => p.policy_type === X402_TYPE);
        if (x402Created) {
          const nextRules = { ...(x402Preview.rules as Record<string, unknown>), max_spend_usd: parsedCap };
          await patchPolicy({ id: x402Created.id, rules: JSON.stringify(nextRules) });
        }
      }

      const parts = [`${result.imported} applied`];
      if (result.skipped > 0) parts.push(`${result.skipped} already present`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
      setApplyMsg(parts.join(' · '));
      onApplied?.();
    } catch (e) {
      setApplyErr((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [preview, selectedId, agentIds, capInput, capTouched, x402Preview, defaultCap, onApplied]);

  const isRecommended = selectedId === RECOMMENDED_MODE_ID;

  return (
    <div className="rounded-xl border border-border bg-surface-secondary p-5">
      {/* Recommendation header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {isRecommended && (
            <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-brand">
              <Sparkles size={11} aria-hidden="true" /> Recommended
            </span>
          )}
          <h3 className="text-base font-semibold text-white">{selectedMode?.name ?? 'Loading mode…'}</h3>
          {selectedMode && <p className="mt-1 max-w-xl text-xs leading-relaxed text-secondary">{selectedMode.description}</p>}
        </div>
        {selectedMode && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-secondary">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${level.dot}`} />
            {level.label}
          </span>
        )}
      </div>

      {/* Compiled behavior */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">What this mode enforces</span>
          {preview && (
            <span className="text-[11px] tabular-nums text-tertiary">
              <span className="text-white">{preview.summary.total}</span> rules ·{' '}
              <span className="text-info">{preview.summary.warn}</span> warn ·{' '}
              <span className="text-warning">{preview.summary.require_approval}</span> approval ·{' '}
              <span className="text-error">{preview.summary.block}</span> block
            </span>
          )}
        </div>

        {loadingPreview && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        )}
        {error && !loadingPreview && (
          <p className="mt-3 text-xs text-error">Could not load this mode: {error}</p>
        )}
        {preview && !loadingPreview && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {GROUPS.map((g) => {
              const items = preview.mode[g.key];
              if (!items || items.length === 0) return null;
              const Icon = g.icon;
              return (
                <div key={g.key}>
                  <div className="flex items-center gap-1.5">
                    <Icon size={14} className={g.tone} aria-hidden="true" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">{g.title}</span>
                    <span className="text-[11px] text-disabled">{g.gloss}</span>
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
        )}
      </div>

      {/* Interruption-noise forecast */}
      {preview && !loadingPreview && (
        <div className="mt-4 border-t border-border pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">Interruption forecast</span>
          {preview.friction.available ? (
            <div className="mt-2 rounded-lg border border-border bg-surface-tertiary p-3">
              <p className="text-xs text-secondary">
                Replayed against your last {preview.friction.window_days} days of activity, this mode would have paused{' '}
                <span className="font-semibold tabular-nums text-warning">
                  {preview.friction.summary.warn + preview.friction.summary.require_approval}
                </span>{' '}
                of{' '}
                <span className="font-semibold tabular-nums text-white">{preview.friction.sample_size}</span> actions
                {preview.friction.summary.block > 0 && (
                  <> and blocked <span className="font-semibold tabular-nums text-error">{preview.friction.summary.block}</span></>
                )}
                .
              </p>
              {preview.friction.excluded_policy_types.length > 0 && (
                <p className="mt-1.5 text-[11px] text-tertiary">
                  Excluded (not deterministically simulable): {preview.friction.excluded_policy_types.join(', ')}.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-tertiary">
              No interruption forecast yet. {preview.friction.reason} This mode is rated{' '}
              <span className="text-secondary">{level.label.toLowerCase()}</span>.
            </p>
          )}
        </div>
      )}

      {/* Inline required inputs: scope + spend cap */}
      <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <AgentScopePicker agentIds={agentIds} onChange={setAgentIds} />
        <div>
          <label htmlFor={capFieldId} className="mb-2 block text-[10px] uppercase tracking-widest text-tertiary">
            Spend cap (paid actions)
          </label>
          {x402Preview ? (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 focus-within:border-border-active">
                <span className="text-xs text-tertiary">$</span>
                <input
                  id={capFieldId}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={capInput}
                  onChange={(e) => { setCapInput(e.target.value); setCapTouched(true); }}
                  className="w-full bg-transparent text-xs tabular-nums text-white outline-none placeholder:text-disabled"
                  placeholder={defaultCap != null ? String(defaultCap) : '0.10'}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-tertiary">Paid (x402) actions over this amount pause for approval.</p>
            </>
          ) : (
            <p className="text-xs text-tertiary">This mode does not gate paid (x402) spend.</p>
          )}
        </div>
      </div>

      {/* Single apply action */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleApply}
          disabled={!isAdmin || applying || loadingPreview || !preview}
          className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-xs font-medium text-brand transition-colors hover:border-brand/60 hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying ? 'Applying…' : `Apply ${selectedMode?.name ?? 'mode'}`}
        </button>
        {settled && !isAdmin && <span className="text-xs text-tertiary">Admin access required to apply a mode.</span>}
        {applyMsg && <span className="text-xs text-success">{applyMsg}</span>}
        {applyErr && <span className="text-xs text-error">{applyErr}</span>}
      </div>

      {/* Other modes — recommendation stays the lede */}
      {modes.length > 1 && (
        <div className="mt-4 border-t border-border pt-4">
          <Disclosure
            tone="plain"
            summary={`Choose a different mode (${modes.length})`}
            hint="Each mode compiles to a preview-able pack of guard rules. Applying is additive."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {modes.map((m) => (
                <ModeCard key={m.id} mode={m} selected={m.id === selectedId} onSelect={() => setSelectedId(m.id)} />
              ))}
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * Pack Gallery — the browsable catalog of policy packs (/policies/packs).
 * Cards + two filter rows (audience, strictness); clicking a card opens a
 * drawer with the pack's policies, a simulate-against-my-history preview, and
 * a one-click install. Data: GET /api/policies/templates; preview: POST
 * /api/policies/simulate { pack }; install: POST /api/policies/import { pack }.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, FlaskConical, Layers, Package } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

type Bucket = 'block' | 'require_approval' | 'warn' | 'allow';

interface PackPolicyRow {
  name: string;
  policy_type: string;
  rules_summary: string;
  bucket: Bucket;
}

interface PackTemplate {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  audience: string;
  audience_label: string;
  strictness: 'permissive' | 'balanced' | 'strict';
  strictness_label: string;
  stack_after: string | null;
  installed: boolean;
  policy_count: number;
  policies: PackPolicyRow[];
}

interface PackSimulation {
  summary: { total: number; matches?: number; block?: number; warn?: number; require_approval?: number; allow?: number };
  per_policy?: Array<{ name: string; policy_type: string; matches: number; block: number; warn: number; require_approval: number }>;
  matches: Array<{ goal: string; agent_name: string; simulated_action: string; matched_policy?: string }>;
  matches_truncated?: boolean;
  sample_size: number;
  window_days: number;
  message?: string;
  error?: string;
}

const BUCKET_META: Record<Bucket, { label: string; cls: string }> = {
  block: { label: 'Block', cls: 'text-error border-status-error/30' },
  require_approval: { label: 'Approve', cls: 'text-brand border-brand/30' },
  warn: { label: 'Warn', cls: 'text-warning border-status-warning/30' },
  allow: { label: 'Grant', cls: 'text-success border-status-success/30' },
};

const STRICTNESS_CLS: Record<string, string> = {
  permissive: 'text-success border-border',
  balanced: 'text-secondary border-border',
  strict: 'text-warning border-border',
};

function BucketChip({ bucket }: { bucket: Bucket }) {
  const meta = BUCKET_META[bucket] ?? BUCKET_META.warn;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

// Per-pack bucket tallies for the card footer.
function bucketCounts(policies: PackPolicyRow[]) {
  const counts = { block: 0, require_approval: 0, warn: 0, allow: 0 };
  for (const p of policies) counts[p.bucket] = (counts[p.bucket] ?? 0) + 1;
  return counts;
}

export default function PackGallery() {
  const [templates, setTemplates] = useState<PackTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<string>('all');
  const [strictness, setStrictness] = useState<string>('all');
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/policies/templates');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load packs (${res.status})`);
      setTemplates(data.templates || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const audiences = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of templates) if (!seen.has(t.audience)) seen.set(t.audience, t.audience_label);
    return [...seen.entries()];
  }, [templates]);

  const filtered = useMemo(() => templates.filter((t) =>
    (audience === 'all' || t.audience === audience) &&
    (strictness === 'all' || t.strictness === strictness),
  ), [templates, audience, strictness]);

  const drawerPack = templates.find((t) => t.id === drawerId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={SECTION_LABEL}>Audience</span>
          <FilterChip active={audience === 'all'} onClick={() => setAudience('all')}>All</FilterChip>
          {audiences.map(([value, label]) => (
            <FilterChip key={value} active={audience === value} onClick={() => setAudience(value)}>{label}</FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={SECTION_LABEL}>Strictness</span>
          <FilterChip active={strictness === 'all'} onClick={() => setStrictness('all')}>All</FilterChip>
          {(['permissive', 'balanced', 'strict'] as const).map((value) => (
            <FilterChip key={value} active={strictness === value} onClick={() => setStrictness(value)}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-secondary p-4 text-xs text-error">
          Couldn&apos;t load the pack catalog: {error}{' '}
          <button className="ml-2 text-secondary underline underline-offset-2 hover:text-primary" onClick={() => { setLoading(true); fetchTemplates(); }}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No packs match"
          description="Clear a filter to see the full catalog."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => <PackCard key={t.id} pack={t} onOpen={() => setDrawerId(t.id)} />)}
        </div>
      )}

      <p className="text-xs text-tertiary">
        Packs are starting points, not certified controls. Installing a pack adds its rules to your ledger —
        rules you already have (same name) are skipped, and everything stays editable in the{' '}
        <Link href="/policies" className="text-secondary underline underline-offset-2 hover:text-primary">ledger</Link>.
      </p>

      <PackDrawer
        pack={drawerPack}
        allPacks={templates}
        onClose={() => setDrawerId(null)}
        onJump={(id) => setDrawerId(id)}
        onInstalled={fetchTemplates}
      />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors motion-reduce:transition-none ${
        active ? 'border-border-active bg-white/5 text-primary' : 'border-border text-tertiary hover:text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function PackCard({ pack, onOpen }: { pack: PackTemplate; onOpen: () => void }) {
  const counts = bucketCounts(pack.policies);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-entity-type="policy-pack"
      data-entity-id={pack.id}
      className="flex flex-col gap-2 rounded-xl border border-border bg-secondary p-4 text-left transition-colors hover:border-hover motion-reduce:transition-none"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-primary">{pack.name}</span>
        {pack.installed ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-status-success/30 px-2 py-0.5 text-[11px] uppercase tracking-wider text-success">
            <Check size={11} aria-hidden="true" />Installed
          </span>
        ) : (
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${STRICTNESS_CLS[pack.strictness] ?? 'text-tertiary border-border'}`}>
            {pack.strictness_label}
          </span>
        )}
      </span>
      <span className="text-xs font-mono uppercase tracking-wider text-tertiary">{pack.audience_label}</span>
      <span className="text-xs leading-relaxed text-tertiary">{pack.description}</span>
      <span className="mt-auto flex items-center gap-3 pt-1 text-xs tabular-nums text-tertiary">
        <span>{pack.policy_count} {pack.policy_count === 1 ? 'rule' : 'rules'}</span>
        {counts.block > 0 && <span className="text-error">{counts.block} block</span>}
        {counts.require_approval > 0 && <span className="text-brand">{counts.require_approval} approve</span>}
        {counts.warn > 0 && <span className="text-warning">{counts.warn} warn</span>}
        <ChevronRight size={13} className="ml-auto text-tertiary" aria-hidden="true" />
      </span>
    </button>
  );
}

interface PackDrawerProps {
  pack: PackTemplate | null;
  allPacks: PackTemplate[];
  onClose: () => void;
  onJump: (id: string) => void;
  onInstalled: () => void;
}

function PackDrawer({ pack, allPacks, onClose, onJump, onInstalled }: PackDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<PackSimulation | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<
    { imported: number; skipped: number; watched: number; dormant: number } | null
  >(null);
  const [installError, setInstallError] = useState<string | null>(null);

  // Reset per-pack state whenever the drawer switches packs.
  useEffect(() => {
    setSimulation(null);
    setSimulating(false);
    setInstalling(false);
    setInstallResult(null);
    setInstallError(null);
    if (pack) panelRef.current?.focus();
  }, [pack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onClose]);

  const handleSimulate = useCallback(async () => {
    if (!pack) return;
    setSimulating(true);
    setSimulation(null);
    try {
      const res = await fetch('/api/policies/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: pack.id, days: 30 }),
      });
      const data = await res.json().catch(() => ({}));
      setSimulation(res.ok ? data : { error: data.error || 'Preview failed' } as PackSimulation);
    } catch {
      setSimulation({ error: 'Preview failed' } as PackSimulation);
    } finally {
      setSimulating(false);
    }
  }, [pack]);

  const handleInstall = useCallback(async () => {
    if (!pack) return;
    setInstalling(true);
    setInstallError(null);
    setInstallResult(null);
    try {
      const res = await fetch('/api/policies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: pack.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(res.status === 403 ? 'Admin access required to install packs.' : data.error || 'Install failed');
      }
      setInstallResult({
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        watched: data.watched ?? 0,
        // Types with no Watch tier install dormant; `dormant` is newer than the
        // rest of this payload, so read it as optional.
        dormant: data.dormant ?? 0,
      });
      onInstalled();
    } catch (e) {
      setInstallError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  }, [pack, onInstalled]);

  if (!pack) return null;

  const stackPack = pack.stack_after ? allPacks.find((t) => t.id === pack.stack_after) ?? null : null;
  const held = (simulation?.summary?.require_approval ?? 0);
  const blocked = (simulation?.summary?.block ?? 0);
  const warned = (simulation?.summary?.warn ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`${pack.name} pack`}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 motion-safe:animate-[fadeIn_0.2s_ease-out]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-[520px] max-w-full flex-col border-l border-border bg-surface-elevated outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary">{pack.name}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${STRICTNESS_CLS[pack.strictness] ?? 'text-tertiary border-border'}`}>
              {pack.strictness_label}
            </span>
            {pack.installed && (
              <span className="flex items-center gap-1 rounded-full border border-status-success/30 px-2 py-0.5 text-[11px] uppercase tracking-wider text-success">
                <Check size={11} aria-hidden="true" />Installed
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs leading-relaxed text-secondary">{pack.description}</p>
          <p className="mt-1.5 text-xs text-tertiary">Recommended for: {pack.recommended_for}</p>

          {stackPack && !stackPack.installed && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-tertiary">
              <Layers size={13} aria-hidden="true" />
              Works best on top of{' '}
              <button
                type="button"
                onClick={() => onJump(stackPack.id)}
                className="text-secondary underline underline-offset-2 hover:text-primary"
              >
                {stackPack.name}
              </button>
              — install that first.
            </p>
          )}

          {/* Simulate */}
          <div className="mt-4 border-t border-border pt-4">
            <span className={SECTION_LABEL}>What would this pack have done?</span>
            <p className="mt-1 text-xs text-tertiary">
              Dry-runs every rule in the pack against your last 30 days of governed actions. Nothing is installed.
            </p>
            <button
              type="button"
              onClick={handleSimulate}
              disabled={simulating}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-hover hover:text-primary disabled:opacity-50 motion-reduce:transition-none"
            >
              <FlaskConical size={13} aria-hidden="true" />
              {simulating ? 'Previewing…' : 'Preview against my history'}
            </button>

            {simulation?.error && <p className="mt-2 text-xs text-error">{simulation.error}</p>}
            {simulation && !simulation.error && (
              <div className="mt-3 space-y-2">
                {simulation.summary.total === 0 ? (
                  <p className="text-xs text-tertiary">{simulation.message || 'No governed actions in the window yet — connect an agent first.'}</p>
                ) : (
                  <p className="text-xs text-secondary">
                    Of <span className="tabular-nums">{simulation.summary.total}</span> actions in the last{' '}
                    <span className="tabular-nums">{simulation.window_days}</span> days, this pack would have{' '}
                    <span className="tabular-nums text-error">blocked {blocked}</span>,{' '}
                    <span className="tabular-nums text-brand">held {held} for approval</span>, and{' '}
                    <span className="tabular-nums text-warning">warned on {warned}</span>.
                  </p>
                )}
                {(simulation.matches ?? []).slice(0, 8).map((m, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-xs">
                    <span className={`shrink-0 tabular-nums ${m.simulated_action === 'block' ? 'text-error' : m.simulated_action === 'warn' ? 'text-warning' : 'text-brand'}`}>
                      {m.simulated_action === 'require_approval' ? 'approve' : m.simulated_action}
                    </span>
                    <span className="truncate text-secondary" title={m.goal}>{m.goal}</span>
                    <span className="ml-auto shrink-0 text-tertiary">{m.agent_name}</span>
                  </div>
                ))}
                {(simulation.matches?.length ?? 0) > 8 && (
                  <p className="text-xs text-tertiary">…and {(simulation.matches?.length ?? 0) - 8} more{simulation.matches_truncated ? ' (list capped at 50)' : ''}.</p>
                )}
              </div>
            )}
          </div>

          {/* Rules */}
          <div className="mt-4 border-t border-border pt-4">
            <span className={SECTION_LABEL}>{pack.policy_count} {pack.policy_count === 1 ? 'rule' : 'rules'} in this pack</span>
            <ul className="mt-2 divide-y divide-border">
              {pack.policies.map((p) => (
                <li key={p.name} className="flex flex-col gap-1 py-2.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs text-secondary">{p.name}</span>
                    <BucketChip bucket={p.bucket} />
                  </span>
                  <span className="truncate font-mono text-[11px] text-tertiary" title={p.rules_summary}>{p.rules_summary}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer — install */}
        <div className="border-t border-border px-5 py-4">
          {installError && <p className="mb-2 text-xs text-error">{installError}</p>}
          {installResult && (
            <div className="mb-2 text-xs text-success">
              <p>
                Installed {installResult.imported} {installResult.imported === 1 ? 'rule' : 'rules'} in Watch.
                They record and feed calibration; none of them can interrupt until you promote them.
                {installResult.skipped > 0 && <span className="text-tertiary"> · {installResult.skipped} already present, skipped</span>}
              </p>
              {installResult.dormant > 0 && (
                <p className="mt-1 text-tertiary">
                  {installResult.dormant} installed dormant — they can only interrupt; turn them on from the Short List.
                </p>
              )}
            </div>
          )}
          {pack.installed && !installResult ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-tertiary">Every rule in this pack is already in your ledger.</span>
              <Link href="/policies" className="text-xs text-secondary underline underline-offset-2 hover:text-primary">View in ledger</Link>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleInstall}
                disabled={installing || pack.installed}
                className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50 motion-reduce:transition-none"
              >
                {installing ? 'Installing…' : installResult ? 'Installed' : 'Install pack'}
              </button>
              {installResult && (
                <Link href="/policies" className="text-xs text-secondary underline underline-offset-2 hover:text-primary">View in ledger</Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

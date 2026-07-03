'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Skeleton } from '../../components/ui/Skeleton';
import Disclosure from './Disclosure';
import {
  fetchContract,
  patchPolicyParam,
  type ContractView,
} from '../lib/contractClient';
import { SHIELDS, matchShieldsToPolicies, buildShieldPayload } from '../lib/shields';
import { groupGrants, formatTarget, addedWithinDays, type SuppressedGroup, type SuppressedRow } from '../lib/grantGrouping';
import type { ContractSentence, ContractGrant } from '../../lib/policy-modes/contract';
import type { PolicySummaryShield } from '../../lib/policy-modes/summary';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

const APPROVE_STEPS = [1, 5, 10, 25, 50];
const BLOCK_STEPS = [10, 25, 50, 100];

interface ContractPanelProps {
  onChangeMode: () => void;
  onContractChanged: () => void;
  /** Deep-link highlight: renders a border-active ring on matching custom rule. */
  highlight?: string | null;
  /**
   * Shield active-state data from the cockpit's fetchSummary(); used to render
   * the real on/off toggle in the "Add protection" disclosure.
   * When omitted every shield renders as inactive (safe default).
   */
  shields?: PolicySummaryShield[];
  /** Bump to force a contract refetch (e.g. after a review-feed verdict creates a rule). */
  refreshSignal?: number;
}

function SentenceRow({
  sentence,
  onRefetch,
}: {
  sentence: ContractSentence;
  onRefetch: () => void;
}) {
  const [patchError, setPatchError] = useState<string | null>(null);

  const handleParamChange = async (value: number) => {
    if (!sentence.editable || !sentence.rules) return;
    setPatchError(null);
    try {
      await patchPolicyParam(sentence.policy_id, sentence.rules, sentence.editable.param, value);
      onRefetch();
    } catch (e) {
      setPatchError((e as Error).message);
    }
  };

  const steps = sentence.editable?.param === 'max_spend_usd' || sentence.editable?.param === 'budget_usd' ? BLOCK_STEPS : APPROVE_STEPS;

  return (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-secondary min-w-0">
        &middot; {sentence.text}
        {sentence.editable && (
          <select
            aria-label="Change threshold"
            value={sentence.editable.value}
            onChange={(e) => handleParamChange(Number(e.target.value))}
            className="ml-2 rounded border border-border bg-surface-secondary px-1 py-0 text-xs text-tertiary focus:outline-none focus:ring-1 focus:ring-brand/40"
          >
            {/* Include the configured value even when it's not a preset step,
                or the select silently displays the first option instead. */}
            {[...new Set([...steps, sentence.editable.value])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>${v}.00</option>
            ))}
          </select>
        )}
      </span>
      <span
        className={`shrink-0 tabular-nums text-xs ${sentence.fired_7d > 0 ? 'text-secondary' : 'text-tertiary'}`}
      >
        fired {sentence.fired_7d}&times; this wk
      </span>
      {patchError && (
        <span className="block w-full text-xs text-status-error pl-3">{patchError}</span>
      )}
    </li>
  );
}

const GRANTS_OPEN_KEY = 'dashclaw_contract_grants_open';

function PatternRow({ row, onRemove }: { row: SuppressedRow; onRemove: (ids: string[]) => Promise<void> }) {
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = formatTarget(row.target);

  const handleRemove = async () => {
    setBusy(true);
    setRemoveError(null);
    try {
      await onRemove(row.policy_ids);
    } catch (e) {
      setRemoveError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <li
      data-entity-type="policy"
      data-entity-id={row.policy_ids[0]}
      className="flex items-baseline justify-between gap-3 py-1"
    >
      <span className="min-w-0 truncate font-mono text-xs text-secondary" title={target.full || row.shape_key}>
        {target.display}
        {row.policy_ids.length > 1 && (
          <span className="ml-1.5 tabular-nums text-tertiary" title={`${row.policy_ids.length} duplicate rules collapsed`}>
            &times;{row.policy_ids.length}
          </span>
        )}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={handleRemove}
        aria-label={`Remove suppress rule ${target.full || row.shape_key}`}
        className="shrink-0 text-xs text-tertiary transition-colors hover:text-status-error disabled:opacity-50 motion-reduce:transition-none"
      >
        &times;
      </button>
      {removeError && <span className="block w-full text-xs text-status-error">{removeError}</span>}
    </li>
  );
}

/**
 * "Never bother me about" — the learned suppress-rules. Collapsed to a one-line
 * rollup by default (the wall of raw paths buried the rest of /policies);
 * expanded it groups by action type inside a bounded scroll region.
 */
function SuppressedPatterns({
  grants,
  onRemove,
}: {
  grants: ContractGrant[];
  onRemove: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(GRANTS_OPEN_KEY) === 'true'; } catch { return false; }
  });
  const [groupError, setGroupError] = useState<string | null>(null);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(GRANTS_OPEN_KEY, String(next)); } catch { /* private mode */ }
      return next;
    });
  };

  const groups = useMemo(() => groupGrants(grants), [grants]);
  const recent = useMemo(() => addedWithinDays(grants, 7), [grants]);

  const clearGroup = async (group: SuppressedGroup) => {
    setBusyGroup(group.type);
    setGroupError(null);
    try {
      await onRemove(group.policy_ids);
    } catch (e) {
      setGroupError((e as Error).message);
    } finally {
      setBusyGroup(null);
    }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-secondary">
          Never bother me about:{' '}
          <span className="tabular-nums">{grants.length}</span> suppressed pattern{grants.length !== 1 ? 's' : ''}
          {recent > 0 && (
            <span className="text-tertiary"> &middot; <span className="tabular-nums">{recent}</span> added this week</span>
          )}
        </p>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} suppressed patterns`}
          className="shrink-0 text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
        >
          {open ? 'Hide' : 'Show'} {open ? '▴' : '▾'}
        </button>
      </div>

      {open && (
        <ul aria-label="Suppressed patterns" className="mt-2 max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {groups.map((group) => (
            <li key={group.type} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs uppercase tracking-wider text-tertiary">
                  {group.type} <span className="tabular-nums">({group.rows.length})</span>
                </span>
                <button
                  type="button"
                  disabled={busyGroup === group.type}
                  onClick={() => clearGroup(group)}
                  aria-label={`Clear group ${group.type}`}
                  className="text-xs text-tertiary transition-colors hover:text-status-error disabled:opacity-50 motion-reduce:transition-none"
                >
                  clear group
                </button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {group.rows.map((row) => (
                  <PatternRow key={row.shape_key} row={row} onRemove={onRemove} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {groupError && <p className="mt-1 text-xs text-status-error">{groupError}</p>}
    </div>
  );
}

/**
 * ContractPanel — renders the agent's interruption contract as plain-English
 * sentences grouped by tier (interrupt / block / silent / grants / custom).
 * Editable thresholds use inline selects; grants have a remove button.
 * Shield toggles live in a collapsed "Add protection" disclosure.
 */
export default function ContractPanel({ onChangeMode, onContractChanged, highlight, shields: shieldsProp = [], refreshSignal = 0 }: ContractPanelProps) {
  const [contract, setContract] = useState<ContractView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyShield, setBusyShield] = useState<string | null>(null);
  const [shieldError, setShieldError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const c = await fetchContract();
      setContract(c);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const handleRefetch = useCallback(async () => {
    await load();
    onContractChanged();
  }, [load, onContractChanged]);

  // One id → the existing single-delete; several (duplicate shapes / clear-group)
  // → the existing bulk ?ids= form of the same endpoint. No new API surface.
  const handleRemoveGrants = useCallback(
    async (policyIds: string[]) => {
      const query = policyIds.length === 1
        ? `id=${encodeURIComponent(policyIds[0]!)}`
        : `ids=${policyIds.map(encodeURIComponent).join(',')}`;
      const res = await fetch(`/api/policies?${query}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to remove rule${policyIds.length !== 1 ? 's' : ''} (${res.status})`);
      await load();
      onContractChanged();
    },
    [load, onContractChanged],
  );

  const handleShieldToggle = useCallback(
    async (shieldId: string, next: boolean) => {
      setBusyShield(shieldId);
      setShieldError(null);
      try {
        const shield = (SHIELDS as Array<{ id: string }>).find((s) => s.id === shieldId);
        if (!shield) return;
        const all = await fetch('/api/policies')
          .then((r) => (r.ok ? r.json() : { policies: [] }))
          .catch(() => ({ policies: [] }));
        const policy = matchShieldsToPolicies(all.policies || []).get(shieldId) as { id?: string } | null;
        if (next && !policy) {
          const res = await fetch('/api/policies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildShieldPayload(shield)),
          });
          if (!res.ok) throw new Error(`Failed to enable shield (${res.status})`);
        } else if (policy?.id) {
          const res = await fetch('/api/policies', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: policy.id, active: next ? 1 : 0 }),
          });
          if (!res.ok) throw new Error(`Failed to update shield (${res.status})`);
        }
        await load();
        onContractChanged();
      } catch (err) {
        setShieldError(err instanceof Error ? err.message : 'Shield update failed');
      } finally {
        setBusyShield(null);
      }
    },
    [load, onContractChanged],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-48 rounded" />
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-4 w-5/6 rounded" />
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="flex items-center justify-between border-t border-border py-4 text-sm">
        <span className="text-tertiary">Couldn&apos;t load contract.</span>
        <button onClick={load} className="text-brand hover:underline text-xs">
          Retry &rsaquo;
        </button>
      </div>
    );
  }

  // Ungoverned: let the cockpit's empty state handle it.
  if (!contract.governed) return null;

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className={SECTION_LABEL}>Your interruption contract</span>
        <button
          type="button"
          onClick={onChangeMode}
          aria-label="Change mode"
          className="rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none"
        >
          mode: {contract.mode_id ?? 'custom'} &#9660;
        </button>
      </div>

      {/* Interrupts */}
      {contract.interrupts.length > 0 && (
        <div>
          <p className="text-sm text-secondary">Interrupt me only when:</p>
          <ul className="mt-1 space-y-0.5">
            {contract.interrupts.map((s) => (
              // A policy can emit two interrupt sentences (per-purchase + window
              // budget), so the editable param disambiguates the key.
              <SentenceRow key={`${s.policy_id}-interrupt-${s.editable?.param ?? ''}`} sentence={s} onRefetch={handleRefetch} />
            ))}
          </ul>
        </div>
      )}

      {/* Hard stops */}
      {contract.blocks.length > 0 && (
        <div>
          <p className="text-sm text-secondary">Hard stops:</p>
          <ul className="mt-1 space-y-0.5">
            {contract.blocks.map((s) => (
              <SentenceRow key={`${s.policy_id}-block-${s.editable?.param ?? ''}`} sentence={s} onRefetch={handleRefetch} />
            ))}
          </ul>
        </div>
      )}

      {/* Silent / recorded */}
      {contract.silent.length > 0 && (
        <div>
          <p className="text-sm text-tertiary">Everything else is recorded silently below.</p>
          <div className="mt-2">
            <Disclosure tone="plain" summary={`Recorded silently (${contract.silent.length})`}>
              <ul className="mt-1 space-y-0.5">
                {contract.silent.map((s) => (
                  <li key={`${s.policy_id}-silent`} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="text-sm text-tertiary">&middot; {s.text}</span>
                    <span className={`shrink-0 tabular-nums text-xs ${s.fired_7d > 0 ? 'text-secondary' : 'text-tertiary'}`}>
                      fired {s.fired_7d}&times; this wk
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        </div>
      )}

      {/* Grants — collapsed rollup; grouped, deduped, bounded on expand */}
      {contract.grants.length > 0 && (
        <SuppressedPatterns grants={contract.grants} onRemove={handleRemoveGrants} />
      )}

      {/* Custom rules */}
      {contract.custom.length > 0 && (
        <div>
          <Disclosure
            tone="plain"
            summary={`+ ${contract.custom.length} custom rule${contract.custom.length !== 1 ? 's' : ''}`}
          >
            <ul className="mt-1 divide-y divide-border">
              {contract.custom.map((c) => (
                <li
                  key={c.policy_id}
                  data-entity-type="policy"
                  data-entity-id={c.policy_id}
                  className={`flex items-baseline justify-between gap-3 py-1.5 ${
                    highlight && (c.policy_id === highlight || c.name.toLowerCase() === highlight.toLowerCase())
                      ? 'rounded-md px-2 ring-1 ring-border-active'
                      : ''
                  }`}
                >
                  <span className="text-sm text-secondary">{c.name}</span>
                  <span className="shrink-0 font-mono text-xs text-tertiary">{c.policy_type}</span>
                </li>
              ))}
            </ul>
            <Link href="/policies/rules" className="mt-2 inline-block text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none">
              Edit rules &rsaquo;
            </Link>
          </Disclosure>
        </div>
      )}

      {/* Add protection — shields */}
      <Disclosure tone="plain" summary="Add protection">
        <ul className="mt-1 divide-y divide-border">
          {shieldsProp.map((shield) => {
            const isBusy = busyShield === shield.id;
            return (
              <li key={shield.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span aria-hidden="true" className={shield.on ? 'shrink-0 text-brand' : 'shrink-0 text-tertiary'}>
                    {shield.on ? '●' : '○'}
                  </span>
                  <span className="min-w-0">
                    <span className="text-sm text-secondary">{shield.name}</span>
                    <span className="ml-2 text-xs text-tertiary">{shield.description}</span>
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleShieldToggle(shield.id, !shield.on)}
                  role="switch"
                  aria-checked={shield.on}
                  aria-label={`${shield.on ? 'Disable' : 'Enable'} ${shield.name}`}
                  className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-surface-primary ${
                    shield.on ? 'bg-brand' : 'bg-white/10'
                  } ${isBusy ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all motion-reduce:transition-none ${
                      shield.on ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        {shieldError && <p className="mt-1 text-xs text-status-error">{shieldError}</p>}
      </Disclosure>

      {/* Friction line */}
      <p className="text-xs tabular-nums text-tertiary">
        Friction this week:{' '}
        <span className="tabular-nums">{contract.friction.interrupts_7d}</span> interrupt{contract.friction.interrupts_7d !== 1 ? 's' : ''}{' '}
        &middot; ~<span className="tabular-nums">{contract.friction.est_seconds}</span>s of your time
      </p>
    </div>
  );
}

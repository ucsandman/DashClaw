'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { PolicySummary, ShortListLine, PolicySuggestion } from '../../lib/policy-modes/summary';
import {
  patchPolicy,
  createPolicy,
  installPack,
  fetchPolicyRules,
  isShortListFull,
  type ClientResult,
} from '../lib/shortListClient';
import styles from '../policies.module.css';

/**
 * Section 3 of the workbench: THE SHORT LIST — the only rules allowed to
 * interrupt an unattended run (spec 4.3).
 *
 * Two rules shape every control here:
 *  - Nothing changes enforcement without a human click, and every such click is
 *    ARMED first (MAINTAINER.md §3). "Off" and "Hold instead" both take two.
 *  - The ten-line cap is hard. Any write can come back 409 SHORT_LIST_FULL, so
 *    every write goes through `run()`, which parks the pending write and opens
 *    the remove-one dialog instead of failing.
 */

interface ShortListSectionProps {
  summary: PolicySummary;
  /** Re-fetch the summary after any successful write. */
  onChanged: () => void;
  /** Opens the ledger's new-rule form prefilled for the Short List (B5). */
  onPickFromDecisions: () => void;
}

const INSTALL_DISMISSED_KEY = 'dashclaw.shortlist.install.dismissed';

const UNGRANTABLE_SENTENCE =
  'Ungrantable — no grant, approval pause, interruption budget, or automatic tuning can lift this.';

/**
 * Types the packs install DORMANT: they can only ever interrupt, so switching
 * them on consumes a Short List slot. They are listed, off, until a human says
 * yes — enforcement is never turned on for you.
 */
const DORMANT_ON_INSTALL = new Set(['role_constraint', 'delegation_constraint', 'non_fabrication', 'webhook_check']);

const DORMANT_NOTE = 'Installed dormant — this rule can only interrupt. Turn it on to add it to the Short List.';

const CAP_SENTENCE = 'The Short List is full (10 of 10). Remove one line to add this one.';

/** The chip carries the WORD; colour is a second signal, never the only one. */
const TIER_CHIP: Record<ShortListLine['tier'], string> = {
  BLOCK: 'bg-error-subtle text-error',
  HOLD: 'bg-warning-subtle text-warning',
  WATCH: 'bg-surface-tertiary text-secondary',
};

function hits(n: number): string {
  return `${n} ${n === 1 ? 'hit' : 'hits'} / 30d`;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    /* private mode / storage disabled — dismissal just does not persist */
  }
}

/** The remove-one dialog the hard cap forces. Never auto-removes anything. */
function ShortListCapDialog({
  lines,
  busy,
  error,
  onCancel,
  onRemoveAndAdd,
}: {
  lines: ShortListLine[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onRemoveAndAdd: (id: string) => void;
}) {
  const [choice, setChoice] = useState(lines[0]?.id ?? '');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className={styles.modalBackdrop} onClick={onCancel}>
      <div
        ref={panel}
        tabIndex={-1}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="The Short List is full"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <div className={styles.modalHead}>
          <h3>The Short List is full</h3>
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnIcon}`} onClick={onCancel} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <p className="mb-3 text-sm text-secondary">{CAP_SENTENCE}</p>
          {error ? (
            <p role="alert" className="mb-3 text-xs text-error">
              {error}
            </p>
          ) : null}
          <ul className="m-0 list-none p-0">
            {lines.map((l) => (
              <li key={l.id} className="border-b border-border py-2 last:border-b-0">
                <label className="flex cursor-pointer items-center gap-3 text-sm text-primary">
                  <input
                    type="radio"
                    name="short-list-remove"
                    value={l.id}
                    checked={choice === l.id}
                    onChange={() => setChoice(l.id)}
                  />
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${TIER_CHIP[l.tier]}`}>
                    {l.tier}
                  </span>
                  <span>{l.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={busy || !choice}
            onClick={() => onRemoveAndAdd(choice)}
          >
            Remove and add
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShortListSection({ summary, onChanged, onPickFromDecisions }: ShortListSectionProps) {
  const [armed, setArmed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rulesById, setRulesById] = useState<Record<string, Record<string, unknown>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The write the cap rejected, held for retry after a line is removed. */
  const [pending, setPending] = useState<(() => Promise<ClientResult>) | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);

  // localStorage is not available during SSR — reading it in the initial state
  // would make the server and client renders disagree.
  useEffect(() => {
    if (readDismissed()) setInstallDismissed(true);
  }, []);

  const cap = summary.shortListCap;
  const lines = [...(summary.shortList || [])].sort((a, b) => Number(b.active) - Number(a.active));
  // Only an ACTIVE line can interrupt, so only an active line spends a slot.
  const used = lines.filter((l) => l.active).length;
  const suggestion = (summary.suggestions || []).find((s) => s.id === 'real_money') as PolicySuggestion | undefined;

  /**
   * ALWAYS reads the row fresh. A PATCH replaces `rules` wholesale, so a write
   * built on a remembered copy silently resurrects whatever the previous write
   * removed (two Undos in a row would put the first exception back). The stored
   * copy is for DISPLAY only and is never a source for a write.
   */
  const loadRules = useCallback(async (id: string): Promise<Record<string, unknown>> => {
    const r = await fetchPolicyRules(id);
    setRulesById((prev) => ({ ...prev, [id]: r }));
    return r;
  }, []);

  /** Every write funnels here so the 409 → remove-one path is never forgotten. */
  const run = useCallback(
    async (fn: () => Promise<ClientResult>) => {
      setBusy(true);
      setError(null);
      setArmed(null);
      try {
        const res = await fn();
        if (isShortListFull(res)) {
          setPending(() => fn);
          return;
        }
        if (!res.ok) {
          setError(typeof res.json?.error === 'string' ? res.json.error : 'That change did not go through.');
          return;
        }
        setRulesById({});
        // The row just changed on the server; nothing remembered about it is
        // true any more. Re-read the one still on screen so Details never
        // displays a rule that no longer exists.
        if (expanded) loadRules(expanded).catch(() => undefined);
        onChanged();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onChanged, expanded, loadRules],
  );

  const toggleDetails = useCallback(
    (id: string) => {
      const next = expanded === id ? null : id;
      setExpanded(next);
      if (next) loadRules(next).catch((e) => setError((e as Error).message));
    },
    [expanded, loadRules],
  );

  /** Promote a WATCH line to a hold. rate_limit keeps its type; the rest become
   *  require_approval — the type IS the promotion for action-type matchers. */
  const promote = useCallback(
    (line: ShortListLine) =>
      run(async () => {
        const current = await loadRules(line.id);
        const rules = { ...current, action: 'require_approval', short_list: true };
        return patchPolicy(line.id, line.policy_type === 'rate_limit' ? { rules } : { policy_type: 'require_approval', rules });
      }),
    [run, loadRules],
  );

  const undoException = useCallback(
    (line: ShortListLine, key: string) =>
      run(async () => {
        const current = await loadRules(line.id);
        const kept = (Array.isArray(current.shape_exceptions) ? (current.shape_exceptions as string[]) : []).filter(
          (k) => k !== key,
        );
        return patchPolicy(line.id, { rules: { ...current, shape_exceptions: kept } });
      }),
    [run, loadRules],
  );

  const addSuggestion = useCallback(
    (s: PolicySuggestion) =>
      run(() =>
        createPolicy({
          name: 'Hold real-money actions',
          policy_type: s.rule.policy_type,
          rules: JSON.stringify(s.rule.rules),
        }),
      ),
    [run],
  );

  const removeAndAdd = useCallback(
    async (id: string) => {
      const retry = pending;
      if (!retry) return;
      setBusy(true);
      setError(null);
      try {
        const off = await patchPolicy(id, { active: false });
        if (!off.ok) {
          setError(typeof off.json?.error === 'string' ? off.json.error : 'Could not remove that line.');
          return;
        }
        const res = await retry();
        if (isShortListFull(res)) {
          // A line came off, and it is STILL full — another slot was taken in
          // the meantime. Keep the dialog up with the mandated sentence, and
          // refresh so its list shows the line that was just removed as gone.
          setError(CAP_SENTENCE);
          onChanged();
          return;
        }
        if (!res.ok) {
          setError(typeof res.json?.error === 'string' ? res.json.error : 'That change did not go through.');
          return;
        }
        setPending(null);
        onChanged();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [pending, onChanged],
  );

  return (
    <section>
      <div className={styles.secHead}>
        <div className={styles.lhs}>
          <h2>The Short List</h2>
        </div>
        <span className={styles.countPill}>{`${used} of ${cap} lines`}</span>
      </div>
      <p className={styles.secHelp}>The only rules that can interrupt an unattended run.</p>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      ) : null}

      <div className={`${styles.card} mt-3`}>
        {lines.length === 0 ? (
          installDismissed ? null : (
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="m-0 text-sm font-semibold text-primary">Install the Short List</h3>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost} ${styles.btnIcon}`}
                  aria-label="Dismiss"
                  onClick={() => {
                    writeDismissed();
                    setInstallDismissed(true);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="mt-2 mb-3 text-[13px] leading-relaxed text-secondary">
                Four lines that stop an unattended run: mass destruction, secret-file writes, force-push over main,
                runaway loops. Everything else stays watched.
              </p>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={busy}
                onClick={() => run(() => installPack('catastrophe-only'))}
              >
                Install
              </button>
            </div>
          )
        ) : (
          <div className={styles.sectionRows}>
            {lines.map((line) => {
              const isOpen = expanded === line.id;
              const rules = rulesById[line.id];
              return (
                <div key={line.id} className={`${styles.card} p-4`}>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${TIER_CHIP[line.tier]}`}>
                      {line.tier}
                    </span>
                    <span className={`text-sm font-medium ${line.active ? 'text-primary' : 'text-tertiary line-through'}`}>
                      {line.name}
                    </span>
                    {line.active ? null : <span className={styles.metaLabel}>Off</span>}
                    <span className={`${styles.tnum} ml-auto text-xs text-tertiary`}>{hits(line.fired30d)}</span>
                  </div>

                  <p className="mt-1.5 mb-0 text-[13px] leading-relaxed text-secondary">{line.scope}</p>

                  {!line.active && DORMANT_ON_INSTALL.has(line.policy_type) ? (
                    <p className="mt-1 mb-0 text-xs text-tertiary">{DORMANT_NOTE}</p>
                  ) : null}
                  {line.tier === 'BLOCK' ? (
                    <p className="mt-1 mb-0 text-xs text-tertiary">Refuses outright. Never waits on you.</p>
                  ) : null}
                  {line.ungrantable && line.tier !== 'WATCH' ? (
                    <p className="mt-1 mb-0 text-xs text-tertiary">{UNGRANTABLE_SENTENCE}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                      aria-expanded={isOpen}
                      aria-controls={`short-list-details-${line.id}`}
                      onClick={() => toggleDetails(line.id)}
                    >
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      Details
                    </button>

                    {line.tier === 'WATCH' && line.active ? (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm}`}
                        disabled={busy}
                        onClick={() => (armed === `${line.id}:hold` ? promote(line) : setArmed(`${line.id}:hold`))}
                      >
                        {armed === `${line.id}:hold` ? 'Make it a hold?' : 'Hold instead'}
                      </button>
                    ) : null}

                    {line.active ? (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                        disabled={busy}
                        onClick={() =>
                          armed === `${line.id}:off`
                            ? run(() => patchPolicy(line.id, { active: false }))
                            : setArmed(`${line.id}:off`)
                        }
                      >
                        {armed === `${line.id}:off` ? 'Turn off?' : 'Off'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm}`}
                        disabled={busy}
                        onClick={() => run(() => patchPolicy(line.id, { active: true }))}
                      >
                        On
                      </button>
                    )}
                  </div>

                  {isOpen ? (
                    <div id={`short-list-details-${line.id}`} className="mt-3 border-t border-border pt-3">
                      <div className={styles.metaLabel}>Type</div>
                      <p className={`${styles.mono} mt-1 mb-3 text-xs text-secondary`}>{line.policy_type}</p>

                      <div className={styles.metaLabel}>Compiled rule</div>
                      <pre className={`${styles.mono} mt-1 mb-3 overflow-x-auto text-xs text-secondary`}>
                        {rules ? JSON.stringify(rules, null, 2) : 'Loading…'}
                      </pre>

                      <div className={styles.metaLabel}>Provenance</div>
                      <p className="mt-1 mb-3 text-xs text-secondary">
                        {line.seeded ? 'Seeded at org birth by the catastrophe pack.' : 'Added by you.'}
                      </p>

                      <div className={styles.metaLabel}>Exceptions</div>
                      {line.shape_exceptions.length === 0 ? (
                        <p className="mt-1 mb-0 text-xs text-tertiary">None.</p>
                      ) : (
                        <ul className="mt-1 mb-0 list-none p-0">
                          {line.shape_exceptions.map((key) => (
                            <li key={key} className="flex items-center gap-3 py-1">
                              <code className={`${styles.mono} text-xs text-secondary`}>{key}</code>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                                aria-label={`Undo exception for ${key}`}
                                disabled={busy}
                                onClick={() => undoException(line, key)}
                              >
                                Undo
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border p-4">
          <span className="text-[13px] text-secondary">
            {`+ Add a line from a decision you have seen. ${Math.max(0, cap - used)} slots left.`}
          </span>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ml-auto`} onClick={onPickFromDecisions}>
            Pick from recent decisions
          </button>
        </div>
      </div>

      {suggestion ? (
        <div className={`${styles.card} mt-3 p-4`}>
          <h3 className="m-0 text-sm font-semibold text-primary">{`Suggested — ${suggestion.title}`}</h3>
          <p className="mt-1.5 mb-3 text-[13px] leading-relaxed text-secondary">{suggestion.scope}</p>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSm}`}
            disabled={busy}
            onClick={() => addSuggestion(suggestion)}
          >
            Add to the Short List
          </button>
        </div>
      ) : null}

      {pending ? (
        <ShortListCapDialog
          lines={lines.filter((l) => l.active)}
          busy={busy}
          error={error}
          onCancel={() => setPending(null)}
          onRemoveAndAdd={removeAndAdd}
        />
      ) : null}
    </section>
  );
}

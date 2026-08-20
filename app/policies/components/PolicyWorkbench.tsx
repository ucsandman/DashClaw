'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Upload, ChevronDown, FileText, Plus, Package, FlaskConical } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { fetchSummary, type PolicySummary } from '../lib/modesClient';
import { fetchContract, type ContractView } from '../lib/contractClient';
import { PostureCards } from './PostureHero';
import ShortListSection from './ShortListSection';
import TriageInbox from './TriageInbox';
import CalibrationSection from './CalibrationSection';
import ExternalVerdictPanel from './ExternalVerdictPanel';
import Ledger, { type LedgerActions } from './Ledger';
import styles from '../policies.module.css';

/**
 * The /policies workbench, rebuilt around the Short List (spec §4).
 *
 * Read top-to-bottom: the alert row and two stat cards, the relief valve, THE
 * SHORT LIST (the only rules allowed to interrupt), what needs a call, what
 * calibration has learned — and only then, collapsed, everything the runtime
 * merely watches.
 *
 * Summary + contract are fetched once here and shared down; a single
 * refresh() re-pulls everything after any mutation anywhere on the page.
 */
export default function PolicyWorkbench() {
  const searchParams = useSearchParams();
  const highlightPolicy = searchParams.get('policy');

  // ?prefill=<url-encoded JSON> opens the rule editor pre-populated (from the
  // decisions context menu, or a compliance gap). `rules.short_list` rides
  // through untouched, so a deep link can pre-tick the Short List checkbox.
  const prefillRaw = searchParams.get('prefill');
  const prefill = (() => {
    if (!prefillRaw) return null;
    try {
      return JSON.parse(prefillRaw) as { name?: string; policy_type?: string; rules?: unknown };
    } catch {
      return null;
    }
  })();

  const [summary, setSummary] = useState<PolicySummary | null>(null);
  const [contract, setContract] = useState<ContractView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [, setInboxCount] = useState(0);
  const [packsOpen, setPacksOpen] = useState(false);
  // The top action row calls into Ledger's modals, which live inside the
  // collapsible ledger section. If that section is collapsed (persisted in
  // localStorage), the click would silently no-op behind a hidden div —
  // force the section open the moment any of those actions fires.
  const [forceLedgerOpen, setForceLedgerOpen] = useState(false);

  const ledgerActions = useRef<LedgerActions | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [s, c] = await Promise.all([fetchSummary(), fetchContract()]);
      setSummary(s);
      setContract(c);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Called after any mutation on the page: re-pull summary+contract and bump the
  // signal so the ledger refetches its rule list too.
  const refresh = useCallback(() => {
    load();
    setRefreshSignal((n) => n + 1);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex items-center justify-between border-t border-border py-6 text-sm">
        <span className="text-tertiary">Couldn&apos;t load your policy posture.</span>
        <button onClick={load} className="text-brand hover:underline">
          Retry &rsaquo;
        </button>
      </div>
    );
  }

  // "Everything else" counts what is NOT on the Short List. Inactive Short List
  // lines are not enforcing, so they are not subtracted.
  const activeShortList = (summary.shortList ?? []).filter((line) => line.active).length;
  const watchedCount = Math.max(0, summary.enforcement.total - activeShortList);

  return (
    <div className={styles.shell}>
      {/* Top action row — three verbs (spec §4). Generate with AI lives inside
          the rule editor; Import pack / YAML lives inside Packs; Test rules
          moved to the Everything-else header, where it already operates. */}
      <div className={styles.topActions} data-testid="policy-top-actions">
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.openNewRule(); }}
        >
          <Plus size={15} />Add a rule
        </button>

        <span className={styles.splitBtn}>
          <button
            type="button"
            className={styles.btn}
            aria-haspopup="menu"
            aria-expanded={packsOpen}
            onClick={() => setPacksOpen((v) => !v)}
          >
            <Package size={15} />Packs<ChevronDown size={13} aria-hidden="true" />
          </button>
          {packsOpen && (
            <div className={styles.splitBtnMenu} role="menu">
              <Link href="/policies/packs" role="menuitem" onClick={() => setPacksOpen(false)}>
                <Package size={13} aria-hidden="true" />
                Browse packs
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPacksOpen(false);
                  setForceLedgerOpen(true);
                  ledgerActions.current?.openImport();
                }}
              >
                <Upload size={13} aria-hidden="true" />
                Import pack / YAML
              </button>
            </div>
          )}
        </span>

        <button type="button" className={styles.btn} onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.openProof(); }}>
          <FileText size={15} />Export proof
        </button>
      </div>

      {/* Alert row + two stat cards + the approval-pause relief valve. */}
      <PostureCards
        summary={summary}
        friction={contract?.friction ?? null}
        inboxCount={0}
        // Same shape as the top action row: force the (possibly collapsed)
        // ledger section open, then call into Ledger via its registered ref.
        onReviewSuppressed={(grantIds) => {
          setForceLedgerOpen(true);
          ledgerActions.current?.revealSuppressed(grantIds);
        }}
      />

      <div id="short-list">
        <ShortListSection
          summary={summary}
          onChanged={refresh}
          onPickFromDecisions={() => { setForceLedgerOpen(true); ledgerActions.current?.openNewRule({ shortList: true }); }}
        />
      </div>

      <TriageInbox onChanged={refresh} onCount={setInboxCount} />

      {/* Expanded, always mounted: it owns id="calibration" and scrolls itself
          into view for /policies#calibration. A collapsible that unmounts it
          would break that deep link. */}
      <CalibrationSection onChanged={refresh} />

      <CollapsibleSection
        id="policies.ledger"
        title={
          <>
            Everything else — watched, recorded, not interrupting
            <span className={styles.secHelp} style={{ marginLeft: 10, fontWeight: 400 }}>
              Every rule that records but never stops an unattended run.
            </span>
          </>
        }
        count={watchedCount}
        actions={
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSm}`}
            onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.runTests(); }}
          >
            <FlaskConical size={13} aria-hidden="true" />Test rules against past actions
          </button>
        }
        defaultOpen={false}
        // A `?policy=` deep link must always land on a visible row, and a
        // `?prefill=` link opens Ledger's rule-editor MODAL — which also lives
        // inside this section. Never let a persisted collapse hide what the
        // link came here to show: a hidden container renders the editor to
        // nothing and the human sees an ordinary /policies page.
        forceOpen={Boolean(highlightPolicy) || Boolean(prefill) || forceLedgerOpen}
        // Release the top-row force the moment the human manually toggles the
        // section — otherwise forceOpen would win forever and the section
        // could never be collapsed again for the rest of the page session.
        onToggle={() => setForceLedgerOpen(false)}
        // The top row and the Short List call into Ledger via a ref Ledger
        // populates on mount. Unmounting Ledger on collapse would leave that
        // ref stale — clicks would silently no-op instead of opening their
        // modal. Keep it mounted (hidden, not removed).
        keepMounted
      >
        <Ledger
          summary={summary}
          contract={contract}
          highlightPolicy={highlightPolicy}
          prefill={prefill}
          refreshSignal={refreshSignal}
          onChanged={refresh}
          registerActions={(a) => { ledgerActions.current = a; }}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="policies.external"
        title={
          <>
            Outside decision provider
            <span className={styles.secHelp} style={{ marginLeft: 10, fontWeight: 400 }}>
              An outside engine can tighten decisions here. It can never loosen them.
            </span>
          </>
        }
        defaultOpen={false}
      >
        <ExternalVerdictPanel />
      </CollapsibleSection>
    </div>
  );
}

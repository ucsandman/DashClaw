'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Upload, Sparkles, CheckCheck, FileText, Plus } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { fetchSummary, type PolicySummary } from '../lib/modesClient';
import { fetchContract, type ContractView } from '../lib/contractClient';
import PostureHero from './PostureHero';
import TriageInbox from './TriageInbox';
import PresetsShields from './PresetsShields';
import ExternalVerdictPanel from './ExternalVerdictPanel';
import Ledger, { type LedgerActions } from './Ledger';
import GlossaryStrip from './GlossaryStrip';
import styles from '../policies.module.css';

/**
 * The /policies workbench — "One Ledger, Many Lenses".
 *
 * One surface, one dataset (guard policies), read top-to-bottom:
 *   posture hero → unified "needs your call" inbox → presets & shields →
 *   the ledger (Table / Sentences / Groups lenses) → plain-language key.
 *
 * Summary + contract are fetched once here and shared down; a single
 * refresh() re-pulls everything after any mutation anywhere on the page.
 */
export default function PolicyWorkbench() {
  const searchParams = useSearchParams();
  const highlightPolicy = searchParams.get('policy');

  // ?prefill=<url-encoded JSON> opens the rule editor pre-populated (from an
  // external deep-link, e.g. a compliance gap). Decode once.
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
  const [inboxCount, setInboxCount] = useState(0);
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
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

  return (
    <div className={styles.shell}>
      {/* Top action row — the four previously-buried authoring verbs + create. */}
      <div className={styles.topActions}>
        <button type="button" className={styles.btn} onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.openImport(); }}>
          <Upload size={15} />Import pack / YAML
        </button>
        <button type="button" className={styles.btn} onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.openGenerate(); }}>
          <Sparkles size={15} />Generate with AI
        </button>
        <button type="button" className={styles.btn} onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.runTests(); }}>
          <CheckCheck size={15} />Test guardrails
        </button>
        <button type="button" className={styles.btn} onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.openProof(); }}>
          <FileText size={15} />Export proof
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { setForceLedgerOpen(true); ledgerActions.current?.openNewRule(); }}>
          <Plus size={15} />New rule
        </button>
      </div>

      <PostureHero
        summary={summary}
        friction={contract?.friction ?? null}
        inboxCount={inboxCount}
        // Same shape as the top action row: force the (possibly collapsed)
        // ledger section open, then call into Ledger via its registered ref.
        onReviewSuppressed={(grantIds) => {
          setForceLedgerOpen(true);
          ledgerActions.current?.revealSuppressed(grantIds);
        }}
      />

      <TriageInbox onChanged={refresh} onCount={setInboxCount} />

      <PresetsShields summary={summary} onChanged={refresh} />

      <CollapsibleSection
        id="policies.external"
        title={
          <>
            External decision provider
            <span className={styles.secHelp} style={{ marginLeft: 10, fontWeight: 400 }}>
              An outside engine can tighten decisions here. It can never loosen them.
            </span>
          </>
        }
      >
        <ExternalVerdictPanel />
      </CollapsibleSection>

      <CollapsibleSection
        id="policies.ledger"
        title={
          <>
            The ledger
            <span className={styles.secHelp} style={{ marginLeft: 10, fontWeight: 400 }}>
              Every rule, whatever its source, in one place. Switch the lens to read it as a table, sentences, or grouped.
            </span>
          </>
        }
        count={summary.enforcement.total}
        // A `?policy=` deep link must always land on a visible row — never let
        // a persisted collapse hide the section the link is trying to reveal.
        forceOpen={Boolean(highlightPolicy) || forceLedgerOpen}
        // Release the top-row force the moment the human manually toggles the
        // section — otherwise forceOpen would win forever and the section
        // could never be collapsed again for the rest of the page session.
        onToggle={() => setForceLedgerOpen(false)}
        // The top action row (Import/Generate/Test/New rule) calls into Ledger
        // via a ref Ledger populates on mount. Unmounting Ledger on collapse
        // would leave that ref stale — clicks would silently no-op instead of
        // opening their modal. Keep it mounted (hidden, not removed) so those
        // refs stay live no matter the section's open state.
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

      <GlossaryStrip />
    </div>
  );
}

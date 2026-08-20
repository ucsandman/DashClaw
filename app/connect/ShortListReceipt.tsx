'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { fetchSummary } from '../policies/lib/modesClient';
import { installPack } from '../policies/lib/shortListClient';
import type { ShortListLine } from '../lib/policy-modes/summary';

/**
 * /connect, card two — the receipt (spec §3.3).
 *
 * The Short List is written server-side at org birth. An auto-write the human
 * reads immediately is a disclosure; one they discover later is a presumption.
 * So this card reports what is already live, in place, read-only — no
 * navigation, no modal, nothing to configure. It replaces the old "Pick your
 * rules" pack pitch, which is demoted to one line at the bottom.
 *
 * Three states: the receipt (something is live), the Install card (nothing is,
 * e.g. an org with history that the seed guard refused to write to), and — for
 * a signed-out visitor reading /connect as a public page, whose
 * /api/policies/summary read 401s — just the pack line, bare.
 */

const PACK_LINE = 'Add a pack when you want more than catastrophe coverage. Pack rules start in Watch.';

const SEED_SENTENCE =
  'One of these refuses outright. Two hold for your approval. Everything else runs and is recorded.';

/** The chip carries the WORD; colour is a second signal, never the only one. */
const TIER_CHIP: Record<ShortListLine['tier'], string> = {
  BLOCK: 'bg-error-subtle text-error',
  HOLD: 'bg-warning-subtle text-warning',
  WATCH: 'bg-surface-tertiary text-text-secondary',
};

/**
 * The seeded list is 1 BLOCK + 2 HOLD, and reads best in words. Any other
 * shape — a line switched off, a fifth line added from a decision — has to
 * report itself honestly rather than keep claiming "one" and "two".
 */
function tierSentence(lines: ShortListLine[]): string {
  const block = lines.filter((l) => l.tier === 'BLOCK').length;
  const hold = lines.filter((l) => l.tier === 'HOLD').length;
  if (block === 1 && hold === 2) return SEED_SENTENCE;
  const clauses = [];
  if (block) clauses.push(`${block} ${block === 1 ? 'refuses' : 'refuse'} outright.`);
  if (hold) clauses.push(`${hold} ${hold === 1 ? 'holds' : 'hold'} for your approval.`);
  // Both tiers can be switched off a line at a time, leaving only WATCH rules —
  // a real state, and "0 refuse outright" is not how a human says it.
  if (clauses.length === 0) return 'Everything here is watched and recorded; nothing interrupts.';
  return `${clauses.join(' ')} Everything else runs and is recorded.`;
}

function PackLine({ wrapper = 'mt-6 border-t border-border pt-4' }: { wrapper?: string }) {
  return (
    <div className={wrapper}>
      <p className="text-sm leading-relaxed text-text-tertiary">{PACK_LINE}</p>
      <Link
        href="/policies/packs"
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        Browse policy packs <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

export default function ShortListReceipt({ className = '' }: { className?: string }) {
  const [lines, setLines] = useState<ShortListLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const summary = await fetchSummary();
      // Inactive lines are off. The receipt reports what is LIVE.
      setLines((summary.shortList ?? []).filter((l) => l.active));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const install = useCallback(async () => {
    setBusy(true);
    setInstallError(null);
    try {
      const res = await installPack('catastrophe-only');
      // A failed install that leaves the card looking unchanged is the exact
      // false confidence this product exists to prevent — say so out loud.
      if (res.ok) await load();
      else {
        const detail = typeof res.json?.error === 'string' ? res.json.error : `HTTP ${res.status}`;
        setInstallError(`Could not install — ${detail}`);
      }
    } catch (e) {
      setInstallError(`Could not install — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const shell = `rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8 ${className}`;

  // Nothing to receipt for an anonymous reader — the pack link stands alone,
  // as a line rather than an empty card with a rule through it.
  if (failed) {
    return (
      <div className={className}>
        <PackLine wrapper="" />
      </div>
    );
  }

  if (lines === null) return null;

  if (lines.length === 0) {
    return (
      <section className={shell}>
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck size={20} className="text-text-tertiary" aria-hidden="true" />
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Install the Short List</h2>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
          Four lines that stop an unattended run: mass destruction, secret-file writes, force-push over main,
          runaway loops. Everything else stays watched.
        </p>
        <button
          type="button"
          onClick={install}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-surface-primary transition-colors hover:bg-brand-hover disabled:opacity-60"
        >
          Install
        </button>
        {installError ? (
          <p role="alert" className="mt-2 text-xs text-error">
            {installError}
          </p>
        ) : null}
        <PackLine />
      </section>
    );
  }

  return (
    <section className={shell}>
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck size={20} className="text-text-tertiary" aria-hidden="true" />
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Your Short List is live</h2>
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{tierSentence(lines)}</p>

      <ul className="mt-5 list-none space-y-3 p-0">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              aria-label={`Tier: ${l.tier}`}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${TIER_CHIP[l.tier]}`}
            >
              {l.tier}
            </span>
            <span className="text-sm font-medium text-text-primary">{l.name}</span>
            <span className="min-w-0 basis-full text-[13px] leading-relaxed text-text-tertiary sm:basis-auto">
              {l.scope}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href="/policies"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-surface-primary transition-colors hover:bg-brand-hover"
      >
        Review the Short List <ArrowRight size={14} aria-hidden="true" />
      </Link>

      <PackLine />
    </section>
  );
}

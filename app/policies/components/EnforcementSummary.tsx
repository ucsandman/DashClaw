'use client';

import Link from 'next/link';
import type { PolicySummaryRule, RuleBucket } from '../lib/modesClient';
import Disclosure from './Disclosure';

interface EnforcementSummaryProps {
  enforcement: { total: number; warn: number; require_approval: number; block: number };
  rules: PolicySummaryRule[];
  decisions30d: { total: number; allow: number; warn: number; require_approval: number; block: number };
}

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';
const AFFORDANCE = 'text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none';

const BUCKET_ORDER: RuleBucket[] = ['block', 'require_approval', 'warn', 'allow'];
const BUCKET_LABEL: Record<RuleBucket, string> = {
  block: 'Block',
  require_approval: 'Require approval',
  warn: 'Warn',
  allow: 'Allow',
};

/**
 * The "what does the policy set actually enforce" section. A single prose
 * signal line (warn / approval / block, everything-else-runs), an on-demand
 * grouped rule list behind a Disclosure, and a separate decision-OUTCOME
 * tally for the last 30 days. Hairline dividers, no nested cards.
 */
export default function EnforcementSummary({ enforcement, rules, decisions30d }: EnforcementSummaryProps) {
  const grouped = BUCKET_ORDER
    .map((bucket) => ({ bucket, items: rules.filter((r) => r.bucket === bucket) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      {/* Signal line + reveal */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="text-sm text-secondary">
          <span className="tabular-nums text-secondary">{enforcement.warn}</span> warn
          {' · '}
          <span className="tabular-nums text-secondary">{enforcement.require_approval}</span> require approval
          {' · '}
          <span className="tabular-nums text-secondary">{enforcement.block}</span> block
          <span className="text-tertiary"> · everything else runs without interruption.</span>
        </p>
      </div>

      <div className="mt-2">
        <Disclosure tone="plain" summary="View rules">
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.bucket}>
                <span className={SECTION_LABEL}>{BUCKET_LABEL[group.bucket]}</span>
                <ul className="mt-1.5 space-y-1">
                  {group.items.map((rule) => (
                    <li key={rule.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-xs text-secondary">{rule.name}</span>
                      {rule.fired30d > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-tertiary">
                          fired {rule.fired30d}&times;
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <Link href="/policies/rules" className={`${AFFORDANCE} inline-block`}>
              Edit rules &rsaquo;
            </Link>
          </div>
        </Disclosure>
      </div>

      {/* Decision outcomes — last 30 days */}
      <div className="mt-4 border-t border-border pt-4">
        <span className={SECTION_LABEL}>Decisions &middot; Last 30 days</span>
        <p className="mt-1.5 text-sm">
          <span className={decisions30d.allow > 0 ? 'tabular-nums text-secondary' : 'tabular-nums text-tertiary'}>
            {decisions30d.allow}
          </span>{' '}
          <span className="text-tertiary">allowed</span>
          {' · '}
          <span className={decisions30d.warn > 0 ? 'tabular-nums text-warning' : 'tabular-nums text-tertiary'}>
            {decisions30d.warn}
          </span>{' '}
          <span className="text-tertiary">warned</span>
          {' · '}
          <span className={decisions30d.require_approval > 0 ? 'tabular-nums text-warning' : 'tabular-nums text-tertiary'}>
            {decisions30d.require_approval}
          </span>{' '}
          <span className="text-tertiary">approved</span>
          {' · '}
          <span className={decisions30d.block > 0 ? 'tabular-nums text-error' : 'tabular-nums text-tertiary'}>
            {decisions30d.block}
          </span>{' '}
          <span className="text-tertiary">blocked</span>
        </p>
      </div>
    </div>
  );
}

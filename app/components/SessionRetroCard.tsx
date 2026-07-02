'use client';

import Link from 'next/link';
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import type { SessionRetro, RetroFinding, RetroPosture } from '../lib/session-retro';

// Session retro ("was I manipulated", roadmap v2.5). Pure presentation over
// GET /api/sessions/[id]/retro — posture chip, honest coverage line, goal
// timeline, findings grouped by kind. Tokens only, no hex.

const postureStyle: Record<RetroPosture, { chip: string; Icon: typeof ShieldCheck; label: string }> = {
  clean: { chip: 'bg-success-subtle text-success', Icon: ShieldCheck, label: 'Clean' },
  review: { chip: 'bg-warning-subtle text-warning', Icon: ShieldAlert, label: 'Review' },
  flagged: { chip: 'bg-error-subtle text-error', Icon: ShieldX, label: 'Flagged' },
};

const severityStyle: Record<string, string> = {
  high: 'bg-error-subtle text-error',
  medium: 'bg-warning-subtle text-warning',
  low: 'bg-zinc-500/20 text-secondary',
};

const kindLabel: Record<string, string> = {
  injection: 'Injected content',
  non_fabrication: 'Fabrication',
  goal_drift: 'Goal drift',
  risk_spike: 'Risk spike',
  spend: 'Spend',
  intervention: 'Interventions',
  assumption: 'Invalidated assumptions',
};

export default function SessionRetroCard({ retro }: { retro: SessionRetro | null }) {
  if (!retro) return null;
  const posture = postureStyle[retro.posture];
  const { Icon } = posture;
  const cov = retro.coverage;
  const ungoverned = Math.max(0, cov.actions_analyzed - cov.actions_with_guard_decision);

  const grouped: Record<string, RetroFinding[]> = {};
  for (const f of retro.findings) (grouped[f.kind] ??= []).push(f);

  return (
    <Card hover={false} className="mt-6">
      <CardHeader
        title="Session retro — was I manipulated?"
        action={
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${posture.chip}`}>
            <Icon size={14} />
            {posture.label}
          </span>
        }
      />
      <CardContent>
        <div className="space-y-4">
          {/* Honesty line: a mostly-ungoverned session must not read as exonerated. */}
          <p className="text-xs text-secondary">
            {cov.actions_with_guard_decision} of {cov.actions_analyzed} actions had a linked guard
            decision{ungoverned > 0 ? ` — ${ungoverned} ungoverned (posture applies to observed data only)` : ''}.
            {cov.actions_total > cov.actions_analyzed
              ? ` Analyzed the first ${cov.actions_analyzed} of ${cov.actions_total} actions.` : ''}
          </p>

          {retro.goal_timeline.length > 0 && (
            <div>
              <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-disabled">Goal timeline</h3>
              <ol className="space-y-0.5 text-sm">
                {retro.goal_timeline.map((g, i) => (
                  <li key={`${g.goal}-${i}`} className="text-secondary">
                    {g.goal} <span className="text-xs text-tertiary">({g.action_count} action{g.action_count === 1 ? '' : 's'})</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {retro.findings.length === 0 ? (
            <p className="text-sm text-secondary">No findings across the observed actions.</p>
          ) : (
            Object.entries(grouped).map(([kind, list]) => (
              <div key={kind}>
                <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-disabled">
                  {kindLabel[kind] ?? kind} ({list.length})
                </h3>
                <ul className="space-y-1">
                  {list.map((f, i) => (
                    <li key={`${f.action_id}-${i}`} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityStyle[f.severity] ?? severityStyle.low}`}>
                        {f.severity}
                      </span>
                      <span className="text-secondary">
                        {f.summary}
                        {f.action_id && (
                          <Link href={`/actions/${f.action_id}`} className="ml-1.5 text-xs text-info hover:underline">
                            view action →
                          </Link>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          {retro.spend && (
            <p className="text-xs text-secondary">
              Session spend: ${Number(retro.spend.total).toFixed(2)} across {retro.spend.purchases} purchase{retro.spend.purchases === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

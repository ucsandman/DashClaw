'use client';

import { Target } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';

/**
 * Risk derivation ledger — renders the guard's persisted _risk_breakdown as an
 * additive table (base + modifiers + template + client + predictive = final),
 * so a risk score is provable instead of reading as arbitrary. Token-first,
 * evidence-over-decoration.
 */
export default function RiskBreakdownPanel({ breakdown }: { breakdown: any }) {
  if (!breakdown || typeof breakdown !== 'object' || breakdown.final == null) return null;

  const rows: Array<{ label: string; detail?: string; delta: string; emphasis?: boolean }> = [];
  rows.push({
    label: `Base · ${breakdown.base?.action_type ?? 'other'}`,
    detail: 'action-type base score',
    delta: String(breakdown.base?.score ?? 0),
  });
  for (const m of breakdown.modifiers || []) {
    rows.push({ label: m.factor, delta: `+${m.delta}` });
  }
  if (breakdown.template) {
    rows.push({
      label: `template:${breakdown.template.name}`,
      detail: 'org risk template (max-folded)',
      delta: String(breakdown.template.score),
    });
  }
  if (breakdown.client_reported != null) {
    rows.push({
      label: 'agent-reported risk',
      detail: 'max-folded with the server score',
      delta: String(breakdown.client_reported),
    });
  }
  if (breakdown.predictive) {
    const p = breakdown.predictive;
    const basis = p.basis === 'no_history'
      ? 'no history yet — fixed prior; improves as more actions are recorded'
      : p.total_actions != null
        ? `${p.total_actions} actions, failure rate ${p.failure_rate ?? 0}${p.velocity != null ? `, ${p.velocity}/hr` : ''}`
        : undefined;
    const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));
    // Newer decisions decompose statistical vs LLM; older rows only carry the
    // summed adjustment and render as the single legacy row.
    const hasSplit = p.statistical_adjustment != null || p.llm != null;
    if (hasSplit) {
      rows.push({
        label: 'history prior',
        detail: basis,
        delta: signed(p.statistical_adjustment ?? 0),
      });
      if (p.llm) {
        rows.push({
          label: 'LLM assessment',
          detail: [p.llm.model, p.llm.reasoning].filter(Boolean).join(' — '),
          delta: signed(p.llm.adjustment),
        });
      }
    } else {
      rows.push({
        label: 'predictive adjustment',
        detail: basis,
        delta: signed(p.adjustment),
      });
    }
  }

  return (
    <Card hover={false}>
      <CardHeader title="Risk derivation" icon={Target} />
      <CardContent>
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-white/[0.04]">
            {rows.map((r, i) => (
              <tr key={`${r.label}-${i}`}>
                <td className="py-1.5 pr-3">
                  <span className="font-mono text-secondary">{r.label}</span>
                  {r.detail && <span className="ml-2 text-[11px] text-tertiary">{r.detail}</span>}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-secondary">{r.delta}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3 text-[11px] font-semibold uppercase tracking-wider text-tertiary">
                Final (effective {breakdown.effective}, clamped 0–100)
              </td>
              <td className="py-2 text-right font-mono text-sm font-semibold tabular-nums text-white">{breakdown.final}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-tertiary">
          Server total = base + modifiers; effective = max(server, template, agent-reported); final = effective + predictive.
        </p>
      </CardContent>
    </Card>
  );
}

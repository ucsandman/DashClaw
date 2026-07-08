'use client';

import { Shield, ShieldCheck, ShieldAlert, ShieldOff, Landmark, Scale, FileCheck2 } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import type { AgentDefense } from '../lib/agent-defense';

/**
 * Agent's-advocate rollup (owner roadmap item 4): what protected this agent,
 * what it declared, what it assumed. Data comes from the `agent_defense` key
 * on GET /api/actions/{actionId} — joined by the exact guard_decision_id FK.
 * Honesty rule: absent evidence renders as "not recorded", never "clean".
 */

type Tone = 'ok' | 'attn' | 'muted';

const NOT_RECORDED: { label: string; tone: Tone } = { label: 'Not recorded', tone: 'muted' };
const INJECTION_COPY: Record<string, { label: string; tone: Tone }> = {
  clean: { label: 'Scanned, no injection found', tone: 'ok' },
  warned: { label: 'Injection pattern flagged (warn)', tone: 'attn' },
  blocked: { label: 'Injection blocked before execution', tone: 'attn' },
  disabled: { label: 'Scan disabled by operator', tone: 'muted' },
  not_recorded: NOT_RECORDED,
};

function StatusDot({ tone }: { tone: 'ok' | 'attn' | 'muted' }) {
  const cls = tone === 'ok' ? 'bg-status-success' : tone === 'attn' ? 'bg-status-warning' : 'bg-white/20';
  return <div className={`h-2 w-2 rounded-full shrink-0 ${cls}`} />;
}

function DefenseRow({ icon: Icon, label, value, tone }: {
  icon: typeof Shield;
  label: string;
  value: string;
  tone: 'ok' | 'attn' | 'muted';
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="text-disabled mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-0.5">{label}</div>
        <div className="flex items-center gap-2">
          <StatusDot tone={tone} />
          <span className={`text-xs ${tone === 'muted' ? 'text-tertiary' : 'text-secondary'}`}>{value}</span>
        </div>
      </div>
    </div>
  );
}

function defenseRows(defense: AgentDefense) {
  const { assumed, decision, shields } = defense;

  const alibi = assumed.total === 0
    ? { value: 'No assumptions declared', tone: 'muted' as const }
    : {
        value: `${assumed.total} declared · ${assumed.validated} validated · ${assumed.invalidated} invalidated · ${assumed.open} open`,
        tone: assumed.invalidated > 0 ? ('attn' as const) : ('ok' as const),
      };

  const decisionRow = decision.linked
    ? {
        value: `${(decision.decision || 'allow').replace(/_/g, ' ')} · risk ${decision.risk_score ?? '—'}`,
        tone: decision.decision === 'block' || decision.decision === 'require_approval' ? ('attn' as const) : ('ok' as const),
      }
    : { value: 'No guard decision linked', tone: 'muted' as const };

  const injection = INJECTION_COPY[shields.prompt_injection.status] ?? NOT_RECORDED;

  const nonFab = shields.non_fabrication.evaluated
    ? shields.non_fabrication.verdict === 'pass'
      ? { value: `Verified against source of truth${shields.non_fabrication.receipt ? ' · signed receipt' : ''}`, tone: 'ok' as const }
      : { value: `${shields.non_fabrication.violations} violation${shields.non_fabrication.violations === 1 ? '' : 's'} blocked`, tone: 'attn' as const }
    : { value: 'Not evaluated', tone: 'muted' as const };

  return { alibi, decisionRow, injection, nonFab };
}

export default function AgentDefenseCard({ defense }: { defense: AgentDefense | null | undefined }) {
  if (!defense) return null;
  const { alibi, decisionRow, injection, nonFab } = defenseRows(defense);

  return (
    <Card hover={false}>
      <CardHeader title="Agent Defense" icon={Shield} />
      <CardContent>
        <div className="space-y-4">
          <DefenseRow icon={Scale} label="Assumption ledger (the alibi)" value={alibi.value} tone={alibi.tone} />
          <DefenseRow icon={Landmark} label="Governance decision" value={decisionRow.value} tone={decisionRow.tone} />
          <DefenseRow icon={injection.tone === 'muted' ? ShieldOff : injection.tone === 'ok' ? ShieldCheck : ShieldAlert} label="Prompt-injection shield" value={injection.label} tone={injection.tone} />
          <DefenseRow icon={FileCheck2} label="Non-fabrication" value={nonFab.value} tone={nonFab.tone} />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Compressed variant for the shareable /replay story card: statuses and
 * counts only — never assumption or reasoning text (replay screenshots
 * travel further than the authenticated detail page).
 */
export function AgentDefenseBadges({ defense }: { defense: AgentDefense | null | undefined }) {
  if (!defense) return null;
  const { alibi, injection, nonFab } = defenseRows(defense);

  const badges: Array<{ key: string; text: string; tone: 'ok' | 'attn' | 'muted' }> = [
    { key: 'alibi', text: defense.assumed.total === 0 ? 'No assumptions declared' : `${defense.assumed.total} assumption${defense.assumed.total === 1 ? '' : 's'} on record`, tone: alibi.tone },
    { key: 'injection', text: injection.label, tone: injection.tone },
  ];
  if (defense.shields.non_fabrication.evaluated) badges.push({ key: 'nonfab', text: nonFab.value, tone: nonFab.tone });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {badges.map((b) => (
        <span key={b.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/5 px-2.5 py-1 text-[10px] text-secondary">
          <StatusDot tone={b.tone} />
          {b.text}
        </span>
      ))}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Layers, FileCog } from 'lucide-react';
import { POLICY_MODE_CATALOG } from '../../lib/policy-modes/catalog';
import Disclosure from './Disclosure';
import ModeApply, { RECOMMENDED_MODE_ID } from './ModeApply';
import AdvancedSection from './AdvancedSection';

interface PolicyRow {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  active: number;
  agent_ids: string | null;
}

interface PolicyConsoleProps {
  policies: PolicyRow[];
  /** Re-fetches policies after a mode is applied or changed. */
  onApplied: () => void;
}

const LEVEL_DOT: Record<string, string> = { low: 'bg-success', medium: 'bg-warning', high: 'bg-error' };

function parseRules(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

function parseScope(raw: string | null): string[] | null {
  // null / empty array == all agents
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) && ids.length > 0 ? ids : null;
  } catch { return null; }
}

interface ModeGroup {
  kind: 'mode';
  modeId: string;
  name: string;
  level: string;
  count: number;
  allAgents: boolean;
  agentIds: Set<string>;
}
interface CustomGroup {
  kind: 'custom';
  count: number;
  allAgents: boolean;
  agentIds: Set<string>;
}

export default function PolicyConsole({ policies, onApplied }: PolicyConsoleProps) {
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [decisionStats, setDecisionStats] = useState<{ blocks: number; approvals: number }>({ blocks: 0, approvals: 0 });

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : { agents: [] }))
      .then((d) => {
        const map: Record<string, string> = {};
        for (const a of d.agents || []) map[a.agent_id] = a.agent_name || a.agent_id;
        setAgentNames(map);
      })
      .catch(() => { /* names are a nicety; ids still render */ });
    fetch('/api/guard/decisions?limit=1')
      .then((r) => (r.ok ? r.json() : { stats: {} }))
      .then((d) => setDecisionStats({ blocks: d.stats?.blocks || 0, approvals: d.stats?.approvals || 0 }))
      .catch(() => { /* stats are non-essential */ });
  }, []);

  const active = useMemo(() => policies.filter((p) => p.active === 1), [policies]);

  const { modeGroups, custom, governedAgents } = useMemo(() => {
    const modes = new Map<string, ModeGroup>();
    const customGroup: CustomGroup = { kind: 'custom', count: 0, allAgents: false, agentIds: new Set() };
    const governed = new Set<string>();

    for (const p of active) {
      const modeId = parseRules(p.rules)._mode as string | undefined;
      const scope = parseScope(p.agent_ids);
      const allAgents = scope === null;
      if (scope) scope.forEach((id) => governed.add(id));

      const meta = modeId ? POLICY_MODE_CATALOG[modeId] : undefined;
      if (modeId && meta) {
        const g = modes.get(modeId) ?? {
          kind: 'mode' as const, modeId, name: meta.name, level: meta.interruptionLevel,
          count: 0, allAgents: false, agentIds: new Set<string>(),
        };
        g.count += 1;
        g.allAgents = g.allAgents || allAgents;
        if (scope) scope.forEach((id) => g.agentIds.add(id));
        modes.set(modeId, g);
      } else {
        customGroup.count += 1;
        customGroup.allAgents = customGroup.allAgents || allAgents;
        if (scope) scope.forEach((id) => customGroup.agentIds.add(id));
      }
    }
    return { modeGroups: [...modes.values()], custom: customGroup, governedAgents: governed };
  }, [active]);

  const primaryModeId = modeGroups[0]?.modeId ?? RECOMMENDED_MODE_ID;

  const scopeLabel = (allAgents: boolean, ids: Set<string>) => {
    if (allAgents || ids.size === 0) return 'All agents';
    const names = [...ids].map((id) => agentNames[id] || id);
    return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  };

  return (
    <div className="space-y-5">
      {/* Stat rail — prose, not a card grid */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
        <span><span className="font-semibold tabular-nums text-white">{active.length}</span> active {active.length === 1 ? 'policy' : 'policies'}</span>
        <span aria-hidden="true" className="text-zinc-700">&middot;</span>
        <span><span className="font-semibold tabular-nums text-error">{decisionStats.blocks}</span> blocks this week</span>
        <span aria-hidden="true" className="text-zinc-700">&middot;</span>
        <span><span className="font-semibold tabular-nums text-warning">{decisionStats.approvals}</span> approvals this week</span>
        <span aria-hidden="true" className="text-zinc-700">&middot;</span>
        <span>
          {governedAgents.size > 0
            ? <><span className="font-semibold tabular-nums text-white">{governedAgents.size}</span> agents scoped</>
            : <span className="text-tertiary">all agents governed</span>}
        </span>
      </div>

      {/* Governance summary */}
      <section className="rounded-xl border border-border bg-surface-secondary p-5">
        <h2 className="text-sm font-semibold text-white">What is governing your agents</h2>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {modeGroups.map((g) => (
            <li key={g.modeId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[g.level] ?? 'bg-warning'}`} />
                <span className="truncate text-sm text-white">{g.name}</span>
                <span className="text-[11px] text-tertiary">{g.level} interruption</span>
              </div>
              <div className="flex items-center gap-3 text-xs tabular-nums text-tertiary">
                <span>{`${g.count} ${g.count === 1 ? 'rule' : 'rules'}`}</span>
                <span aria-hidden="true" className="text-zinc-700">&middot;</span>
                <span className="text-secondary">{scopeLabel(g.allAgents, g.agentIds)}</span>
              </div>
            </li>
          ))}
          {custom.count > 0 && (
            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileCog size={14} aria-hidden="true" className="shrink-0 text-tertiary" />
                <span className="truncate text-sm text-white">Custom policies</span>
                <span className="text-[11px] text-tertiary">authored or imported</span>
              </div>
              <div className="flex items-center gap-3 text-xs tabular-nums text-tertiary">
                <span>{`${custom.count} ${custom.count === 1 ? 'rule' : 'rules'}`}</span>
                <span aria-hidden="true" className="text-zinc-700">&middot;</span>
                <span className="text-secondary">{scopeLabel(custom.allAgents, custom.agentIds)}</span>
              </div>
            </li>
          )}
        </ul>

        {modeGroups.length === 0 && custom.count > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-tertiary">
            <Layers size={13} aria-hidden="true" />
            No operating mode applied yet. Apply one below to cover the common cases in one step.
          </p>
        )}
      </section>

      {/* Primary action: apply or change a mode */}
      <Disclosure
        summary="Apply or change a mode"
        hint="Swap operating modes or apply another. Applying is additive and previewable."
      >
        <ModeApply defaultModeId={primaryModeId} onApplied={onApplied} />
      </Disclosure>

      {/* Everything else, demoted */}
      <AdvancedSection />
    </div>
  );
}

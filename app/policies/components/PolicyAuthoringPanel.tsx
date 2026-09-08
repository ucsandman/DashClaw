import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Users, X } from 'lucide-react';
import PolicyBasicsSection from './PolicyBasicsSection';
import PolicyRuleBuilderSection from './PolicyRuleBuilderSection';
import PolicySummaryCard from './PolicySummaryCard';

interface PolicyAgentScopeProps {
  agentIds: string[];
  setAgentIds: (value: string[] | ((prev: string[]) => string[])) => void;
  agents: any[];
}

// Group an agent id into a scannable namespace: the part before the first '/'
// (codex/Explore → codex) or '-' (ps-content-draft → ps); bare ids land in
// "standalone" so they don't each become a one-row group.
export function agentNamespace(agentId: string): string {
  const slash = agentId.indexOf('/');
  if (slash > 0) return agentId.slice(0, slash);
  const dash = agentId.indexOf('-');
  if (dash > 0) return agentId.slice(0, dash);
  return 'standalone';
}

export function PolicyAgentScope({ agentIds, setAgentIds, agents }: PolicyAgentScopeProps) {
  const isAllAgents = agentIds.length === 0;
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleAgent = (id: string) => {
    setAgentIds((prev) =>
      prev.includes(id) ? prev.filter((agentId) => agentId !== id) : [...prev, id]
    );
  };

  const groups = useMemo(() => {
    const byNs = new Map<string, Array<{ id: string; name: string }>>();
    for (const agent of agents) {
      const id = agent.agent_id as string;
      const ns = agentNamespace(id);
      if (!byNs.has(ns)) byNs.set(ns, []);
      byNs.get(ns)!.push({ id, name: agent.agent_name || id });
    }
    const q = query.trim().toLowerCase();
    const out: Array<{ ns: string; members: Array<{ id: string; name: string }> }> = [];
    for (const [ns, members] of byNs) {
      const filtered = q
        ? members.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
        : members;
      if (filtered.length === 0) continue;
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      out.push({ ns, members: filtered });
    }
    // Biggest families first — the ones you're most likely scoping by.
    out.sort((a, b) => b.members.length - a.members.length || a.ns.localeCompare(b.ns));
    return out;
  }, [agents, query]);

  const searching = query.trim().length > 0;
  const selectedSet = useMemo(() => new Set(agentIds), [agentIds]);
  const matchCount = groups.reduce((n, g) => n + g.members.length, 0);

  const selectGroup = (members: Array<{ id: string }>) => {
    setAgentIds((prev) => [...new Set([...prev, ...members.map((m) => m.id)])]);
  };
  const clearGroup = (members: Array<{ id: string }>) => {
    const ids = new Set(members.map((m) => m.id));
    setAgentIds((prev) => prev.filter((id) => !ids.has(id)));
  };

  return (
    <div>
      <label className="block text-xs text-secondary mb-2 flex items-center gap-1.5">
        <Users size={12} />
        Agent Scope
      </label>
      <div className="flex items-center gap-3 mb-2">
        <button
          type="button"
          onClick={() => setAgentIds([])}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isAllAgents
              ? 'bg-brand text-white'
              : 'bg-surface-tertiary text-secondary border border-border hover:text-white'
          }`}
        >
          All Agents
        </button>
        <span className="text-xs text-tertiary">
          {isAllAgents ? 'applies to every agent' : `${agentIds.length} selected`}
        </span>
        {!isAllAgents && (
          <button
            type="button"
            onClick={() => setAgentIds([])}
            className="text-xs text-tertiary hover:text-white underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>

      {agents.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface-tertiary/50 overflow-hidden">
          {/* Search */}
          <div className="relative border-b border-border">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <input
              aria-label="Search agents"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${agents.length} agents…`}
              className="w-full bg-transparent pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Selected chips */}
          {!isAllAgents && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {agentIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleAgent(id)}
                  title="Remove from scope"
                  className="inline-flex items-center gap-1 rounded-md bg-brand/15 border border-brand/30 px-2 py-0.5 text-[11px] text-white hover:bg-brand/25"
                >
                  {id}
                  <X size={11} />
                </button>
              ))}
            </div>
          )}

          {/* Grouped list */}
          <div className="max-h-64 overflow-y-auto p-1.5">
            {groups.length === 0 && (
              <p className="px-2 py-4 text-xs text-tertiary text-center">
                No agents match &ldquo;{query}&rdquo;.
              </p>
            )}
            {groups.map(({ ns, members }) => {
              // Groups start collapsed (100+ agents is a wall otherwise);
              // searching forces everything open.
              const isCollapsed = searching ? false : collapsed[ns] !== false;
              const selectedInGroup = members.filter((m) => selectedSet.has(m.id)).length;
              const allSelected = selectedInGroup === members.length;
              return (
                <div key={ns} className="rounded-md">
                  <div className="flex items-center gap-1 px-1.5 py-1">
                    <button
                      type="button"
                      aria-label={isCollapsed ? `Expand ${ns}` : `Collapse ${ns}`}
                      onClick={() => setCollapsed((prev) => ({ ...prev, [ns]: !isCollapsed }))}
                      className="p-1 text-tertiary hover:text-white"
                    >
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCollapsed((prev) => ({ ...prev, [ns]: !isCollapsed }))}
                      className="text-xs font-medium text-secondary hover:text-white"
                    >
                      {ns}
                    </button>
                    <span className="text-[11px] text-tertiary">
                      {members.length}{selectedInGroup > 0 ? ` · ${selectedInGroup} selected` : ''}
                    </span>
                    <span className="flex-1" />
                    {!searching && (
                      <button
                        type="button"
                        onClick={() => (allSelected ? clearGroup(members) : selectGroup(members))}
                        className="text-[11px] text-tertiary hover:text-white underline underline-offset-2"
                      >
                        {allSelected ? 'none' : 'all'}
                      </button>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div className="ml-4 mb-1 space-y-0.5">
                      {members.map((m) => (
                        <label
                          key={m.id}
                          className="flex items-center gap-2 rounded px-2 py-1 text-xs text-secondary hover:bg-surface-tertiary hover:text-white cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedSet.has(m.id)}
                            onChange={() => toggleAgent(m.id)}
                            className="accent-[var(--color-brand)]"
                          />
                          <span className="truncate" title={m.id}>
                            {m.name}
                            {m.name !== m.id && (
                              <span className="text-tertiary"> · {m.id}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {searching && (
            <div className="border-t border-border px-3 py-1.5 text-[11px] text-tertiary">
              {matchCount} match{matchCount === 1 ? '' : 'es'}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-tertiary">No agents discovered yet. Policies will apply to all agents by default.</p>
      )}
    </div>
  );
}

/**
 * The Short List opt-in (spec §4.3). Ticking it is what makes a rule allowed
 * to interrupt an unattended run; everything else is written to Watch. The
 * ten-line cap is enforced server-side, so saving an eleventh line comes back
 * 409 and the editor says so.
 */
function PolicyShortListSection({
  form,
  onChange,
}: {
  form: any;
  onChange: (field: string, value: any) => void;
}) {
  const onShortList = form.shortList === true;

  return (
    <div className="rounded-lg border border-border bg-surface-tertiary p-3">
      <label className="flex items-start gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={onShortList}
          onChange={(event) => onChange('shortList', event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-primary">Interrupts unattended runs (Short List)</span>
          Leave this off and the rule still fires and is still recorded — it just never stops the agent.
        </span>
      </label>

      {onShortList && (
        <label className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs text-secondary">
          <input
            type="checkbox"
            checked={form.ungrantable === true}
            onChange={(event) => onChange('ungrantable', event.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="block text-primary">Ungrantable</span>
            No grant, approval pause, interruption budget, or automatic tuning can lift this. Reserve it for rare classes.
          </span>
        </label>
      )}
    </div>
  );
}

interface PolicyTypeOption {
  value: string;
  label: string;
  desc?: string;
}

interface PolicyAuthoringPanelProps {
  form: any;
  policyTypes: PolicyTypeOption[];
  actionOptions: string[];
  agents: any[];
  summary?: React.ReactNode;
  onChange: (updater: (current: any) => any) => void;
  typeLocked?: boolean;
}

export default function PolicyAuthoringPanel({
  form,
  policyTypes,
  actionOptions,
  agents,
  summary,
  onChange,
  typeLocked = false,
}: PolicyAuthoringPanelProps) {
  const setField = (field: string, value: any) => onChange((current) => ({ ...current, [field]: value }));

  return (
    <div className="space-y-4">
      <PolicyBasicsSection
        form={form}
        policyTypes={policyTypes}
        onChange={setField}
        typeLocked={typeLocked}
      />

      <PolicyRuleBuilderSection
        form={form}
        actionOptions={actionOptions}
        onChange={setField}
      />

      <PolicyShortListSection form={form} onChange={setField} />

      <PolicyAgentScope
        agentIds={form.agentIds || []}
        setAgentIds={(value) =>
          onChange((current) => ({
            ...current,
            agentIds: typeof value === 'function' ? value(current.agentIds || []) : value,
          }))
        }
        agents={agents}
      />

      <PolicySummaryCard summary={summary} />
    </div>
  );
}

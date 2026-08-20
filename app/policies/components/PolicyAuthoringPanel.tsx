import { Users } from 'lucide-react';
import PolicyBasicsSection from './PolicyBasicsSection';
import PolicyRuleBuilderSection from './PolicyRuleBuilderSection';
import PolicySummaryCard from './PolicySummaryCard';

interface PolicyAgentScopeProps {
  agentIds: string[];
  setAgentIds: (value: string[] | ((prev: string[]) => string[])) => void;
  agents: any[];
}

function PolicyAgentScope({ agentIds, setAgentIds, agents }: PolicyAgentScopeProps) {
  const isAllAgents = agentIds.length === 0;

  const toggleAgent = (id: string) => {
    setAgentIds((prev) =>
      prev.includes(id) ? prev.filter((agentId) => agentId !== id) : [...prev, id]
    );
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
        <span className="text-xs text-tertiary">or pick specific agents:</span>
      </div>
      {agents.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <button
              key={agent.agent_id}
              type="button"
              onClick={() => toggleAgent(agent.agent_id)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                agentIds.includes(agent.agent_id)
                  ? 'bg-brand text-white'
                  : 'bg-surface-tertiary text-secondary border border-border hover:text-white'
              }`}
            >
              {agent.agent_name || agent.agent_id}
            </button>
          ))}
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

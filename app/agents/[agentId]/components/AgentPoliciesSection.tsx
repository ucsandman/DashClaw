'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '../../../components/ui/Badge';
import { Shield, X, ToggleLeft, ToggleRight, ExternalLink } from 'lucide-react';

function parseAgentIds(policy: any): string[] {
  if (!policy.agent_ids) return [];
  try { const p = JSON.parse(policy.agent_ids); return Array.isArray(p) ? p : []; } catch { return []; }
}

function formatPolicyRules(policy: any): string {
  const policyType = policy.policy_type || policy.type;
  let rules: any;
  try { rules = JSON.parse(policy.rules || '{}'); } catch { return policyType; }
  switch (policyType) {
    case 'risk_threshold': return `Risk >= ${rules.threshold} → ${rules.action || 'block'}`;
    case 'require_approval': return `${(rules.action_types || []).join(', ')} → require approval`;
    case 'block_action_type': return `${(rules.action_types || []).join(', ')} → block`;
    case 'rate_limit': return `Max ${rules.max_actions} / ${rules.window_minutes}min`;
    case 'webhook_check': return 'Webhook check';
    case 'semantic_check': return `Semantic: "${(rules.instruction || '').slice(0, 40)}..."`;
    case 'non_fabrication': return `Non-fabrication → ${rules.on_violation || 'block'}`;
    default: return policyType;
  }
}

interface AgentPoliciesSectionProps {
  agentId: string;
  policies?: any[];
  onRefresh?: () => void;
}

export default function AgentPoliciesSection({ agentId, policies, onRefresh }: AgentPoliciesSectionProps) {
  const [assigning, setAssigning] = useState(false);

  const applicablePolicies = (policies || []).filter(p => {
    const ids = parseAgentIds(p);
    return ids.length === 0 || ids.includes(agentId);
  });

  const handleUnassign = async (policy: any) => {
    setAssigning(true);
    try {
      const currentIds = parseAgentIds(policy);
      const newIds = currentIds.filter(id => id !== agentId);
      const res = await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, agent_ids: newIds.length > 0 ? JSON.stringify(newIds) : null }),
      });
      if (res.ok) onRefresh?.();
    } catch { /* ignore */ }
    finally { setAssigning(false); }
  };

  const handleToggleActive = async (policy: any) => {
    setAssigning(true);
    try {
      const res = await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, active: policy.active === 1 ? 0 : 1 }),
      });
      if (res.ok) onRefresh?.();
    } catch { /* ignore */ }
    finally { setAssigning(false); }
  };

  const activeCount = applicablePolicies.filter(p => p.active === 1).length;

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-tertiary" />
          <span className="text-sm font-medium text-white">Policies</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-secondary">{activeCount} of {applicablePolicies.length} active</span>
        </div>
        <Link href="/policies" className="flex items-center gap-1 text-xs text-brand hover:text-brand/80" title="Open the full policy manager">
          Manage <ExternalLink size={12} />
        </Link>
      </div>
      {applicablePolicies.length === 0 ? (
        <div className="py-4 text-center text-sm text-tertiary">
          No policies apply to this agent.{' '}
          <Link href="/policies" className="text-brand hover:underline">Create one →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {applicablePolicies.map(p => {
            const isGlobal = parseAgentIds(p).length === 0;
            const isActive = p.active === 1;
            return (
              <div key={p.id} data-entity-type="policy" data-entity-id={p.id} data-entity-status={isActive ? 'active' : 'inactive'} className={`flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-2 ${isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <Badge size="xs">{p.policy_type || p.type}</Badge>
                  <Badge variant={isActive ? 'success' : 'default'} size="xs">{isActive ? 'active' : 'inactive'}</Badge>
                  <span className="text-xs text-secondary truncate">{formatPolicyRules(p)}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={isGlobal ? 'default' : 'brand'} size="xs">{isGlobal ? 'global' : 'agent'}</Badge>
                  <button
                    onClick={() => handleToggleActive(p)}
                    disabled={assigning}
                    className="text-tertiary hover:text-white disabled:opacity-50"
                    aria-label={isActive ? `Deactivate ${p.name || p.policy_type}` : `Activate ${p.name || p.policy_type}`}
                    title={isActive ? 'Deactivate policy (affects all agents)' : 'Activate policy (affects all agents)'}
                  >
                    {isActive ? <ToggleRight size={16} className="text-brand" /> : <ToggleLeft size={16} />}
                  </button>
                  {!isGlobal && (
                    <button onClick={() => handleUnassign(p)} disabled={assigning} className="text-tertiary hover:text-error disabled:opacity-50" aria-label={`Unassign ${p.name || p.policy_type} from this agent`} title="Remove this agent from the policy's scope"><X size={12} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

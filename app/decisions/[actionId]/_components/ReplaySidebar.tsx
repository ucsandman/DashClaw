'use client';

import Link from 'next/link';
import {
  ArrowUp, Link2, ShieldCheck, ShieldAlert,
  Activity, ChevronRight, Fingerprint
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import AgentDefenseCard from '../../../components/AgentDefenseCard';

interface ReplaySidebarProps {
  action: any;
  defense: any;
  trace: any;
}

export default function ReplaySidebar({
  action, defense, trace
}: ReplaySidebarProps) {
  return (
    <div className="space-y-6">
      {/* Status & ID */}
      <Card hover={false}>
        <CardHeader title="Identity" icon={Fingerprint} />
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Decision ID</div>
              <div className="text-[11px] font-mono text-secondary break-all bg-white/5 p-2 rounded">{action.action_id}</div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Agent</div>
                <div className="text-xs text-white font-medium">{action.agent_name || action.agent_id}</div>
              </div>
              <Badge variant="info" size="xs">{action.action_type}</Badge>
            </div>
            <div>
              <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Status</div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${action.status === 'completed' ? 'bg-status-success' : 'bg-status-error'}`} />
                <span className="text-xs font-semibold text-secondary">{action.status.toUpperCase()}</span>
              </div>
            </div>
            <div>
              <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Verified Identity</div>
              <div className="flex items-center gap-1.5 text-xs">
                {action.verified
                  ? <><ShieldCheck size={14} className="text-success" /><span className="text-success">Cryptographically Signed</span></>
                  : <><ShieldAlert size={14} className="text-disabled" /><span className="text-tertiary">Unsigned session</span></>
                }
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent's-advocate rollup — what protected this agent */}
      <AgentDefenseCard defense={defense} />

      {/* Causal Chain Summary */}
      {trace && (
        <Card hover={false}>
          <CardHeader title="Decision Lineage" icon={Activity} />
          <CardContent>
            <div className="space-y-4">
              {trace.parent_chain?.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-2">Parents</div>
                  <div className="space-y-2">
                    {trace.parent_chain.map((p: any, i: number) => (
                      <Link key={i} href={`/decisions/${p.action_id}`} className="flex items-center gap-2 group">
                        <ArrowUp size={12} className="text-disabled group-hover:text-brand" />
                        <span className="text-[11px] text-secondary group-hover:text-white truncate max-w-[150px]">{p.declared_goal}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {trace.sub_actions?.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-2">Children ({trace.sub_actions.length})</div>
                  <div className="space-y-2">
                    {trace.sub_actions.slice(0, 3).map((c: any, i: number) => (
                      <Link key={i} href={`/decisions/${c.action_id}`} className="flex items-center gap-2 group">
                        <ChevronRight size={12} className="text-disabled group-hover:text-brand" />
                        <span className="text-[11px] text-secondary group-hover:text-white truncate max-w-[150px]">{c.declared_goal}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {trace.related_actions?.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-2">Correlated Actions</div>
                  <div className="space-y-2">
                    {trace.related_actions.slice(0, 3).map((r: any, i: number) => (
                      <Link key={i} href={`/decisions/${r.action_id}`} className="flex items-center gap-2 group">
                        <Link2 size={12} className="text-disabled group-hover:text-brand" />
                        <span className="text-[11px] text-secondary group-hover:text-white truncate max-w-[150px]">{r.declared_goal}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

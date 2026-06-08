import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';

function sortUrgentCapabilities(capabilities: any[]): any[] {
  const rank = (capability: any) => {
    if (capability.status === 'unhealthy' || capability.status === 'failing') return 0;
    if (capability.status === 'degraded') return 1;
    if (capability.stale_check) return 2;
    if ((capability.certification_status || 'uncertified') === 'uncertified') return 3;
    return 4;
  };

  return [...capabilities].sort((left, right) => rank(left) - rank(right));
}

interface MissionControlCapabilityHealthCardProps {
  loading?: boolean;
  error?: string | null;
  capabilities?: any[];
}

export default function MissionControlCapabilityHealthCard({
  loading = false,
  error = null,
  capabilities = [],
}: MissionControlCapabilityHealthCardProps) {
  const unhealthyCount = capabilities.filter((capability) => ['unhealthy', 'failing'].includes(capability.status)).length;
  const staleCount = capabilities.filter((capability) => capability.stale_check || capability.certification_status === 'stale').length;
  const uncertifiedCount = capabilities.filter((capability) => (capability.certification_status || 'uncertified') === 'uncertified').length;
  const allHealthy = unhealthyCount === 0 && staleCount === 0 && uncertifiedCount === 0;
  const urgentCapabilities = sortUrgentCapabilities(
    capabilities.filter((capability) => (
      ['unhealthy', 'failing', 'degraded'].includes(capability.status)
      || capability.stale_check
      || (capability.certification_status || 'uncertified') === 'uncertified'
    )),
  ).slice(0, 3);

  return (
    <Card>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Capability Health</span>
          <Link href="/capabilities" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover">
            Open <ArrowRight size={10} />
          </Link>
        </div>

        {loading ? (
          <div className="text-sm text-tertiary">Loading capability posture…</div>
        ) : error ? (
          <div className="rounded-md border border-warning/20 bg-warning-subtle px-3 py-2 text-xs text-amber-200">
            {error}
          </div>
        ) : (
          <div className="space-y-3">
            {allHealthy ? (
              <div className="flex items-center gap-2 py-1">
                <ShieldCheck size={16} className="text-success/60" />
                <span className="text-sm text-secondary">All capabilities healthy</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {unhealthyCount > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-error" />
                    <span className="font-medium text-error">{unhealthyCount} unhealthy</span>
                  </span>
                )}
                {staleCount > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />
                    <span className="font-medium text-warning">{staleCount} stale</span>
                  </span>
                )}
                {uncertifiedCount > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                    <span className="text-secondary">{uncertifiedCount} uncertified</span>
                  </span>
                )}
              </div>
            )}

            {urgentCapabilities.length > 0 && (
              <div className="space-y-1">
                {urgentCapabilities.map((capability) => (
                  <Link
                    key={capability.capability_id}
                    href={`/capabilities/${capability.capability_id}`}
                    data-entity-type="capability"
                    data-entity-id={capability.capability_id}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                  >
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${['unhealthy', 'failing'].includes(capability.status) ? 'bg-status-error' : capability.status === 'degraded' ? 'bg-status-warning' : 'bg-zinc-500/40'}`} />
                    <span className="flex-1 truncate text-xs text-secondary">
                      {capability.capability_name || capability.name}
                    </span>
                    <Badge size="xs" variant={(capability.certification_status || 'uncertified') === 'uncertified' ? 'default' : capability.certification_status === 'stale' ? 'warning' : capability.certification_status === 'failed' ? 'error' : 'success'}>
                      {capability.certification_status || 'uncertified'}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

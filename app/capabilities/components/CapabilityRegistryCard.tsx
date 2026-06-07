import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, FlaskConical, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import {
  deriveCapabilityMode,
  isRunnableHttpCapability,
} from '../lib/capabilityFormModel';

const riskVariant: Record<string, string> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  critical: 'error',
};

const healthVariant: Record<string, string> = {
  healthy: 'success',
  degraded: 'warning',
  unhealthy: 'error',
  failing: 'error',
  unknown: 'default',
  untested: 'default',
};

const healthDot: Record<string, string> = {
  healthy: 'bg-status-success',
  degraded: 'bg-status-warning',
  unhealthy: 'bg-status-error',
  failing: 'bg-status-error',
  unknown: 'bg-zinc-500',
  untested: 'bg-zinc-500',
};

const certificationVariant: Record<string, string> = {
  certified: 'success',
  stale: 'warning',
  failed: 'error',
  uncertified: 'default',
};

function hasPricing(capability: any): boolean {
  return capability.pricing && Object.keys(capability.pricing).length > 0;
}

function formatRelativeDate(value: string | null | undefined): string {
  if (!value) return 'Never tested';
  return new Date(value).toLocaleString();
}

function readRecentError(capability: any): string | null {
  const first = capability.recent_errors?.[0];
  if (!first) return null;
  return typeof first === 'string' ? first : first.message;
}

interface TestStatus {
  submitting?: boolean;
  message?: string | null;
  error?: boolean;
}

interface CapabilityRegistryCardProps {
  capability: any;
  onRunTest: (capability: any) => void;
  onDelete?: (capabilityId: string) => void | Promise<void>;
  testStatus?: TestStatus;
}

export default function CapabilityRegistryCard({
  capability,
  onRunTest,
  onDelete,
  testStatus,
}: CapabilityRegistryCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const recentError = readRecentError(capability);
  const currentHealth = capability.status || capability.health_status || 'unknown';
  const capabilityMode = deriveCapabilityMode(capability);
  const canRunTest = isRunnableHttpCapability(capability);
  const modeLabel = capabilityMode === 'runnable_http' ? 'Runnable HTTP' : 'Registry only';

  return (
    <Card className="h-full" hover={false} data-entity-type="capability" data-entity-id={capability.capability_id} data-entity-status={capability.status}>
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${healthDot[currentHealth] || healthDot.unknown}`}
                title={`health: ${currentHealth}`}
              />
              <Link
                href={`/capabilities/${capability.capability_id}`}
                className="truncate text-sm font-semibold text-white hover:text-brand"
              >
                {capability.name}
              </Link>
            </div>
            <div className="mt-0.5 truncate font-mono text-xs text-tertiary">{capability.slug}</div>
          </div>

          <Badge variant={riskVariant[capability.risk_level] || 'default'}>{capability.risk_level}</Badge>
        </div>

        {capability.description ? (
          <div className="mb-3 line-clamp-2 text-xs text-secondary">{capability.description}</div>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Badge variant={healthVariant[currentHealth] || 'default'} size="xs">
            {currentHealth}
          </Badge>
          <Badge variant={certificationVariant[capability.certification_status] || 'default'} size="xs">
            {capability.certification_status || 'uncertified'}
          </Badge>
          <Badge size="xs" variant={capability.stale_check ? 'warning' : 'success'}>
            {capability.stale_check ? 'Stale' : 'Fresh'}
          </Badge>
          <Badge size="xs" variant={canRunTest ? 'info' : 'default'}>
            {modeLabel}
          </Badge>
          {capability.category ? <Badge size="xs">{capability.category}</Badge> : null}
          {capability.requires_approval ? (
            <Badge size="xs" variant="warning">
              <ShieldAlert size={10} className="mr-1" /> approval
            </Badge>
          ) : null}
          {hasPricing(capability) ? (
            <Badge size="xs" variant="info">
              priced
            </Badge>
          ) : null}
          <Badge size="xs">{capability.source_type}</Badge>
        </div>

        <div className="mb-4 space-y-1.5 text-xs text-secondary">
          <div>
            <span className="text-tertiary">Last tested:</span>{' '}
            <span>{formatRelativeDate(capability.last_tested_at)}</span>
          </div>
          <div>
            <span className="text-tertiary">Recent failures:</span>{' '}
            <span>{capability.recent_failure_count ?? capability.failed_invocations ?? 0}</span>
          </div>
          {!canRunTest ? (
            <div className="text-tertiary">Metadata-only entry. Use detail view for registry facts.</div>
          ) : null}
          {recentError ? (
            <div className="flex items-center gap-1 text-warning">
              <AlertTriangle size={12} />
              <span className="truncate">{recentError}</span>
            </div>
          ) : null}
        </div>

        {capability.tags?.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-1">
            {capability.tags.slice(0, 4).map((tag: string) => (
              <span
                key={tag}
                className="rounded border border-border bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/capabilities/${capability.capability_id}`}
              className="text-xs text-brand hover:text-brand-hover"
            >
              Open detail
            </Link>
            <Link
              href={`/capabilities/${capability.capability_id}/edit`}
              className="inline-flex items-center gap-1 text-xs text-secondary hover:text-white"
              aria-label={`Edit ${capability.name}`}
            >
              <Pencil size={11} /> Edit
            </Link>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-error">Delete?</span>
                <button
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete?.(capability.capability_id);
                    setDeleting(false);
                    setConfirmDelete(false);
                  }}
                  disabled={deleting}
                  className="text-error hover:text-error disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-secondary hover:text-white"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1 text-xs text-secondary hover:text-error"
                aria-label={`Delete ${capability.name}`}
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
          {canRunTest ? (
            <button
              onClick={() => onRunTest(capability)}
              disabled={testStatus?.submitting}
              aria-label={`Run test ${capability.name}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-tertiary px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
            >
              <FlaskConical size={12} />
              {testStatus?.submitting ? 'Running…' : 'Run test'}
            </button>
          ) : null}
        </div>

        {testStatus?.message ? (
          <div className={`mt-3 text-xs ${testStatus.error ? 'text-error' : 'text-success'}`}>
            {testStatus.message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

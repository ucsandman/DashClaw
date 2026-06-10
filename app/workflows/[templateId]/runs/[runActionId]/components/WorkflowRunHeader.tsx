'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, RotateCcw, Ban } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  completed: { label: 'Completed', color: 'bg-emerald-400/10 text-success border-success/20' },
  failed: { label: 'Failed', color: 'bg-red-400/10 text-error border-error/20' },
  running: { label: 'Running', color: 'bg-blue-400/10 text-info border-blue-400/20' },
  cancelled: { label: 'Cancelled', color: 'bg-zinc-400/10 text-secondary border-zinc-400/20' },
};

interface WorkflowRunHeaderProps {
  run: any;
  templateId: string;
  onResume?: (stepId?: any) => void;
  resuming?: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
}

export default function WorkflowRunHeader({ run, templateId, onResume, resuming, onCancel, cancelling }: WorkflowRunHeaderProps) {
  const badge = STATUS_BADGE[run.status] || STATUS_BADGE.running!;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-tertiary">
        <Link href={`/workflows/${templateId}`} className="hover:text-secondary flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" />
          {run.template_name || 'Workflow'}
        </Link>
        <span>/</span>
        <span className="text-secondary">Run</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-primary">{run.template_name || 'Workflow Run'}</h1>
          {run.declared_goal && (
            <p className="text-sm text-secondary mt-1">{run.declared_goal}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${badge.color}`}>
            {badge.label}
          </span>
          {run.status === 'failed' && onResume && (
            <button
              onClick={onResume}
              disabled={resuming}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={`w-3 h-3 ${resuming ? 'motion-safe:animate-spin' : ''}`} />
              {resuming ? 'Resuming...' : 'Resume from checkpoint'}
            </button>
          )}
          {run.status === 'running' && onCancel && (
            <button
              onClick={onCancel}
              disabled={cancelling}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-error-subtle text-error border border-error/20 hover:bg-error-subtle hover:border-error/40 transition-colors disabled:opacity-50"
            >
              <Ban className="w-3 h-3" />
              {cancelling ? 'Cancelling...' : 'Cancel run'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-tertiary">
        {run.agent_id && <span>Agent: <span className="text-secondary">{run.agent_id}</span></span>}
        {run.duration_ms != null && <span>Duration: <span className="text-secondary">{(run.duration_ms / 1000).toFixed(1)}s</span></span>}
        <span>Steps: <span className="text-secondary">{run.steps_completed}/{run.step_count}</span></span>
        {run.started_at && <span>Started: <span className="text-secondary">{new Date(run.started_at).toLocaleString()}</span></span>}
        <Link href={`/decisions/${run.run_action_id}`} className="text-info hover:text-info flex items-center gap-1">
          Governance trace <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {run.error_message && (
        <div className="p-3 rounded-lg bg-red-400/10 border border-error/20 text-sm text-error font-mono">
          {run.error_message}
        </div>
      )}
    </div>
  );
}

'use client';

import { AlertTriangle, FileText, Database, ChevronRight, LayoutPanelLeft } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { parseJsonArray } from '../../../lib/parseJson';
import CopyButton from './CopyButton';

interface EvidenceTabProps {
  action: any;
}

export default function EvidenceTab({ action }: EvidenceTabProps) {
  return (
    <div className="space-y-6">
      <Card hover={false}>
        <CardHeader title="Action Artifacts" icon={FileText} />
        <CardContent>
          <div className="space-y-6">
            <div>
              <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-3">Side Effects</div>
              {parseJsonArray(action.side_effects).length > 0 ? (
                <div className="space-y-2">
                  {parseJsonArray(action.side_effects).map((se: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded bg-status-warning/5 border border-warning/10 text-xs text-amber-200">
                      <AlertTriangle size={14} className="shrink-0" />
                      {se}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-tertiary italic">No side effects recorded.</div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-3">Created Artifacts</div>
              {parseJsonArray(action.artifacts_created).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {parseJsonArray(action.artifacts_created).map((a: any, i: number) => (
                    <div key={i} className="px-3 py-1.5 rounded bg-status-info/5 border border-blue-500/10 text-xs text-info font-mono">
                      {a}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-tertiary italic">No artifacts recorded.</div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-3">Systems Touched</div>
              {parseJsonArray(action.systems_touched).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {parseJsonArray(action.systems_touched).map((s: any, i: number) => (
                    <div key={i} className="px-3 py-1.5 rounded bg-surface-tertiary border border-white/5 text-xs text-secondary">
                      <Database size={12} className="inline mr-2 opacity-50" />
                      {s}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-tertiary italic">No systems recorded.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card hover={false}>
        <CardHeader title="Raw payload (export / debug)" icon={LayoutPanelLeft} />
        <CardContent>
          <details className="group">
            <summary className="flex cursor-pointer select-none items-center gap-2 text-xs text-tertiary transition-colors hover:text-secondary [&::-webkit-details-marker]:hidden">
              <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
              <span>Show full decision object (JSON)</span>
            </summary>
            <div className="mt-3 flex justify-end">
              <CopyButton text={JSON.stringify(action, null, 2)} label="Copy JSON" />
            </div>
            <pre className="mt-2 p-4 bg-primary rounded border border-white/5 text-[10px] text-secondary font-mono overflow-auto max-h-[400px]">
              {JSON.stringify(action, null, 2)}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

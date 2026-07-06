'use client';

import { XCircle, RefreshCw, ArrowUp, ShieldCheck, ShieldAlert, Activity } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

interface SignalsTabProps {
  trace: any;
}

export default function SignalsTab({ trace }: SignalsTabProps) {
  return (
    <div className="space-y-6">
      <Card hover={false}>
        <CardHeader title="Risk Signal Analysis" icon={ShieldAlert} />
        <CardContent>
          {trace?.root_cause_indicators?.length > 0 ? (
            <div className="space-y-4">
              {trace.root_cause_indicators.map((indicator: any, idx: number) => (
                <div key={idx} className={`p-4 rounded-lg border-l-4 ${
                  indicator.severity === 'high' ? 'border-error bg-error-subtle' : 'border-warning bg-warning-subtle'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-white font-semibold text-sm flex items-center gap-2">
                      {indicator.type === 'invalidated_assumptions' && <XCircle size={14} className="text-error" />}
                      {indicator.type === 'unresolved_loops' && <RefreshCw size={14} className="text-warning" />}
                      {indicator.type === 'parent_failures' && <ArrowUp size={14} className="text-warning" />}
                      <span className="uppercase tracking-wider text-xs">{indicator.type.replace(/_/g, ' ')}</span>
                    </div>
                    <Badge variant={indicator.severity === 'high' ? 'error' : 'warning'} size="xs">
                      {indicator.severity.toUpperCase()} ALERT
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {indicator.detail.map((item: any, i: number) => (
                      <div key={i} className="text-xs text-secondary bg-black/20 p-2 rounded">
                        {item.assumption || item.description || item.goal || 'Signal detail'}
                        {item.reason && <span className="block mt-1 text-tertiary">Reason: {item.reason}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <ShieldCheck size={40} className="text-success/20 mx-auto mb-4" />
              <div className="text-secondary font-medium">No anomaly signals detected</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card hover={false}>
        <CardHeader title="Autonomy Spikes" icon={Activity} />
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-12 flex items-end gap-1">
              {[20, 35, 25, 60, 45, 30, 80, 20, 15, 25, 30, 35, 40].map((h, i) => (
                <div key={i} className={`flex-1 rounded-t-sm transition-all ${i === 6 ? 'bg-status-warning' : 'bg-tertiary'}`} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="text-right">
              <div className="text-xs text-tertiary uppercase">Current Variance</div>
              <div className="text-lg font-bold text-white">+12%</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

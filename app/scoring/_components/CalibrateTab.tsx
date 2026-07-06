'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Card } from '../../components/ui/Card';
import { distributionSegmentPct } from '../../lib/scoring-ui';
import { CALIBRATE_METRICS, type CalibrateFormState } from './types';

interface CalibrateTabProps {
  calibrateForm: CalibrateFormState;
  setCalibrateForm: Dispatch<SetStateAction<CalibrateFormState>>;
  calibration: any;
  onCalibrate: () => void;
  onApplyCalibration: (suggestion: any) => void;
}

export default function CalibrateTab({
  calibrateForm, setCalibrateForm, calibration, onCalibrate, onApplyCalibration,
}: CalibrateTabProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Auto-Calibration</h2>
      <p className="text-sm text-secondary mb-4">
        Analyze your historical action data to generate suggested scoring scales.
        Based on percentile analysis of your real data  --  no LLM involved.
      </p>

      <Card className="mb-6 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input value={calibrateForm.action_type}
            onChange={e => setCalibrateForm(f => ({ ...f, action_type: e.target.value }))}
            placeholder="Action type (optional, blank = all)"
            className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-tertiary">Lookback:</label>
            <input type="number" value={calibrateForm.lookback_days}
              onChange={e => setCalibrateForm(f => ({ ...f, lookback_days: parseInt(e.target.value) || 30 }))}
              className="w-20 px-2 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
            <span className="text-xs text-tertiary">days</span>
          </div>
        </div>
        <input value={calibrateForm.agent_id}
          onChange={e => setCalibrateForm(f => ({ ...f, agent_id: e.target.value }))}
          placeholder="Agent ID (optional, blank = all agents)"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
        <div>
          <label className="text-xs text-tertiary">Metrics to analyze:</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {CALIBRATE_METRICS.map(m => {
              const on = calibrateForm.metrics.includes(m);
              return (
                <button key={m} type="button"
                  onClick={() => setCalibrateForm(f => ({
                    ...f, metrics: on ? f.metrics.filter(x => x !== m) : [...f.metrics, m],
                  }))}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    on ? 'bg-brand text-black' : 'bg-secondary text-tertiary hover:text-secondary'
                  }`}>{m.replace(/_/g, ' ')}</button>
              );
            })}
          </div>
        </div>
        <button onClick={onCalibrate}
          className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90">
          Analyze Data
        </button>
      </Card>

      {calibration && calibration.status === 'insufficient_data' && (
        <Card className="p-4">
          <p className="text-sm text-warning">{calibration.message}</p>
        </Card>
      )}

      {calibration && calibration.status === 'ok' && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Analyzed <span className="text-white font-medium">{calibration.count}</span> actions
            over the last {calibration.lookback_days} days
            {calibration.action_type !== '(all)' && ` for type "${calibration.action_type}"`}.
          </p>

          {calibration.suggestions.map((s: any, i: number) => (
            <Card key={i} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-sm font-medium text-white">{s.metric.replace(/_/g, ' ')}</h3>
                  <p className="text-xs text-tertiary mt-1">
                    {s.sample_size} data points * {s.lower_is_better ? 'Lower is better' : 'Higher is better'}
                  </p>
                </div>
                <button onClick={() => onApplyCalibration(s)}
                  className="text-xs text-brand hover:text-brand/80">Apply as Profile</button>
              </div>

              {/* Distribution visualization (zero-guarded: identical samples → 0-width bands, not NaN%) */}
              <div className="mt-3 flex items-center gap-1 text-xs">
                <span className="text-disabled w-16">min: {s.distribution.min}</span>
                <div className="flex-1 h-6 bg-secondary rounded relative overflow-hidden">
                  <div className="absolute inset-y-0 bg-error-subtle" style={{
                    left: '0%', width: `${distributionSegmentPct(s.distribution.min, s.distribution.p25, s.distribution.min, s.distribution.max)}%`
                  }} />
                  <div className="absolute inset-y-0 bg-warning-subtle" style={{
                    left: `${distributionSegmentPct(s.distribution.min, s.distribution.p25, s.distribution.min, s.distribution.max)}%`,
                    width: `${distributionSegmentPct(s.distribution.p25, s.distribution.p75, s.distribution.min, s.distribution.max)}%`
                  }} />
                  <div className="absolute inset-y-0 bg-success-subtle" style={{
                    left: `${distributionSegmentPct(s.distribution.min, s.distribution.p75, s.distribution.min, s.distribution.max)}%`,
                    width: `${distributionSegmentPct(s.distribution.p75, s.distribution.max, s.distribution.min, s.distribution.max)}%`
                  }} />
                </div>
                <span className="text-disabled w-16 text-right">max: {s.distribution.max}</span>
              </div>

              {/* Suggested scale */}
              <div className="mt-2 grid grid-cols-4 gap-2">
                {s.suggested_scale.map((rule: any, j: number) => (
                  <div key={j} className={`p-2 rounded text-center ${
                    rule.label === 'excellent' ? 'bg-success-subtle text-success' :
                    rule.label === 'good' ? 'bg-info-subtle text-info' :
                    rule.label === 'acceptable' ? 'bg-status-warning/10 text-warning' :
                    'bg-error-subtle text-error'
                  }`}>
                    <div className="text-xs font-medium">{rule.label}</div>
                    <div className="text-xs mt-0.5">{rule.operator} {
                      Array.isArray(rule.value) ? rule.value.join('-') : rule.value
                    }</div>
                    <div className="text-xs text-tertiary">score: {rule.score}</div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-disabled mt-2">
                Suggested weight: {s.suggested_weight}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

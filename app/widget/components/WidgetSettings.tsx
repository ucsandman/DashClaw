'use client';

import React from 'react';
import { InstallButton } from './InstallButton';
import type { WidgetPrefs, WidgetSectionPrefs, WidgetMetricPrefs } from '../../lib/widgetPrefs';

const SECTION_LABELS: ReadonlyArray<{ key: keyof WidgetSectionPrefs; label: string }> = [
  { key: 'metrics', label: 'Metrics strip' },
  { key: 'approvals', label: 'Pending approvals' },
  { key: 'topSignal', label: 'Top signal' },
  { key: 'recentLog', label: 'Recent actions' },
];

const METRIC_LABELS: ReadonlyArray<{ key: keyof WidgetMetricPrefs; label: string }> = [
  { key: 'agents', label: 'Agents' },
  { key: 'pending', label: 'Pending' },
  { key: 'signals', label: 'Signals' },
  { key: 'spend', label: '24h spend' },
];

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-2 py-1">
      <span className="text-xs text-secondary">{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-brand"
      />
    </label>
  );
}

/**
 * Inline settings panel (no modal, no route): section + metric visibility
 * toggles persisted via widgetPrefs, plus the PWA install affordance moved out
 * of the header. When URL overrides (?hide=/?show=) are active they win over
 * these toggles — say so instead of silently ignoring clicks.
 */
export function WidgetSettings({
  prefs,
  onChange,
  overridesActive,
}: {
  prefs: WidgetPrefs;
  onChange: (next: WidgetPrefs) => void;
  overridesActive: boolean;
}) {
  const setSection = (key: keyof WidgetSectionPrefs, value: boolean) =>
    onChange({ ...prefs, sections: { ...prefs.sections, [key]: value } });
  const setMetric = (key: keyof WidgetMetricPrefs, value: boolean) =>
    onChange({ ...prefs, metrics: { ...prefs.metrics, [key]: value } });

  return (
    <section aria-label="Widget settings" className="border-b border-border bg-surface-tertiary/40 px-3 py-2.5">
      {overridesActive ? (
        <p className="mb-2 text-xs text-warning">
          URL overrides (?hide= / ?show=) are active and win over these settings.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          <div className="pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">Sections</div>
          {SECTION_LABELS.map(({ key, label }) => (
            <ToggleRow
              key={key}
              id={`widget-section-${key}`}
              label={label}
              checked={prefs.sections[key]}
              onChange={(v) => setSection(key, v)}
            />
          ))}
        </div>
        <div>
          <div className="pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">Metrics</div>
          {METRIC_LABELS.map(({ key, label }) => (
            <ToggleRow
              key={key}
              id={`widget-metric-${key}`}
              label={label}
              checked={prefs.metrics[key]}
              onChange={(v) => setMetric(key, v)}
            />
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-tertiary">
        Pending approvals stay visible while any decision is waiting.
      </p>
      <div className="mt-2 border-t border-border pt-2">
        <InstallButton showFallbackHint />
      </div>
    </section>
  );
}

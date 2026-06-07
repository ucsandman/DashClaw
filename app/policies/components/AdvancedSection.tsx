'use client';

import { useState } from 'react';
import { Shield, FileCode, Activity } from 'lucide-react';
import Disclosure from './Disclosure';
import ShieldsGrid from './ShieldsGrid';
import CustomTab from './CustomTab';
import ActivityTab from './ActivityTab';

type AdvancedView = 'shields' | 'custom' | 'activity';

const VIEWS: Array<{ id: AdvancedView; label: string; icon: typeof Shield; hint: string }> = [
  { id: 'shields', label: 'Shields', icon: Shield, hint: 'One-tap guard presets' },
  { id: 'custom', label: 'Custom', icon: FileCode, hint: 'Author, import, AI-generate, simulate, test, proof' },
  { id: 'activity', label: 'Activity', icon: Activity, hint: 'Live guard-decision feed' },
];

/**
 * The "Advanced" disclosure. Demotes the former Shields / Custom / Activity
 * tabs to a single collapsed surface: every capability is preserved (each
 * component is self-contained and mounted unchanged), but none competes with
 * the primary mode-apply action. The inner switcher is visually subordinate —
 * it is not a co-equal top-level tab bar.
 */
export default function AdvancedSection() {
  const [view, setView] = useState<AdvancedView>('shields');

  return (
    <Disclosure
      summary="Advanced"
      hint="Shields, custom policy authoring, and the decision activity feed."
    >
      <div className="rounded-xl border border-border bg-surface-secondary p-4">
        <div role="tablist" aria-label="Advanced policy tools" className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = view === v.id;
            return (
              <button
                key={v.id}
                role="tab"
                aria-selected={active}
                title={v.hint}
                onClick={() => setView(v.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-brand/40 bg-brand/10 text-brand'
                    : 'border-white/5 bg-white/5 text-tertiary hover:text-secondary'
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                {v.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          {view === 'shields' && <ShieldsGrid />}
          {view === 'custom' && <CustomTab />}
          {view === 'activity' && <ActivityTab />}
        </div>
      </div>
    </Disclosure>
  );
}

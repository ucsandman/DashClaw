'use client';

import { ShieldCheck } from 'lucide-react';
import ModeApply from './ModeApply';
import AdvancedSection from './AdvancedSection';

interface PolicyFrontDoorProps {
  /** Re-checks governance state after a mode is applied (zero → populated). */
  onApplied: () => void;
}

/**
 * Zero-policy state: the guided front door. One opinionated screen, not a
 * wizard. It recommends Claude Code Mode, shows exactly what that will enforce
 * plus the interruption forecast, takes scope + spend cap inline, and applies
 * in a single action. Manual authoring stays reachable, demoted to Advanced.
 */
export default function PolicyFrontDoor({ onApplied }: PolicyFrontDoorProps) {
  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 rounded-lg border border-border bg-surface-secondary p-2 text-brand">
          <ShieldCheck size={18} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">No policies are governing your agents yet</h2>
          <p className="mt-1 text-sm leading-relaxed text-secondary">
            Start with an operating mode. It compiles to a pack of guard rules you can read before applying, so
            governance is one decision instead of a blank policy editor.
          </p>
        </div>
      </div>

      <ModeApply onApplied={onApplied} />

      <AdvancedSection />
    </div>
  );
}

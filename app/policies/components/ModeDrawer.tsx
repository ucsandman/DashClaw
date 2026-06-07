'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchModes, previewMode, importMode } from '../lib/modesClient';
import type { PolicyModeSummary, ModePreview } from '../lib/modesClient';

interface ModeDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Parent refetches the posture summary after a successful apply. */
  onApplied: () => void;
}

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

const LEVEL_BADGE: Record<string, string> = {
  low: 'text-success border-border',
  medium: 'text-warning border-border',
  high: 'text-error border-border',
};

/**
 * The mode picker drawer — the cockpit's single elevated surface. Slides in
 * from the right over a dimmed backdrop, traps focus, closes on Escape or
 * backdrop click (without applying). Lists modes, previews a selected mode's
 * compiled buckets + a real friction forecast, and applies in one action.
 */
export default function ModeDrawer({ open, onClose, onApplied }: ModeDrawerProps) {
  const [modes, setModes] = useState<PolicyModeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ModePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const selectedMode = modes.find((m) => m.id === selectedId) ?? preview?.mode ?? null;

  // Load modes when the drawer opens.
  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    fetchModes()
      .then(setModes)
      .catch((e) => setLoadError((e as Error).message));
  }, [open]);

  // Preview the selected mode.
  useEffect(() => {
    if (!selectedId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreview(null);
    setApplyError(null);
    previewMode(selectedId)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, [selectedId]);

  // Reset selection + focus the panel each time the drawer opens.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setPreview(null);
      setApplyError(null);
      return;
    }
    panelRef.current?.focus();
  }, [open]);

  // Escape closes; Tab is trapped within the panel.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handleApply = useCallback(async () => {
    if (!selectedId) return;
    setApplying(true);
    setApplyError(null);
    try {
      await importMode(selectedId);
      onApplied();
      onClose();
    } catch (e) {
      setApplyError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [selectedId, onApplied, onClose]);

  if (!open) return null;

  const friction = preview?.friction;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Change operating mode"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 motion-safe:animate-[fadeIn_0.2s_ease-out]"
      />

      {/* Panel — the only elevated surface */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-[480px] max-w-full flex-col border-l border-border bg-surface-elevated outline-none transition-transform duration-200 ease-out motion-reduce:transition-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <span className={SECTION_LABEL}>Change mode</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
          >
            Cancel
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loadError && <p className="text-xs text-error">Could not load modes: {loadError}</p>}

          <ul className="divide-y divide-border">
            {modes.map((mode) => {
              const isSelected = mode.id === selectedId;
              return (
                <li key={mode.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(mode.id)}
                    aria-pressed={isSelected}
                    className="flex w-full flex-col gap-1 py-3 text-left transition-colors hover:bg-white/5 motion-reduce:transition-none"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className={isSelected ? 'text-sm text-brand' : 'text-sm text-secondary'}>
                        {mode.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${
                          LEVEL_BADGE[mode.interruptionLevel] ?? 'text-tertiary border-border'
                        }`}
                      >
                        {mode.interruptionLevel}
                      </span>
                    </span>
                    <span className="text-xs text-tertiary">{mode.uxPromise}</span>
                  </button>

                  {/* Impact preview, inline under the selected mode */}
                  {isSelected && (
                    <div className="border-t border-border py-3">
                      <span className={SECTION_LABEL}>Impact preview</span>
                      {!preview ? (
                        <p className="mt-1.5 text-xs text-tertiary">Loading preview…</p>
                      ) : (
                        <div className="mt-1.5 space-y-1.5">
                          {friction?.available ? (
                            <p className="text-xs text-secondary">
                              Would pause{' '}
                              <span className="tabular-nums text-warning">
                                {friction.summary.require_approval + friction.summary.block}
                              </span>{' '}
                              of <span className="tabular-nums">{friction.sample_size}</span> recent actions.
                              {friction.excluded_policy_types.length > 0 && (
                                <span className="block text-tertiary">
                                  excluded: {friction.excluded_policy_types.join(', ')}
                                </span>
                              )}
                            </p>
                          ) : (
                            <p className="text-xs text-tertiary">{friction?.reason}</p>
                          )}
                          <p className="text-xs tabular-nums text-tertiary">
                            <span className="text-secondary">{preview.summary.warn}</span> warn
                            {' · '}
                            <span className="text-secondary">{preview.summary.require_approval}</span> approval
                            {' · '}
                            <span className="text-secondary">{preview.summary.block}</span> block
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4">
          {applyError && <p className="mb-2 text-xs text-error">{applyError}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleApply}
              disabled={!selectedId || applying}
              className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-xs font-medium text-brand transition-colors hover:border-brand/60 hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {applying ? 'Applying…' : `Apply ${selectedMode?.name ?? 'mode'}`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-tertiary">Applies to all agents</p>
        </div>
      </div>
    </div>
  );
}

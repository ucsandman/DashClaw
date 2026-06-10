'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * Icon-only copy affordance for project paths rendered inside row Links —
 * preventDefault/stopPropagation so copying never navigates. Quieter than
 * InlineCopyCommand (a command pill) per the calm/evidence-first register.
 */
export default function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Copy path ${path}`}
      title="Copy path"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          navigator.clipboard?.writeText(path);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard denied — non-fatal for a convenience action */
        }
      }}
      className="rounded p-0.5 text-tertiary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
    >
      {copied ? <Check size={12} className="text-status-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}

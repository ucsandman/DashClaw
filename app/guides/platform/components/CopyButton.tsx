'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyButton({ value, compact = false }: { value: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-tertiary text-xs text-secondary transition-colors hover:border-border-hover hover:text-white ${
        compact ? 'px-2 py-1' : 'px-3 py-1.5'
      }`}
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {!compact && (copied ? 'Copied' : 'Copy')}
    </button>
  );
}

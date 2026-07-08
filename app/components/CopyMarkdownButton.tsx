'use client';

import { useState, useCallback } from 'react';
import { Copy, Check, FileText } from 'lucide-react';

interface CopyMarkdownButtonProps {
  href?: string;
  label?: string;
  rawLabel?: string;
  className?: string;
}

export default function CopyMarkdownButton({
  href,
  label = 'Copy as Markdown',
  rawLabel = 'View raw',
  className = '',
}: CopyMarkdownButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      const res = await fetch(href as string);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.open(href, '_blank');
    }
  }, [href]);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] border border-border-hover text-sm text-secondary hover:text-white hover:bg-white/[0.1] transition-colors"
      >
        {copied ? (
          <>
            <Check size={16} className="text-success" />
            <span className="text-success">Copied!</span>
          </>
        ) : (
          <>
            <Copy size={16} />
            {label}
          </>
        )}
      </button>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-tertiary hover:text-secondary transition-colors"
      >
        <FileText size={14} />
        {rawLabel}
      </a>
    </div>
  );
}

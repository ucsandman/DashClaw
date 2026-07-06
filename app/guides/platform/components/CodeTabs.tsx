'use client';

import { useState } from 'react';
import CopyButton from './CopyButton';

export interface CodeForm {
  label: string;
  code: string;
  response?: string;
  verified?: string;
}

/**
 * Tabbed code sample. First tab is the default (PowerShell-first convention
 * for HTTP examples). Every tab gets copy-to-clipboard; captured responses
 * render beneath the request with a "live-captured" stamp when present.
 */
export default function CodeTabs({ forms, title }: { forms: CodeForm[]; title?: string }) {
  const [active, setActive] = useState(0);
  const form = forms[active];
  if (!form) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border-hover bg-surface-secondary">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {title && <span className="mr-2 text-xs font-medium text-secondary">{title}</span>}
          {forms.map((f, i) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors ${
                i === active
                  ? 'bg-brand/15 text-brand'
                  : 'text-text-tertiary hover:bg-surface-tertiary hover:text-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <CopyButton value={form.code} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed text-secondary">
        {form.code}
      </pre>
      {form.response && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-4 pt-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
              Response{form.verified ? ` — captured ${form.verified}` : ''}
            </p>
            <CopyButton value={form.response} compact />
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed text-text-tertiary">
            {form.response}
          </pre>
        </div>
      )}
    </div>
  );
}

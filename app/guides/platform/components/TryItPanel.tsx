// Client component — inherits the client boundary from its importer
// (ReferenceItem), so no 'use client' directive is needed here and function
// props stay allowed.
import { useEffect, useState } from 'react';
import { Play, X } from 'lucide-react';
import CopyButton from './CopyButton';

import { loadTryItConfig, saveTryItConfig, type TryItConfig } from '../lib/tryitConfig';

/**
 * Runs a real request against the reader's OWN instance with a key they
 * supply. The key lives in localStorage on their machine only — nothing is
 * baked in and nothing is sent anywhere except the base URL they configure.
 */
export default function TryItPanel({
  method,
  path,
  defaultBody,
  onClose,
}: {
  method: string;
  path: string;
  defaultBody?: string;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<TryItConfig>({ baseUrl: '', apiKey: '' });
  const [body, setBody] = useState(defaultBody || '');
  const [result, setResult] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConfig(loadTryItConfig());
  }, []);

  function saveConfig(next: TryItConfig) {
    setConfig(next);
    saveTryItConfig(next);
  }

  async function send() {
    setBusy(true);
    setResult(null);
    setStatus(null);
    try {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'x-api-key': config.apiKey,
          ...(body.trim() ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body.trim() && method !== 'GET' ? body : undefined,
      });
      setStatus(`${res.status} ${res.statusText}`);
      const text = await res.text();
      try {
        setResult(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResult(text.slice(0, 4000));
      }
    } catch (err) {
      setStatus('network error');
      setResult(String(err));
    } finally {
      setBusy(false);
    }
  }

  const hasBody = method !== 'GET' && method !== 'DELETE';

  return (
    <div className="mt-3 rounded-xl border border-brand/25 bg-surface-tertiary p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wider text-brand">
          Try it — {method} {path}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close try-it panel"
          className="text-text-tertiary transition-colors hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-text-tertiary">Instance base URL</span>
          <input
            type="url"
            value={config.baseUrl}
            onChange={(e) => saveConfig({ ...config, baseUrl: e.target.value })}
            placeholder="http://localhost:3000"
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-text-tertiary">
            <span>API key (stored only in your browser)</span>
            {config.baseUrl && (
              <a
                href={`${config.baseUrl.replace(/\/$/, '')}/api-keys`}
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                create one →
              </a>
            )}
          </span>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => saveConfig({ ...config, apiKey: e.target.value })}
            placeholder="paste your x-api-key"
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
      </div>
      {hasBody && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-text-tertiary">JSON body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={busy || !config.baseUrl || !config.apiKey}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={12} />
          {busy ? 'Sending…' : 'Send request'}
        </button>
        {status && <span className="font-mono text-xs text-secondary">{status}</span>}
        <span className="text-[11px] text-text-tertiary">
          Runs from your browser against your instance. Cross-origin calls need your instance to allow them.
        </span>
      </div>
      {result && (
        <div className="mt-3 rounded-lg border border-border bg-surface-primary">
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">Response</span>
            <CopyButton value={result} compact />
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-secondary">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}

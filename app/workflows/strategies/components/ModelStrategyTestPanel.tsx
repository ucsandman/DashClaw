'use client';

import { useState } from 'react';
import { FlaskConical, AlertTriangle, ArrowDownRight } from 'lucide-react';

interface ProviderError {
  provider: string;
  model?: string;
  error: string;
}

interface TestResult {
  provider: string;
  model: string;
  fallback_used?: boolean;
  cost_usd?: number;
  content?: string;
}

interface ModelStrategyTestPanelProps {
  strategyId: string;
}

/**
 * Runs a live completion through a strategy's primary -> fallback chain
 * (POST /api/model-strategies/:id/complete). Uses the org's BYOK provider
 * credentials and counts real tokens/cost, so it is gated behind an explicit
 * "Run failover test" action with a clear live-call warning.
 */
export default function ModelStrategyTestPanel({ strategyId }: ModelStrategyTestPanelProps) {
  const [message, setMessage] = useState('Reply with a single word: ping.');
  const [maxTokens, setMaxTokens] = useState<number | string>(256);
  const [temperature, setTemperature] = useState<number | string>(0.7);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [providerErrors, setProviderErrors] = useState<ProviderError[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setRunning(true);
    setResult(null);
    setProviderErrors(null);
    setError(null);
    try {
      const res = await fetch(`/api/model-strategies/${strategyId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: message }],
          // Only send a positive budget; otherwise let the route default apply.
          max_tokens: Number(maxTokens) > 0 ? Number(maxTokens) : undefined,
          temperature: Number(temperature),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(data);
      } else if (data.provider_errors) {
        setProviderErrors(data.provider_errors);
        setError(data.error || 'All providers in the chain failed.');
      } else {
        setError(data.error || 'Failover test failed.');
      }
    } catch {
      setError('Failover test failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-5">
      <div className="flex items-center gap-2">
        <FlaskConical size={14} className="text-brand" aria-hidden="true" />
        <span className="text-sm font-semibold text-white">Test failover</span>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-xs text-amber-200/90">
          This runs a real completion through the primary → fallback chain using your
          org&apos;s BYOK provider credentials. It consumes real tokens and is billed by
          the provider.
        </p>
      </div>

      <div>
        <label htmlFor="ms-test-message" className="mb-1 block text-[11px] uppercase tracking-wider text-tertiary">Prompt</label>
        <textarea
          id="ms-test-message"
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-xs text-secondary focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ms-test-max" className="mb-1 block text-[11px] uppercase tracking-wider text-tertiary">Max tokens</label>
          <input
            id="ms-test-max"
            type="number"
            min="1"
            value={maxTokens}
            onChange={e => setMaxTokens(e.target.value)}
            className="w-24 rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary focus:border-brand/50 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="ms-test-temp" className="mb-1 block text-[11px] uppercase tracking-wider text-tertiary">Temperature</label>
          <input
            id="ms-test-temp"
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={temperature}
            onChange={e => setTemperature(e.target.value)}
            className="w-24 rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary focus:border-brand/50 focus:outline-none"
          />
        </div>
        <button
          onClick={runTest}
          disabled={running || !message.trim()}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
        >
          <FlaskConical size={12} aria-hidden="true" /> {running ? 'Running…' : 'Run failover test'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{error}</div>
      )}

      {providerErrors && (
        <ul className="space-y-1">
          {providerErrors.map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-tertiary">
              <ArrowDownRight size={12} className="shrink-0 text-error" aria-hidden="true" />
              <span className="font-medium text-secondary">{e.provider}</span>
              {e.model && <span className="font-mono text-[11px]">{e.model}</span>}
              <span className="text-error">{e.error}</span>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-border bg-surface-tertiary p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-white">{result.provider}</span>
            <span className="font-mono text-[11px] text-secondary">{result.model}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${result.fallback_used ? 'bg-warning-subtle text-warning' : 'bg-emerald-900/10 text-success'}`}>
              {result.fallback_used ? 'fallback used' : 'primary'}
            </span>
            <span className="tabular-nums text-tertiary">${Number(result.cost_usd || 0).toFixed(6)}</span>
          </div>
          <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-xs text-secondary">{result.content}</pre>
        </div>
      )}
    </div>
  );
}

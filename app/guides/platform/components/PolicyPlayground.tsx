// Client component — inherits the client boundary from PlatformGuideClient.
import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import CopyButton from './CopyButton';
import { loadTryItConfig, saveTryItConfig, type TryItConfig } from '../lib/tryitConfig';

/**
 * Draft a policy, replay it against YOUR instance's recent action history via
 * POST /api/policies/simulate, and see what it would have blocked, warned, or
 * gated — before activating anything. Read-only: simulation never creates or
 * modifies a policy.
 *
 * Rule templates below mirror real policy shapes observed live on a running
 * instance (see the policies example in the quickstart).
 */
const TEMPLATES: Array<{ type: string; label: string; rules: string }> = [
  {
    type: 'risk_threshold',
    label: 'Risk threshold',
    rules: '{\n  "threshold": 70,\n  "action": "require_approval"\n}',
  },
  {
    type: 'require_approval',
    label: 'Require approval',
    rules: '{\n  "action_types": ["deploy", "migrate"]\n}',
  },
  {
    type: 'block_action_type',
    label: 'Block action type',
    rules: '{\n  "action_types": ["deploy"]\n}',
  },
  {
    type: 'warn_action_type',
    label: 'Warn action type',
    rules: '{\n  "action_types": ["message", "post", "email"]\n}',
  },
  {
    type: 'rate_limit',
    label: 'Rate limit',
    rules: '{\n  "max_actions": 250,\n  "window_minutes": 30,\n  "action": "warn"\n}',
  },
  {
    type: 'protected_path',
    label: 'Protected path',
    rules: '{\n  "paths": ["**/.env*", "secrets/**", "**/*.pem"],\n  "action": "require_approval"\n}',
  },
  {
    type: 'permission_escalation',
    label: 'Permission escalation',
    rules: '{\n  "action": "require_approval",\n  "patterns": ["sudo", "rm -rf", "git reset --hard"]\n}',
  },
];

interface SimSummary {
  total: number;
  matches: number;
  block: number;
  warn: number;
  require_approval: number;
  allow: number;
}

interface SimMatch {
  action_id?: string;
  action_type?: string;
  declared_goal?: string;
  result?: string;
  [key: string]: unknown;
}

export default function PolicyPlayground() {
  const [config, setConfig] = useState<TryItConfig>({ baseUrl: '', apiKey: '' });
  const [templateIdx, setTemplateIdx] = useState(0);
  const [rules, setRules] = useState(TEMPLATES[0]?.rules ?? '{}');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SimSummary | null>(null);
  const [matches, setMatches] = useState<SimMatch[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setConfig(loadTryItConfig());
  }, []);

  function pickTemplate(idx: number) {
    setTemplateIdx(idx);
    setRules(TEMPLATES[idx]?.rules ?? '{}');
    setSummary(null);
    setMatches([]);
    setError(null);
  }

  function updateConfig(next: TryItConfig) {
    setConfig(next);
    saveTryItConfig(next);
  }

  async function run() {
    setBusy(true);
    setError(null);
    setSummary(null);
    setMatches([]);
    setMessage(null);
    let parsedRules: unknown;
    try {
      parsedRules = JSON.parse(rules);
    } catch {
      setError('Rules must be valid JSON.');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/policies/simulate`, {
        method: 'POST',
        headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_type: TEMPLATES[templateIdx]?.type, rules: parsedRules, days }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
      } else {
        setSummary(data.summary || null);
        setMatches(Array.isArray(data.matches) ? data.matches.slice(0, 10) : []);
        setMessage(data.message || null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const template = TEMPLATES[templateIdx];

  return (
    <div className="rounded-xl border border-brand/25 bg-surface-secondary p-5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-brand">Policy playground</p>
      <p className="mt-1 text-sm leading-relaxed text-secondary">
        Draft a policy and replay it against your instance&apos;s recent action history
        (<code className="font-mono text-xs">POST /api/policies/simulate</code>). Read-only — nothing is
        created or activated; you see exactly what the policy <em>would have</em> done.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {TEMPLATES.map((t, i) => (
          <button
            key={t.type}
            type="button"
            onClick={() => pickTemplate(i)}
            aria-pressed={i === templateIdx}
            className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
              i === templateIdx
                ? 'border-brand bg-brand/15 text-brand'
                : 'border-border text-text-tertiary hover:border-border-hover hover:text-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-text-tertiary">Instance base URL</span>
          <input
            type="url"
            value={config.baseUrl}
            onChange={(e) => updateConfig({ ...config, baseUrl: e.target.value })}
            placeholder="http://localhost:3000"
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-text-tertiary">API key (stored only in your browser)</span>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => updateConfig({ ...config, apiKey: e.target.value })}
            placeholder="paste your key"
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px]">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-text-tertiary">
            <span>
              rules for <code className="font-mono">{template?.type}</code>
            </span>
            <CopyButton value={rules} compact />
          </span>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-text-tertiary">History window (days)</span>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))}
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-1.5 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy || !config.baseUrl || !config.apiKey}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={12} />
          {busy ? 'Simulating…' : 'Simulate against my history'}
        </button>
        {error && <span className="text-xs text-error">{error}</span>}
        {message && <span className="text-xs text-text-tertiary">{message}</span>}
      </div>

      {summary && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(
              [
                ['actions', summary.total],
                ['matched', summary.matches],
                ['block', summary.block],
                ['approval', summary.require_approval],
                ['warn', summary.warn],
                ['allow', summary.allow],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface-primary px-3 py-2 text-center">
                <p className="font-mono text-lg tabular-nums text-text-primary">{value}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
              </div>
            ))}
          </div>
          {matches.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-surface-primary">
              <p className="border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
                First {matches.length} matched actions
              </p>
              {matches.map((m, i) => (
                <div key={m.action_id ? String(m.action_id) : i} className="border-t border-border px-3 py-2 first:border-t-0">
                  <p className="truncate font-mono text-xs text-secondary">
                    <span className="text-brand">{String(m.result || '')}</span>{' '}
                    {String(m.action_type || '')} — {String(m.declared_goal || '')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

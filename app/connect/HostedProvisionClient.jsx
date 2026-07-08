'use client';

import { useState } from 'react';
import { Check, Copy, AlertCircle, Sparkles, ArrowRight } from 'lucide-react';
import { STACK_OPTIONS, renderTemplate } from './hostedTemplates.js';

function CopyButton({ value, label = 'Copy config' }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
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
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export default function HostedProvisionClient({ turnstileSiteKey }) {
  const [selected, setSelected] = useState('claude-code');
  const [state, setState] = useState({ status: 'idle' });

  async function onMint() {
    setState({ status: 'loading' });
    try {
      const form = document.getElementById('dashclaw-turnstile-form');
      const turnstileToken = form ? new FormData(form).get('cf-turnstile-response') || '' : '';
      // v6.4 reach attribution: the referrer + any UTM params already on this
      // page's URL, sent once with the mint. Sanitized and resolved server-side.
      const params = new URLSearchParams(window.location.search);
      const source = {
        referrer: document.referrer || undefined,
        utm_source: params.get('utm_source') || undefined,
        utm_medium: params.get('utm_medium') || undefined,
        utm_campaign: params.get('utm_campaign') || undefined,
      };
      const res = await fetch('/api/hosted/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstile_token: turnstileToken, source }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({ status: 'error', error: body.error || `HTTP ${res.status}` });
        return;
      }
      const body = await res.json();
      setState({ status: 'success', data: body });
    } catch (err) {
      setState({ status: 'error', error: err.message || 'Network error' });
    }
  }

  const selectedOption = STACK_OPTIONS.find((s) => s.id === selected);
  const rendered = state.status === 'success' ? renderTemplate(selected, {
    endpoint: state.data.endpoint,
    apiKey: state.data.api_key,
    workspaceId: state.data.workspace_id,
  }) : null;

  return (
    <div className="space-y-6">
      <form id="dashclaw-turnstile-form" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend className="sr-only">Choose your agent stack</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STACK_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 transition-colors ${
                  selected === opt.id
                    ? 'border-brand bg-surface-tertiary'
                    : 'border-border bg-surface-tertiary hover:border-border-hover'
                }`}
              >
                <input
                  type="radio"
                  name="stack"
                  value={opt.id}
                  checked={selected === opt.id}
                  onChange={() => setSelected(opt.id)}
                  className="sr-only"
                  aria-label={opt.label}
                />
                <span className="text-sm font-semibold text-text-primary">{opt.label}</span>
                <span className="text-xs text-text-tertiary">{opt.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {turnstileSiteKey ? (
          <div className="mt-4">
            <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="dark" />
          </div>
        ) : null}
      </form>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMint}
          disabled={state.status === 'loading'}
          className="inline-flex items-center gap-2 rounded-full border border-brand bg-brand/10 px-5 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles size={14} />
          {state.status === 'loading' ? 'Minting...' : `Mint trial workspace for ${selectedOption.label}`}
        </button>
        {state.status === 'error' ? (
          <div className="flex items-center gap-1.5 text-xs text-status-error">
            <AlertCircle size={12} />
            <span>{state.error}</span>
          </div>
        ) : null}
      </div>

      {state.status === 'success' ? (
        <div className="space-y-4 rounded-2xl border border-border bg-surface-tertiary p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">Trial workspace</p>
              <p className="mt-1 font-mono text-sm text-text-primary">{state.data.workspace_id}</p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Expires <time dateTime={state.data.expires_at}>{new Date(state.data.expires_at).toLocaleDateString()}</time> · cap {state.data.trial_action_cap.toLocaleString()} actions
              </p>
            </div>
            <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand">
              Save this API key now, it won&rsquo;t be shown again
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">API key</p>
              <CopyButton value={state.data.api_key} label="Copy key" />
            </div>
            <pre className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface-primary p-4 font-mono text-xs text-text-primary">
              {state.data.api_key}
            </pre>
            <p className="mt-2 text-xs text-text-tertiary">
              Running <code className="rounded border border-border bg-surface-primary px-1 py-0.5 font-mono text-[11px]">dashclaw install claude --trial</code>? Paste this key when the CLI asks.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                Config for {selectedOption.label} ({rendered.language})
              </p>
              <CopyButton value={rendered.code} />
            </div>
            <pre className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface-primary p-4 text-xs leading-relaxed text-text-secondary">
              {rendered.code}
            </pre>
          </div>

          {/* v5.1: the mint also set a trial session cookie — the dashboard
              is now a real destination, and losing this tab no longer
              orphans the workspace. Only shown when the server actually
              signed the browser in (data.session); if it couldn't (no
              NEXTAUTH_SECRET), we don't promise a dashboard that would bounce
              them to /login. */}
          {state.data.session ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <a
                href="/approvals"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-surface-primary transition-colors hover:bg-brand-hover"
              >
                Open your dashboard
                <ArrowRight size={14} aria-hidden="true" />
              </a>
              {/* v5.2: plain <a>, not <Link> — the guided card is rendered
                  server-side from the session cookie set by this mint, so the
                  navigation must be a full page load to pick it up. */}
              <a
                href="/connect#first-action"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
              >
                Send your first governed action, no install
              </a>
              <p className="max-w-md text-xs leading-relaxed text-text-tertiary">
                Your browser now holds a session for this workspace. Come back
                to your dashboard anytime until the trial ends. The key above is
                shown once; your dashboard is not.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import {
  Rocket, Terminal, CheckCircle2, Copy, X, MousePointer2,
  Sparkles, FileText, Key, Globe
} from 'lucide-react';
import { Card } from './ui/Card';
import { useRealtime } from '../hooks/useRealtime';
import { isDemoMode } from '../lib/isDemoMode';
import { getNodeStarterSnippet } from '../lib/starterSnippet';

const API_KEY_PLACEHOLDER = '<your-api-key>';

interface QuickStartProps {
  onDismiss?: () => void;
}

export default function QuickStart({ onDismiss }: QuickStartProps) {
  const [copied, setCopying] = useState(false);
  const [envCopied, setEnvCopied] = useState(false);
  const [step, setStep] = useState(1);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // In demo mode, show the placeholder — don't imply dashclaw.io is a hosted service.
  // For self-hosted instances, use the actual origin so the snippet works out of the box.
  const baseUrl = isDemoMode()
    ? 'https://your-dashclaw.vercel.app'
    : (typeof window !== 'undefined' ? window.location.origin : 'https://your-dashclaw.vercel.app');

  // Keep the Node snippet env-var-referenced so the user's source code never
  // embeds a raw secret (screen shares, screenshots, pair sessions).
  const sdkCode = getNodeStarterSnippet({ baseUrl });

  // Fetch the bootstrap API key once on mount so we can pre-fill the .env
  // snippet. Skip in demo mode (no instance to fetch from) and silently
  // tolerate auth failures — the placeholder fallback still works.
  useEffect(() => {
    if (isDemoMode()) return undefined;
    let cancelled = false;
    fetch('/api/keys/reveal', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.key) setRevealedKey(data.key);
      })
      .catch(() => { /* fall back to placeholder silently */ });
    return () => { cancelled = true; };
  }, []);

  const apiKeyForEnv = revealedKey || API_KEY_PLACEHOLDER;
  const envFileContent = `DASHCLAW_API_KEY=${apiKeyForEnv}\nDASHCLAW_BASE_URL=${baseUrl}`;

  // Auto-advance steps based on real-time activity
  useRealtime((event: any) => {
    // If we see an action or guard decision, we know they've instrumented correctly
    if (event === 'action.created' || event === 'guard.decision.created' || event === 'decision.created') {
      setStep(3);
    }
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(sdkCode);
    setCopying(true);
    // If they copy the code, they are likely moving to step 2
    if (step < 2) setStep(2);
    setTimeout(() => setCopying(false), 2000);
  };

  const handleEnvCopy = () => {
    navigator.clipboard.writeText(envFileContent);
    setEnvCopied(true);
    setTimeout(() => setEnvCopied(false), 2000);
  };

  return (
    <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8 group/qs">
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute -top-3 -right-3 z-10 p-1.5 bg-surface-secondary border border-white/10 rounded-full text-tertiary hover:text-white opacity-0 group-hover/qs:opacity-100 transition-all shadow-xl"
          aria-label="Dismiss quick start guide"
          title="Dismiss guide"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {/* 1. The Onboarding Card */}
      <Card className="border-brand/20 bg-brand/5 overflow-visible" hover={false}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-brand/20 flex items-center justify-center text-brand shadow-[0_0_20px_rgba(249,115,22,0.1)]">
              <Rocket size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Connect your first agent</h2>
              <p className="text-sm text-secondary font-medium tracking-tight">
                See your first governed decision in under 2 minutes. Prefer MCP, hooks, or another stack?{' '}
                <a href="/connect#first-action" className="text-brand hover:text-brand-hover transition-colors font-semibold">
                  Full connect guide
                </a>
              </p>
            </div>
          </div>

          <div className="space-y-6 mt-6">
            {/* Step 1: Install */}
            <div className="flex gap-4 transition-all duration-300">
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${step >= 1 ? 'bg-brand text-surface-primary' : 'bg-tertiary text-tertiary'}`}>
                  {step > 1 ? <CheckCircle2 size={14} /> : '1'}
                </div>
                <div className={`flex-1 w-px my-1 transition-colors ${step > 1 ? 'bg-brand/30' : 'bg-white/5'}`} />
              </div>
              <div className="flex-1 pb-4">
                <div className="text-sm font-semibold text-white mb-1">Install SDK</div>
                <div className="flex items-center gap-2 bg-black/40 p-2 rounded border border-white/5 font-mono text-xs text-secondary group/term relative">
                  <Terminal size={12} className="text-tertiary" />
                  <span>npm install dashclaw</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('npm install dashclaw');
                      if (step === 1) setStep(2);
                    }}
                    className="absolute right-2 opacity-0 group-hover/term:opacity-100 transition-opacity p-1 hover:text-white"
                    aria-label="Copy install command"
                    title="Copy install command"
                  >
                    <Copy size={10} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: Act */}
            <div className="flex gap-4 transition-all duration-300">
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${step >= 2 ? 'bg-brand text-surface-primary' : 'bg-tertiary text-tertiary'}`}>
                  {step > 2 ? <CheckCircle2 size={14} /> : '2'}
                </div>
                <div className={`flex-1 w-px my-1 transition-colors ${step > 2 ? 'bg-brand/30' : 'bg-white/5'}`} />
              </div>
              <div className="flex-1 pb-4">
                <div className="text-sm font-semibold text-white mb-1">Run Example</div>
                <div className="relative group">
                  <pre
                    className={`bg-black/40 p-3 rounded border font-mono text-[10px] overflow-x-auto max-h-[140px] transition-colors ${step === 2 ? 'border-brand/30 text-secondary' : 'border-white/5 text-tertiary'}`}
                    tabIndex={0}
                    aria-label="Node starter snippet"
                  >
                    {sdkCode}
                  </pre>
                  <button
                    onClick={handleCopy}
                    disabled={step < 2}
                    className="absolute top-2 right-2 p-1.5 bg-tertiary rounded border border-white/10 text-secondary hover:text-white transition-colors disabled:opacity-0"
                    aria-label={copied ? 'Starter snippet copied' : 'Copy starter snippet'}
                    title={copied ? 'Starter snippet copied' : 'Copy starter snippet'}
                  >
                    {copied ? <CheckCircle2 size={12} className="text-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3: Success */}
            <div className="flex gap-4 transition-all duration-300">
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${step === 3 ? 'bg-status-success text-black shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-tertiary text-tertiary'}`}>
                  {step === 3 ? <Sparkles size={14} /> : '3'}
                </div>
              </div>
              <div className="flex-1 relative">
                <div className="text-sm font-semibold text-white mb-1">Watch Governance Happen</div>
                <p className="text-xs text-tertiary leading-relaxed">
                  {isDemoMode()
                    ? 'Self-host to connect real agents. In demo mode, use the simulator to see governance.'
                    : 'Approvals will light up the moment your agent acts.'}
                </p>

                {/* Visual Hint - Re-anchored to the text for clarity */}
                {step === 2 && (
                  <div className="absolute -right-4 top-0 hidden xl:flex items-center gap-2 animate-pulse">
                    <MousePointer2 size={16} className="text-brand rotate-[-90deg] fill-brand" />
                    <span className="text-[10px] font-bold text-brand uppercase tracking-widest whitespace-nowrap bg-brand/10 px-2 py-1 rounded border border-brand/20">
                      {isDemoMode() ? 'Awaiting simulation signal...' : 'Awaiting agent signal...'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Environment Setup Guide */}
      <Card className="border-white/5 bg-surface-secondary overflow-hidden" hover={false}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-tertiary/80 border border-white/5 flex items-center justify-center text-secondary">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Environment Setup</h3>
              <p className="text-sm text-tertiary">Configure your agent project</p>
            </div>
          </div>

          <div className="space-y-5">
            {/* .env file */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Key size={13} className="text-tertiary" />
                <span className="text-xs font-semibold text-secondary uppercase tracking-wide">Create a <code className="text-brand/80 font-mono">.env</code> file</span>
              </div>
              <div className="relative group/env">
                <pre className="bg-black/40 p-3 rounded border border-white/5 font-mono text-[11px] text-secondary">
                  {envFileContent}
                </pre>
                <button
                  onClick={handleEnvCopy}
                  className="absolute top-2 right-2 p-1.5 bg-tertiary rounded border border-white/10 text-secondary hover:text-white transition-colors opacity-0 group-hover/env:opacity-100"
                  aria-label={envCopied ? 'Environment block copied' : 'Copy environment block'}
                  title={envCopied ? 'Environment block copied' : 'Copy environment block'}
                >
                  {envCopied ? <CheckCircle2 size={12} className="text-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                </button>
              </div>
              <p className="text-[10px] text-tertiary mt-1.5 leading-relaxed">
                {revealedKey ? (
                  <>
                    <span className="text-success">API key pre-filled from your instance.</span>{' '}
                    Copy the block above and paste into your <code className="text-tertiary">.env</code>.
                  </>
                ) : (
                  <>
                    Your API key starts with <code className="text-tertiary">oc_live_</code>. Find your key at{' '}
                    <a href="/api-keys" className="text-brand hover:text-brand-hover underline">/api-keys</a>.
                  </>
                )}
              </p>
            </div>

            {/* baseUrl explanation */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Globe size={13} className="text-tertiary" />
                <span className="text-xs font-semibold text-secondary uppercase tracking-wide">Base URL</span>
              </div>
              <p className="text-xs text-tertiary leading-relaxed">
                Set <code className="text-secondary font-mono text-[10px]">baseUrl</code> to your deployed DashClaw instance URL.
                {isDemoMode() ? (
                  <> DashClaw is self-hosted: there is no shared cloud. After deploying via the Vercel button, your URL will look like <code className="text-secondary font-mono text-[10px]">https://your-app.vercel.app</code>.</>
                ) : (
                  <> For this instance, use <code className="text-secondary font-mono text-[10px]">{baseUrl}</code>.</>
                )}
              </p>
            </div>

            {/* Run command */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={13} className="text-tertiary" />
                <span className="text-xs font-semibold text-secondary uppercase tracking-wide">Run it</span>
              </div>
              <div className="flex items-center gap-2 bg-black/40 p-2 rounded border border-white/5 font-mono text-[11px] text-secondary group/run relative">
                <span className="text-tertiary">$</span>
                <span>node --env-file=.env demo.js</span>
                <button
                  onClick={() => navigator.clipboard.writeText('node --env-file=.env demo.js')}
                  className="absolute right-2 opacity-0 group-hover/run:opacity-100 transition-opacity p-1 hover:text-white"
                  aria-label="Copy run command"
                  title="Copy run command"
                >
                  <Copy size={10} aria-hidden="true" />
                </button>
              </div>
              <p className="text-[10px] text-tertiary mt-1.5">
                Requires Node.js 20+. The <code className="text-tertiary">--env-file</code> flag loads your <code className="text-tertiary">.env</code> automatically.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

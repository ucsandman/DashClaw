'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Building2, KeyRound, Terminal, Rocket, CheckCircle2, Copy, Check, AlertTriangle, Loader2, X } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { ProgressBar } from './ui/ProgressBar';
import { Badge } from './ui/Badge';
import ConnectAgentButton from './ConnectAgentButton';

const STEPS = [
  { id: 'workspace', label: 'Create your workspace', icon: Building2 },
  { id: 'api_key', label: 'Generate your API key', icon: KeyRound },
  { id: 'install', label: 'Install the SDK', icon: Terminal },
  { id: 'bootstrap', label: 'Import existing state', icon: CheckCircle2 },
  { id: 'first_action', label: 'Send your first action', icon: Rocket },
];

export default function OnboardingChecklist() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('dashclaw_onboarding_dismissed') === 'true';
    } catch { return false; }
  });

  // Step-specific state
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [createdOrg, setCreatedOrg] = useState(null);

  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  const [copied, setCopied] = useState(null);
  const [actionDetected, setActionDetected] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/status');
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      setStatus(data);

      if (data.steps?.first_action_sent) {
        setActionDetected(true);
      }
    } catch {
      // Silently fail — hide checklist if status can't be fetched
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll for first action detection (step 4)
  useEffect(() => {
    if (!status || !status.steps?.api_key_exists || status.steps?.first_action_sent || actionDetected) {
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/onboarding/status');
        if (res.ok) {
          const data = await res.json();
          if (data.steps?.first_action_sent) {
            setActionDetected(true);
            setStatus(data);
            clearInterval(pollRef.current);
          }
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => clearInterval(pollRef.current);
  }, [status, actionDetected]);

  const copyToClipboard = useCallback((text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // --- Step handlers ---

  const handleCreateWorkspace = async () => {
    if (!workspaceName.trim()) return;
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const res = await fetch('/api/onboarding/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWorkspaceError(data.error || 'Failed to create workspace');
        setWorkspaceLoading(false);
        return;
      }
      setCreatedOrg(data.org);
      await fetchStatus();
    } catch {
      setWorkspaceError('Network error. Please try again.');
    }
    setWorkspaceLoading(false);
  };

  const handleGenerateKey = async () => {
    setKeyLoading(true);
    setKeyError('');
    try {
      const res = await fetch('/api/onboarding/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'My Agent Key' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyError(data.error || 'Failed to generate key');
        setKeyLoading(false);
        return;
      }
      setGeneratedKey(data.key.raw_key);
      await fetchStatus();
    } catch {
      setKeyError('Network error. Please try again.');
    }
    setKeyLoading(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('dashclaw_onboarding_dismissed', 'true'); } catch {}
  };

  const handleFinish = () => {
    handleDismiss();
    // Force page reload to pick up refreshed JWT with new org
    window.location.reload();
  };

  // --- Render logic ---

  if (loading || dismissed) return null;
  if (!status || !status.onboarding_required) return null;

  const steps = status.steps;
  const completedCount =
    (steps.workspace_created ? 1 : 0) +
    (steps.api_key_exists ? 1 : 0) +
    (steps.api_key_exists ? 1 : 0) + // install is "done" once key exists (static step)
    (steps.api_key_exists ? 1 : 0) + // bootstrap is "done" once key exists (static step)
    (steps.first_action_sent || actionDetected ? 1 : 0);
  const progress = Math.round((completedCount / 5) * 100);

  // Determine current active step
  let activeStep = 'workspace';
  if (steps.workspace_created) activeStep = 'api_key';
  if (steps.api_key_exists) activeStep = 'install';
  if (steps.api_key_exists && activeStep === 'install') activeStep = 'bootstrap';
  if (steps.api_key_exists && generatedKey) activeStep = 'first_action';
  if (steps.first_action_sent || actionDetected) activeStep = 'done';

  // SDK snippets with key pre-filled
  const apiKeyDisplay = generatedKey || 'oc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const installSnippet = 'npm install dashclaw';
  const bootstrapSnippet = `node scripts/bootstrap-agent.mjs --dir . --agent-id my-agent --api-key ${apiKeyDisplay} --base-url ${baseUrl}`;
  const initSnippet = `// Add this to your agent's entry point or a shared config file
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: '${baseUrl}',
  apiKey: process.env.DASHCLAW_API_KEY, // Set in your .env: DASHCLAW_API_KEY=${apiKeyDisplay}
  agentId: 'my-agent',     // Unique ID for this agent
  agentName: 'My Agent',   // Display name in the dashboard
});

export default claw;`;
  const actionSnippet = `// Call this from anywhere in your agent code
import claw from './dashclaw-client'; // or wherever you put the init above

await claw.createAction({
  action_type: 'test',
  declared_goal: 'Verify DashClaw connection',
  risk_score: 10,
});`;

  return (
    <Card className="border-brand/30" hover={false}>
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-brand" />
            <span className="text-sm font-medium text-zinc-200 uppercase tracking-wider">Getting Started</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{completedCount} of 4 complete</Badge>
            <button
              onClick={handleDismiss}
              className="p-1 rounded text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-colors"
              title="Dismiss getting started"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <ProgressBar value={progress} color="brand" />
      </div>

      <CardContent>
        <div className="space-y-2 mt-2">
          {/* Step 1: Create Workspace */}
          <StepRow
            step={STEPS[0]}
            completed={steps.workspace_created}
            active={activeStep === 'workspace'}
            future={false}
          >
            {activeStep === 'workspace' && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-zinc-400">
                  A workspace isolates your data. Choose a name for your team or project.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
                    placeholder="e.g. Acme AI Team"
                    maxLength={256}
                    className="flex-1 bg-surface-elevated border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand transition-colors"
                  />
                  <button
                    onClick={handleCreateWorkspace}
                    disabled={!workspaceName.trim() || workspaceLoading}
                    className="bg-brand hover:bg-brand-hover disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    {workspaceLoading ? <Loader2 size={14} className="animate-spin" /> : 'Create Workspace'}
                  </button>
                </div>
                {workspaceError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle size={12} />
                    {workspaceError}
                  </div>
                )}
              </div>
            )}
            {steps.workspace_created && createdOrg && (
              <p className="text-xs text-zinc-500 mt-1">Workspace: {createdOrg.name}</p>
            )}
          </StepRow>

          {/* Step 2: Generate API Key */}
          <StepRow
            step={STEPS[1]}
            completed={steps.api_key_exists}
            active={activeStep === 'api_key'}
            future={!steps.workspace_created}
          >
            {activeStep === 'api_key' && !generatedKey && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-zinc-400">
                  Your agent uses this key to authenticate with the API.
                </p>
                <button
                  onClick={handleGenerateKey}
                  disabled={keyLoading}
                  className="bg-brand hover:bg-brand-hover disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                >
                  {keyLoading ? <Loader2 size={14} className="animate-spin" /> : 'Generate API Key'}
                </button>
                {keyError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle size={12} />
                    {keyError}
                  </div>
                )}
              </div>
            )}
            {generatedKey && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-surface-elevated px-3 py-2 rounded-lg text-xs text-green-400 font-mono truncate">
                    {generatedKey}
                  </code>
                  <button
                    onClick={() => copyToClipboard(generatedKey, 'key')}
                    className="p-2 hover:bg-surface-elevated rounded-lg transition-colors"
                    title="Copy key"
                  >
                    {copied === 'key' ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-zinc-400" />}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-yellow-400">
                  <AlertTriangle size={12} />
                  Save this key now. It won&apos;t be shown again.
                </div>
              </div>
            )}
          </StepRow>

          {/* Step 3: Install SDK */}
          <StepRow
            step={STEPS[2]}
            completed={steps.api_key_exists && (activeStep === 'first_action' || activeStep === 'done')}
            active={activeStep === 'install'}
            future={!steps.api_key_exists}
          >
            {(activeStep === 'install' || activeStep === 'first_action' || activeStep === 'done') && steps.api_key_exists && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-zinc-400">Install the SDK, then create a client in your agent&apos;s entry point:</p>
                <CodeBlock
                  code={installSnippet}
                  copyId="install"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
                <CodeBlock
                  code={initSnippet}
                  copyId="init"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
                <ConnectAgentButton label="Copy Full Setup Prompt" />
              </div>
            )}
          </StepRow>

          {/* Step 4: Bootstrap Data */}
          <StepRow
            step={STEPS[3]}
            completed={steps.api_key_exists && (activeStep === 'first_action' || activeStep === 'done')}
            active={activeStep === 'bootstrap'}
            future={!steps.api_key_exists}
          >
            {(activeStep === 'bootstrap' || activeStep === 'first_action' || activeStep === 'done') && steps.api_key_exists && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-zinc-400">Optional: Import your current integrations, goals, and memory immediately:</p>
                <CodeBlock
                  code={bootstrapSnippet}
                  copyId="bootstrap"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
              </div>
            )}
          </StepRow>

          {/* Step 5: Send First Action */}
          <StepRow
            step={STEPS[4]}
            completed={steps.first_action_sent || actionDetected}
            active={activeStep === 'first_action'}
            future={activeStep !== 'first_action' && activeStep !== 'done'}
          >
            {activeStep === 'first_action' && !actionDetected && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-zinc-400">
                  Run this in your agent to verify everything works:
                </p>
                <CodeBlock
                  code={actionSnippet}
                  copyId="action"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 size={12} className="animate-spin text-brand" />
                  Waiting for your first action...
                </div>
              </div>
            )}
            {(steps.first_action_sent || actionDetected) && (
              <p className="text-xs text-green-400 mt-1">Action received!</p>
            )}
          </StepRow>
        </div>

        {/* All complete */}
        {activeStep === 'done' && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-green-400" />
                <span className="text-sm text-green-400 font-medium">You&apos;re all set!</span>
              </div>
              <button
                onClick={handleFinish}
                className="bg-brand hover:bg-brand-hover text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepRow({ step, completed, active, future, children }) {
  const Icon = step.icon;
  return (
    <div className={`rounded-lg px-3 py-3 transition-colors ${active ? 'bg-surface-tertiary' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
          completed ? 'bg-green-500/20' : active ? 'bg-brand/20' : 'bg-white/5'
        }`}>
          {completed ? (
            <CheckCircle2 size={14} className="text-green-400" />
          ) : (
            <Icon size={14} className={active ? 'text-brand' : 'text-zinc-600'} />
          )}
        </div>
        <span className={`text-sm ${
          completed ? 'text-zinc-500 line-through' : active ? 'text-white font-medium' : future ? 'text-zinc-600' : 'text-zinc-300'
        }`}>
          {step.label}
        </span>
      </div>
      {!future && children}
    </div>
  );
}

function CodeBlock({ code, copyId, copied, onCopy }) {
  return (
    <div className="relative group">
      <pre className="bg-surface-elevated rounded-lg px-3 py-2.5 text-xs text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
      <button
        onClick={() => onCopy(code, copyId)}
        className="absolute top-2 right-2 p-1.5 bg-surface-tertiary hover:bg-surface-secondary rounded opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy"
      >
        {copied === copyId ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-zinc-400" />}
      </button>
    </div>
  );
}

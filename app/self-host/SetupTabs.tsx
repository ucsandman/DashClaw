'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Database, Cloud, Zap, KeyRound } from 'lucide-react';
import GithubIcon from '../components/GithubIcon';
import SecretGenerator from '../components/SecretGenerator';
import CopyMarkdownButton from '../components/CopyMarkdownButton';
import CopyableCodeBlock from '../components/CopyableCodeBlock';

interface StepCardProps {
  n?: React.ReactNode;
  title?: React.ReactNode;
  desc?: React.ReactNode;
  icon?: React.ElementType;
  children?: React.ReactNode;
}

function StepCard({ n, title, desc, icon: Icon, children }: StepCardProps) {
  return (
    <div className="rounded-xl bg-surface-secondary border border-border p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-subtle flex items-center justify-center shrink-0">
          {Icon ? <Icon size={18} className="text-brand" /> : null}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">{n}</span>
            <h2 className="text-base font-semibold text-primary">{title}</h2>
          </div>
          <p className="text-sm text-secondary leading-relaxed">{desc}</p>
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export default function SetupTabs() {
  const [activeTab, setActiveTab] = useState('quick');

  return (
    <div className="space-y-6">
      {/* Callout Banner */}
      <div className="bg-brand-subtle/40 border border-border-active rounded-lg px-4 py-3">
        <p className="text-sm text-secondary">
          No OAuth required to get started. Use Quick Start to deploy solo in under 10 minutes.
          Switch to Team Setup when you&apos;re ready to invite teammates.
          Coming from the hosted trial? Click <strong>Export workspace</strong> on your trial&apos;s{' '}
          <code className="font-mono text-xs">/connect</code> card, then run{' '}
          <code className="font-mono text-xs">dashclaw import &lt;file&gt;</code> once your instance is up —
          policies, decisions, and action history carry over (API keys never do).
        </p>
      </div>

      {/* Tabs Toggle */}
      <div className="flex p-1 bg-surface-secondary border border-border rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('quick')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'quick'
              ? 'bg-surface-tertiary text-brand border border-border-hover shadow-sm'
              : 'text-secondary hover:text-secondary'
          }`}
        >
          Quick Start
        </button>
        <button
          onClick={() => setActiveTab('team')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'team'
              ? 'bg-surface-tertiary text-brand border border-border-hover shadow-sm'
              : 'text-secondary hover:text-secondary'
          }`}
        >
          Team Setup
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {/* Step 1: Neon - Common to both */}
        <StepCard
          n="1"
          title="Create a free Neon database"
          desc="Neon gives you a serverless Postgres database on their free tier — no credit card required."
          icon={Database}
        >
          <ol className="list-decimal list-inside text-sm text-secondary space-y-1.5 mb-4">
            <li>Sign up at <a href="https://neon.tech" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">neon.tech</a></li>
            <li>Create a new project (any name, e.g. &quot;dashclaw&quot;)</li>
            <li>Copy the connection string — it looks like <code className="text-secondary font-mono text-xs">postgresql://user:pass@ep-xyz.neon.tech/neondb</code></li>
          </ol>
          <p className="text-xs text-tertiary">
            You&apos;ll paste this as <code className="font-mono text-secondary">DATABASE_URL</code> in the next step.
          </p>
        </StepCard>

        {/* Step 2: Vercel - Common to both */}
        <StepCard
          n="2"
          title="Deploy to Vercel"
          desc="Fork the repo and import it into Vercel. Add the environment variables and deploy."
          icon={Cloud}
        >
          <ol className="list-decimal list-inside text-sm text-secondary space-y-1.5 mb-4">
            <li>Fork <a href="https://github.com/ucsandman/DashClaw" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">ucsandman/DashClaw</a> to your GitHub account</li>
            <li>Go to <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">vercel.com/new</a> and import your fork</li>
            <li>Generate your secrets, then paste them into Vercel&apos;s environment variables:</li>
          </ol>
          <SecretGenerator />
          <div className="mt-3 rounded-lg bg-brand-subtle/20 border border-brand/20 px-4 py-3 text-xs text-secondary">
            <strong className="text-secondary">About the API key:</strong> <code className="font-mono text-secondary">DASHCLAW_API_KEY</code> is your bootstrap admin key — it authenticates agents and seeds your first organization. After you sign in, you can create and manage additional API keys from the dashboard at <code className="font-mono text-secondary">/api-keys</code>.
          </div>
          <p className="mt-2 text-xs text-tertiary">Tables are created automatically on first request.</p>
        </StepCard>

        {/* Step 3: Conditional */}
        {activeTab === 'quick' ? (
          <StepCard
            n="3"
            title="Set your admin password"
            desc="No OAuth app required. Add one environment variable in Vercel and you can sign in immediately."
            icon={KeyRound}
          >
            <p className="text-sm text-secondary mb-3">
              In your Vercel project → Settings → Environment Variables, add:
            </p>
            <div className="bg-surface-primary rounded-lg px-4 py-3 border border-border font-mono text-sm mb-3">
              <span className="text-brand">DASHCLAW_LOCAL_ADMIN_PASSWORD</span> = your-strong-password-here
            </div>
            <p className="text-sm text-secondary mb-4">
              Then redeploy. Visit your app and sign in with your password on the login page.
            </p>
            <p className="text-tertiary text-xs">
              Use a strong password. This grants full admin access. You can add OAuth later when you want to invite teammates.
            </p>
          </StepCard>
        ) : (
          <StepCard
            n="3"
            title="Set up GitHub OAuth"
            desc="Create a GitHub OAuth app so you can sign in to your dashboard."
            icon={GithubIcon}
          >
            <ol className="list-decimal list-inside text-sm text-secondary space-y-1.5 mb-4">
              <li>Go to <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">GitHub Developer Settings</a> → OAuth Apps → New OAuth App</li>
              <li>Set <strong className="text-secondary">Homepage URL</strong> to <code className="font-mono text-secondary text-xs">https://your-app.vercel.app</code></li>
              <li>Set <strong className="text-secondary">Authorization callback URL</strong> to <code className="font-mono text-secondary text-xs">https://your-app.vercel.app/api/auth/callback/github</code></li>
              <li>Copy the Client ID and Client Secret into your Vercel env vars as <code className="font-mono text-secondary">GITHUB_ID</code> and <code className="font-mono text-secondary">GITHUB_SECRET</code></li>
              <li>Redeploy from the Vercel dashboard</li>
            </ol>
            <p className="text-xs text-tertiary">
              Replace <code className="font-mono text-secondary">your-app.vercel.app</code> with your actual Vercel domain.
            </p>
          </StepCard>
        )}

        {/* Step 4: Redis - Common */}
        <StepCard
          n="4"
          title="Enable Live Updates (Redis)"
          desc="Use Upstash Redis to bridge Vercel's serverless functions for real-time dashboard events."
          icon={Zap}
        >
          <ol className="list-decimal list-inside text-sm text-secondary space-y-1.5 mb-4">
            <li>Sign up for a free account at <a href="https://upstash.com" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">upstash.com</a></li>
            <li>Create a new Redis database (Global or in the same region as your Vercel app)</li>
            <li>Copy the <strong className="text-secondary">REST URL</strong> and <strong className="text-secondary">REST Token</strong>, or the raw <strong className="text-secondary">Redis URL</strong></li>
            <li>Add these environment variables to Vercel:
              <ul className="list-disc list-inside ml-4 mt-1 text-tertiary text-xs font-mono">
                <li>REALTIME_BACKEND=redis</li>
                <li>REDIS_URL=&lt;redis-connection-string&gt;</li>
                <li>REALTIME_ENFORCE_REDIS=true</li>
              </ul>
            </li>
            <li>Redeploy your Vercel app to apply the changes</li>
          </ol>
          <p className="text-xs text-tertiary">
            The 30MB free tier at Upstash is more than enough for DashClaw&apos;s live event buffer.
          </p>
        </StepCard>

        {/* Step 5: Agents - Common */}
        <StepCard
          n="5"
          title="Connect your agents"
          desc="Agents only need a base URL plus API key. Every action they take flows through the same guard, record, and outcome loop. The deeper surfaces (scoring profiles, prompt templates, learning analytics) are available from the same SDK once you are connected."
          icon={KeyRound}
        >
          <div className="mb-4">
            <CopyMarkdownButton
              href="/api/prompts/agent-connect/raw"
              label="Copy Agent Connect Prompt"
              rawLabel="View prompt"
            />
          </div>

          <h3 className="text-sm font-semibold text-white mt-6 mb-3">Agent environment</h3>
          <CopyableCodeBlock title="Agent environment" copyText={`DASHCLAW_BASE_URL=https://your-app.vercel.app
DASHCLAW_API_KEY=<your-secret-api-key>
DASHCLAW_AGENT_ID=my-agent`}>{`DASHCLAW_BASE_URL=https://your-app.vercel.app
DASHCLAW_API_KEY=<your-secret-api-key>
DASHCLAW_AGENT_ID=my-agent`}</CopyableCodeBlock>
          <p className="text-xs text-tertiary mt-2">
            Your Vercel app uses Vercel env vars. Your agent uses its own environment variables.
          </p>

          <h3 className="text-sm font-semibold text-white mt-8 mb-3">Quick integration (Node.js)</h3>
          <CopyableCodeBlock title="agent.js" copyText={`import { DashClaw, GuardBlockedError } from 'dashclaw';

const dc = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: process.env.DASHCLAW_AGENT_ID || 'my-agent',
});

// 1. Ask the policy engine before acting.
const decision = await dc.guard({
  action_type: 'deploy',
  declared_goal: 'Ship auth-service v2.1',
  risk_score: 40,
});
if (decision.decision === 'block') {
  throw new GuardBlockedError(decision);
}

// 2. Record the attempt. The server is the source of truth.
const { action_id } = await dc.createAction({
  action_type: 'deploy',
  declared_goal: 'Ship auth-service v2.1',
  risk_score: 40,
});

// 3. Run your real work, then close the loop.
await dc.reportActionSuccess(action_id, 'Deployed auth-service v2.1');`}>{`import { DashClaw, GuardBlockedError } from 'dashclaw';

const dc = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: process.env.DASHCLAW_AGENT_ID || 'my-agent',
});

// 1. Ask the policy engine before acting.
const decision = await dc.guard({
  action_type: 'deploy',
  declared_goal: 'Ship auth-service v2.1',
  risk_score: 40,
});
if (decision.decision === 'block') {
  throw new GuardBlockedError(decision);
}

// 2. Record the attempt. The server is the source of truth.
const { action_id } = await dc.createAction({
  action_type: 'deploy',
  declared_goal: 'Ship auth-service v2.1',
  risk_score: 40,
});

// 3. Run your real work, then close the loop.
await dc.reportActionSuccess(action_id, 'Deployed auth-service v2.1');`}</CopyableCodeBlock>

          <h3 className="text-sm font-semibold text-white mt-8 mb-3">Quick integration (Python)</h3>
          <CopyableCodeBlock title="agent.py" copyText={`import os
from dashclaw import DashClaw, GuardBlockedError

dc = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id=os.environ.get("DASHCLAW_AGENT_ID", "my-agent"),
)

# 1. Ask the policy engine before acting.
decision = dc.guard({
    "action_type": "deploy",
    "declared_goal": "Ship auth-service v2.1",
    "risk_score": 40,
})
if decision["decision"] == "block":
    raise GuardBlockedError(decision)

# 2. Record the attempt. The server is the source of truth.
result = dc.create_action(
    action_type="deploy",
    declared_goal="Ship auth-service v2.1",
    risk_score=40,
)
action_id = result["action_id"]

# 3. Run your real work, then close the loop.
dc.report_action_success(action_id, "Deployed auth-service v2.1")`}>{`import os
from dashclaw import DashClaw, GuardBlockedError

dc = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id=os.environ.get("DASHCLAW_AGENT_ID", "my-agent"),
)

# 1. Ask the policy engine before acting.
decision = dc.guard({
    "action_type": "deploy",
    "declared_goal": "Ship auth-service v2.1",
    "risk_score": 40,
})
if decision["decision"] == "block":
    raise GuardBlockedError(decision)

# 2. Record the attempt. The server is the source of truth.
result = dc.create_action(
    action_type="deploy",
    declared_goal="Ship auth-service v2.1",
    risk_score=40,
)
action_id = result["action_id"]

# 3. Run your real work, then close the loop.
dc.report_action_success(action_id, "Deployed auth-service v2.1")`}</CopyableCodeBlock>
        </StepCard>
      </div>
    </div>
  );
}

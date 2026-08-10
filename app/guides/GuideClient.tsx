'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  value?: string;
}

function CopyButton({ value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

interface CodeCardProps {
  title?: React.ReactNode;
  body?: string;
  tone?: string;
}

function CodeCard({ title, body, tone = 'default' }: CodeCardProps) {
  const toneClass = tone === 'accent' ? 'border-brand/30' : 'border-border-hover';

  return (
    <div className={`rounded-xl border bg-surface-secondary ${toneClass}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm font-medium text-secondary">{title}</p>
        <CopyButton value={body} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 text-xs text-secondary">{body}</pre>
    </div>
  );
}

interface StepSectionProps {
  number?: React.ReactNode;
  title?: React.ReactNode;
  summary?: React.ReactNode;
  children?: React.ReactNode;
}

function StepSection({ number, title, summary, children }: StepSectionProps) {
  return (
    <section className="rounded-xl border border-border-hover bg-surface-secondary p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand">
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="mt-2 text-sm text-secondary">{summary}</p>
          {children && <div className="mt-5">{children}</div>}
        </div>
      </div>
    </section>
  );
}

interface GuideStep {
  number: number;
  title: string;
  summary: string;
  codeTitle?: string;
  codeBody?: string;
  note?: string;
}

/**
 * GuideClient: shared client component for framework integration guide pages.
 *
 * Renders a full guide layout: hero, numbered steps with optional code cards,
 * proof moment section, and governance as code (guardrails.yml) section.
 */
interface GuideClientProps {
  frameworkName?: string;
  frameworkIcon?: React.ReactNode;
  steps?: GuideStep[];
  proofMoment?: React.ReactNode;
  guardrailsYaml?: string;
  baseUrl?: string;
  eyebrow?: React.ReactNode;
  subhead?: React.ReactNode;
}

export default function GuideClient({
  frameworkName,
  frameworkIcon,
  steps = [],
  proofMoment,
  guardrailsYaml,
  baseUrl,
  eyebrow = 'Integration Guide',
  subhead,
}: GuideClientProps) {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rounded-xl border border-brand/25 bg-surface-secondary p-6 sm:p-8">
        {frameworkIcon && (
          <div className="text-2xl text-brand" aria-hidden="true">
            {frameworkIcon}
          </div>
        )}
        <p className="mt-2 text-xs uppercase tracking-[0.32em] text-brand">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {frameworkName}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-secondary">
          {subhead ?? (
            <>
              Connect {frameworkName} to DashClaw and get your first governed action into{' '}
              <span className="text-secondary">/decisions</span> in under 20 minutes.
            </>
          )}
        </p>
        {baseUrl && (
          <p className="mt-2 text-xs text-tertiary">
            Instance URL detected: <span className="text-secondary">{baseUrl}</span>
          </p>
        )}
      </section>

      {/* Steps */}
      {steps.map((step) => (
        <StepSection
          key={step.number}
          number={step.number}
          title={step.title}
          summary={step.summary}
        >
          {step.codeTitle && step.codeBody && (
            <CodeCard title={step.codeTitle} body={step.codeBody} />
          )}
          {step.note && (
            <p className="mt-4 text-sm text-tertiary">{step.note}</p>
          )}
        </StepSection>
      ))}

      {/* Proof moment */}
      <section className="rounded-xl border border-success/20 bg-surface-primary p-6">
        <p className="text-xs uppercase tracking-[0.32em] text-success">What success looks like</p>
        <p className="mt-4 text-sm text-secondary">{proofMoment}</p>
        <p className="mt-3 text-sm text-tertiary">
          Navigate to <span className="font-mono text-secondary">/decisions</span> in your DashClaw
          instance. Your action should appear in the ledger within seconds of the agent run.
        </p>
      </section>

      {/* Governance as Code */}
      {guardrailsYaml && (
        <section className="rounded-xl border border-border-hover bg-surface-primary p-6">
          <p className="text-xs uppercase tracking-[0.32em] text-tertiary">Governance as Code</p>
          <p className="mt-3 text-sm text-secondary">
            <span className="font-mono text-secondary">guardrails.yml</span> is a policy-as-code
            template. Import it into your instance — POST the YAML to{' '}
            <span className="font-mono text-secondary">/api/policies/import</span> or call the
            Python SDK&apos;s <span className="font-mono text-secondary">import_policies</span> —
            and DashClaw evaluates these rules at the guard step before any action executes.
          </p>
          <div className="mt-5">
            <CodeCard title="guardrails.yml" body={guardrailsYaml} />
          </div>
        </section>
      )}
    </div>
  );
}

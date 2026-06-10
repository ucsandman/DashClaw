import Script from 'next/script';
import { publicHostedConfig } from '../lib/hosted/publicConfig';
import HostedProvisionClient from './HostedProvisionClient';

export default function HostedProvisionSection() {
  const { hostedMode, turnstileSiteKey } = publicHostedConfig();
  if (!hostedMode) return null;

  return (
    <>
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          async
          defer
        />
      ) : null}
      <section className="mb-10 rounded-3xl border border-brand/30 bg-surface-secondary p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
            Try it hosted
          </p>
          <span className="rounded-full border border-brand/20 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand">
            30-second trial · no install
          </span>
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
          Pick your stack, get a pre-configured workspace
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          We mint a time-boxed DashClaw workspace and hand back a drop-in config for your agent stack. No account, no credit card — the trial runs for 30 days or 10,000 governed actions.
        </p>
        <div className="mt-6">
          <HostedProvisionClient turnstileSiteKey={turnstileSiteKey} />
        </div>
      </section>
    </>
  );
}

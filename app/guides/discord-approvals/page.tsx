import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight, ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Discord approvals for DashClaw',
  description:
    'Wire a Discord bot to your DashClaw instance. Inline Approve and Deny buttons in your DMs, full audit evidence, no extra infrastructure.',
  path: '/guides/discord-approvals',
});

export default async function DiscordApprovalsGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const envVarsBlock = `DISCORD_BOT_TOKEN=<token from step 2>
DISCORD_APPROVER_USER_ID=<user id from step 3>
DISCORD_APPROVER_ORG_ID=<org id from step 4>
DISCORD_PUBLIC_KEY=<public key from step 1>`;

  const orgQuery = `select id, name, slug, plan
from organizations
order by created_at desc;`;

  const verifyCall = `const decision = await claw.guard({
  action_type: 'review',
  declared_goal: 'Discord setup verification',
  risk_score: 75,
});`;

  const guardrailsYaml = `version: 1
project: discord-governed-agent
description: >
  Governance policy that hands high risk actions to Discord for
  human approval. Pair this with the four env vars in step 5.

policies:
  - id: approve_production_deploys
    description: Production deploys pause for human approval via Discord DM
    applies_to:
      tools:
        - Bash
        - bash
    rule:
      require: approval
    when:
      command_contains:
        - "git push origin main"
        - "vercel deploy"
        - "kubectl apply"

  - id: approve_destructive_shell
    description: Any rm -rf or DROP TABLE pauses for human review
    applies_to:
      tools:
        - Bash
        - bash
    rule:
      require: approval
    when:
      command_contains:
        - "rm -rf"
        - "drop table"

  - id: approve_secret_writes
    description: File writes to credentials and env files require approval
    applies_to:
      tools:
        - Write
        - Edit
    rule:
      require: approval
    when:
      path_contains:
        - ".env"
        - "credentials"
        - "secrets"`;

  const steps = [
    {
      number: 1,
      title: 'Create the Discord application',
      summary:
        "Open the Discord Developer Portal, click New Application, and name it whatever you want (the operator's instance is called \"DashClaw\"). You land on the General Information page. Two values matter here: Application ID at the top, and Public Key further down. Copy the Public Key now; it is DISCORD_PUBLIC_KEY in step 5. You can return to this page any time.",
      codeTitle: 'URL',
      codeBody: 'https://discord.com/developers/applications',
    },
    {
      number: 2,
      title: 'Create the Bot user',
      summary:
        "In the left navigation, click Bot. Discord attaches a bot user to the application. Three things to do here. Click Reset Token and copy the value as DISCORD_BOT_TOKEN; treat it like a password and reset it again if it ever leaks. Leave all three Privileged Gateway Intents off; the approval bridge uses the REST API, not the Gateway. Leave Bot Permissions empty; the bot DMs you directly via /users/@me/channels and needs no guild permissions. Save.",
    },
    {
      number: 3,
      title: 'Get your Discord User ID',
      summary:
        'In the Discord desktop or web app, open User Settings, then Advanced, then toggle Developer Mode on. Close settings. Find your own name anywhere (sidebar, a message you sent, a member list), right click it, and choose Copy User ID. The value you copy is DISCORD_APPROVER_USER_ID.',
    },
    {
      number: 4,
      title: 'Get your DashClaw Org ID',
      summary:
        'Open your DashClaw dashboard at /settings and find Org ID in the Environment block on the Setup tab. Copy the value (it looks like org_01j... or similar); this is DISCORD_APPROVER_ORG_ID. If you do not have dashboard access yet, the same value lives in the organizations table; run the query below in the Neon SQL Editor and copy the id column for your organization. If multiple rows come back, pick the one whose name matches what you log into the dashboard as.',
      codeTitle: 'Neon SQL Editor (fallback only)',
      codeBody: orgQuery,
    },
    {
      number: 5,
      title: 'Set the four env vars on Vercel',
      summary:
        'Open your Vercel project and add all four values to Production scope, then trigger a redeploy. Vercel does not apply env var changes to existing deployments; you must redeploy.',
      codeTitle: 'Vercel environment variables',
      codeBody: envVarsBlock,
      note:
        'Order matters in the next two steps. The env vars must be deployed before you save the Interactions Endpoint URL in step 7. Discord pings your route on save, and the route returns 401 if it cannot verify the signature. This is the single most important sentence on this page.',
    },
    {
      number: 6,
      title: 'Confirm the deploy is live',
      summary:
        'Open your Vercel deployments page and confirm the latest deployment is in the Ready state. If you save the Interactions Endpoint URL before the deploy lands, Discord will hit the previous deployment (which does not have DISCORD_PUBLIC_KEY set) and the URL save will fail with a generic "could not be validated" error.',
    },
    {
      number: 7,
      title: 'Save the Interactions Endpoint URL',
      summary:
        "Back in the Discord Developer Portal, on the General Information page of your application, scroll to Interactions Endpoint URL. Paste the URL below and click Save Changes. Discord immediately PINGs that endpoint; your route responds {type: 1} and Discord saves the URL. If the save fails with \"interactions endpoint url could not be validated,\" return to step 5 and confirm all four env vars are in Production scope and the redeploy completed.",
      codeTitle: 'Interactions Endpoint URL',
      codeBody: 'https://<your-instance>/api/discord/interactions',
    },
    {
      number: 8,
      title: 'Invite the bot to a shared server',
      summary:
        'The bot can only DM users it shares at least one server with. You need any Discord server where both you and the bot are members; a private server with you as the only human member works fine. In the Developer Portal, go to OAuth2, then URL Generator. Under Scopes, check "bot" only. Leave Bot Permissions empty. Copy the URL at the bottom of the page, open it in your browser, pick the server, and authorize. The bot appears in the member list and stays silent. It only DMs.',
    },
    {
      number: 9,
      title: 'Enable DMs from server members',
      summary:
        "On the server you just added the bot to, right click the server icon in the Discord sidebar and open Privacy Settings. Toggle Direct Messages on. If this is off, the bot's DM attempt returns 403 and you never see anything.",
    },
    {
      number: 10,
      title: 'Trigger an approval and verify',
      summary:
        'From a terminal where the SDK is wired against your instance, call guard with a risk score high enough to require approval. Within about a second you receive a DM from the bot: an orange embed titled "DashClaw approval needed" with fields for Agent, Action, Risk score (reversible or irreversible), and Goal; the action ID in the footer; and two buttons below the embed (green Approve, red Deny). Click Approve. The message rewrites itself within a couple seconds to plain text showing APPROVED, the timestamp, agent, action, goal, and action ID. Buttons disappear. The agent\'s waitForApproval call unblocks via SSE within about one second. The dashboard /approvals page drops the action from the pending list. Run the test once more and click Deny to verify the negative path; the resolved message shows DENIED instead of APPROVED.',
      codeTitle: 'Trigger an approval',
      codeBody: verifyCall,
    },
  ];

  const proofMoment =
    'The DM from the bot arrives within about a second of the guard call. Click Approve and the message rewrites in place to APPROVED with the timestamp and action ID. Click Deny and you get DENIED. Either way, the resolved action lands in /decisions with approved_by starting with discord:, and the agent\'s waitForApproval call unblocks via SSE within about one second.';

  const subhead = (
    <>
      Wire a Discord bot to your DashClaw instance so pending approvals land in your DMs with one
      tap Approve and Deny buttons. About 15 minutes end to end the first time.
    </>
  );

  const troubleshooting = [
    {
      symptom: 'Interactions URL save rejected',
      cause:
        'Env vars are not deployed yet, or DISCORD_PUBLIC_KEY value is wrong. Trigger a redeploy, copy the Public Key fresh from the General Information page, and retry.',
    },
    {
      symptom: 'DM never arrives',
      cause:
        'The bot is not in a shared server with you, your DM privacy is off for that server, or DISCORD_BOT_TOKEN is wrong. Check Vercel function logs for [DiscordApprovals] warnings.',
    },
    {
      symptom: 'DM arrives but clicking does nothing',
      cause:
        'Signature verification is failing inbound. Almost always means DISCORD_PUBLIC_KEY is set to the wrong value (sometimes the bot token gets pasted into the public key slot by accident). Pull the function logs for /api/discord/interactions and look for unauthorized() returns.',
    },
    {
      symptom: 'Click works but the message changes to "Action not found"',
      cause:
        'DISCORD_APPROVER_ORG_ID is wrong. Run the org ID query from step 4 again and confirm the value.',
    },
    {
      symptom: 'Click works but the message changes to "Already resolved by another channel"',
      cause:
        'Another approval surface (dashboard, CLI, Telegram, Mobile PWA) resolved the action between the DM rendering and your click. Working as designed.',
    },
  ];

  const nextSteps = [
    {
      href: '/docs',
      label: 'Browse policy examples in the docs',
    },
    {
      href: '/connect',
      label: 'Set up a second approval surface (CLI, Mobile PWA, Telegram) on /connect',
    },
    {
      href: '/#live-demo',
      label: 'Watch the live demo on the marketing home',
    },
  ];

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Discord approvals for DashClaw',
          description: 'Wire a Discord bot to your DashClaw instance. Inline Approve and Deny buttons in your DMs, full audit evidence, no extra infrastructure.',
          url: 'https://www.dashclaw.io/guides/discord-approvals',
        }}
      />
      <PublicNavbar />

      <main className="px-6 pb-20 pt-28">
        <div className="mx-auto max-w-5xl">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-tertiary">
            <Link href="/" className="transition-colors hover:text-secondary">
              Home
            </Link>
            <ChevronRight size={14} aria-hidden="true" />
            <Link href="/connect" className="transition-colors hover:text-secondary">
              Connect
            </Link>
            <ChevronRight size={14} aria-hidden="true" />
            <span className="text-secondary">Discord approvals</span>
          </nav>

          {/* Prerequisites band */}
          <section className="mb-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">Before you start</p>
            <ul className="mt-4 space-y-2 text-sm text-secondary">
              <li className="flex items-start gap-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                <span>
                  A running DashClaw instance.{' '}
                  <Link href="/self-host" className="text-brand hover:text-brand-hover transition-colors">
                    Self host the runtime
                  </Link>
                  .
                </span>
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                <span>A Discord account.</span>
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                <span>Any Discord server you control, even a private one with no other members.</span>
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                <span>About 15 minutes.</span>
              </li>
            </ul>
          </section>

          <GuideClient
            frameworkName="Discord approvals"
            frameworkIcon="💬"
            eyebrow="Approval Surface Guide"
            subhead={subhead}
            steps={steps}
            proofMoment={proofMoment}
            guardrailsYaml={guardrailsYaml}
            baseUrl={baseUrl}
          />

          {/* Troubleshooting */}
          <section className="mt-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              If something does not work
            </p>
            <dl className="mt-5 divide-y divide-border">
              {troubleshooting.map((row) => (
                <div key={row.symptom} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-6">
                  <dt className="flex items-start gap-2 text-sm font-semibold text-white">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                    {row.symptom}
                  </dt>
                  <dd className="text-sm text-secondary leading-relaxed">{row.cause}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Next steps */}
          <section className="mt-6 rounded-xl border border-border-hover bg-surface-primary p-6">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">Next steps</p>
            <ul className="mt-4 space-y-2 text-sm text-secondary">
              {nextSteps.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1.5 text-brand hover:text-brand-hover transition-colors"
                  >
                    {item.label} <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

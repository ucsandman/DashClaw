import { getSdkCommands } from './readiness.mjs';
import { getNodeStarterSnippet, getPythonStarterSnippet } from './starterSnippet';

const DEPLOYED_BASE_URL_PLACEHOLDER = 'https://your-dashclaw-instance.example.com';
const LOCAL_BASE_URL_PLACEHOLDER = 'http://localhost:3000';

function normalizeHost(host: string | null | undefined): string {
  return String(host || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
    .toLowerCase();
}

function isMarketingHost(host: string | null | undefined): boolean {
  const normalizedHost = normalizeHost(host);
  return normalizedHost === 'dashclaw.io' || normalizedHost === 'www.dashclaw.io';
}

function getBaseUrl(host: string | null | undefined): string {
  if (!host) return DEPLOYED_BASE_URL_PLACEHOLDER;
  if (isMarketingHost(host)) return DEPLOYED_BASE_URL_PLACEHOLDER;
  if (host.startsWith('http://') || host.startsWith('https://')) return host;
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export function getConnectGuideContent({ host = '' }: { host?: string } = {}) {
  const baseUrl = getBaseUrl(host);
  const validator = getSdkCommands(host) as { node: string; pythonCapture: string };

  return {
    baseUrl,
    intro:
      'This page gets a real Node or Python agent reporting live actions to your DashClaw deployment.',
    agentRequirementsNote:
      'Your agent only needs DASHCLAW_BASE_URL and DASHCLAW_API_KEY. It never needs DATABASE_URL.',
    baseUrlGuidance: [
      'Use the URL of your own deployed DashClaw app, not https://dashclaw.io.',
      `Example deployment: ${DEPLOYED_BASE_URL_PLACEHOLDER}`,
      `Local development: ${LOCAL_BASE_URL_PLACEHOLDER}`,
    ],
    envNote:
      'Do not use the marketing site URL. DASHCLAW_BASE_URL must point to your deployed DashClaw app.',
    validatorNote:
      'If you extracted the bundle to a different directory, adjust the path in the command above.',
    successChecks: [
      'Your first governed action will appear in **Mission Control** within a few seconds — look for it in the **Operations Feed** at the bottom of the page.',
      'The agent shows up in live DashClaw traffic once it starts sending actions.',
      'If you enable verified mode, the pairing shows as approved.',
      'If policies are active, future risky actions can route into guard and approvals.',
    ],
    commonMistakes: [
      'Do not use https://dashclaw.io as DASHCLAW_BASE_URL. Use your own DashClaw deployment URL.',
      'Use your DashClaw instance URL, not an API route or localhost from a different machine.',
      'Set DASHCLAW_API_KEY in the agent runtime before running the snippet or validator.',
      'Keep DATABASE_URL on the DashClaw server only. The agent should never need it.',
    ],
    languages: {
      node: {
        label: 'Node',
        installCommand: 'npm install dashclaw',
        envBlock: `DASHCLAW_API_KEY=oc_live_...
DASHCLAW_BASE_URL=${baseUrl}`,
        starterSnippet: getNodeStarterSnippet(),
        optionalPairingSnippet: `const privateJwk = JSON.parse(process.env.AGENT_PRIVATE_KEY_JWK);

const { pairing, pairing_url } = await claw.createPairingFromPrivateJwk(privateJwk, {
  agentName: 'My Agent',
});

console.log('Approve pairing at:', pairing_url);
await claw.waitForPairing(pairing.id);`,
        validatorCommand: validator.node,
        validatorSummary:
          'This confirms your instance can accept real authenticated SDK traffic and can attach proof back to /setup.',
      },
      python: {
        label: 'Python',
        installCommand: 'pip install dashclaw',
        envBlock: `DASHCLAW_API_KEY=oc_live_...
DASHCLAW_BASE_URL=${baseUrl}`,
        starterSnippet: getPythonStarterSnippet(),
        optionalPairingSnippet: `private_jwk = {
    "kty": "<your-private-jwk-type>",
    "n": "<...>",
    "e": "<...>",
    "d": "<...>",
}

pairing = claw.create_pairing_from_private_jwk(private_jwk, agent_name="My Agent")
pairing_id = pairing["pairing"]["id"]

print("Approve pairing at:", pairing["pairing_url"])
claw.wait_for_pairing(pairing_id, timeout=300, interval=2)`,
        validatorCommand: validator.pythonCapture,
        validatorSummary:
          'This captures proof that a live SDK integration worked against your DashClaw instance and feeds it back into /setup.',
      },
    },
  };
}

import { createSection, createCheck } from './factories.mjs';
import { getNodeStarterSnippet, getPythonStarterSnippet } from '../starterSnippet';

export function getBaseUrl(host) {
  if (!host) return 'https://your-dashclaw-instance.example.com';
  const normalizedHost = String(host).replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  if (normalizedHost === 'dashclaw.io' || normalizedHost === 'www.dashclaw.io') {
    return 'https://your-dashclaw-instance.example.com';
  }
  if (host.startsWith('http://') || host.startsWith('https://')) return host;
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export function getSdkCommands(host) {
  const baseUrl = getBaseUrl(host);

  return {
    baseUrl,
    node: `npm install dashclaw
node -e "const { DashClaw } = require('dashclaw'); new DashClaw({ baseUrl: '${baseUrl}', apiKey: '<api-key>' }).ping().then((r) => console.log(r));"`,
    python: `pip install dashclaw
python -c "from dashclaw import DashClaw; dc = DashClaw(base_url='${baseUrl}', api_key='<api-key>'); print(dc.ping())"`,
    pythonCapture: `python - <<'PY'
import json
import urllib.request

payload = {
    "validator": "python-sdk-helper",
    "tool": "python",
    "mode": "read_only",
    "summary": {"passed": 1, "failed": 0, "skipped": 0, "score": 100},
    "checks": [{"name": "Python SDK ping", "status": "pass"}],
}

req = urllib.request.Request(
    "${baseUrl}/api/setup/live-proof",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "x-api-key": "<api-key>",
    },
    method="POST",
)

with urllib.request.urlopen(req) as response:
    print(response.read().decode("utf-8"))
PY`,
  };
}

export function getAgentStarterSnippets(host) {
  const baseUrl = getBaseUrl(host);

  return {
    node: getNodeStarterSnippet({ baseUrl }),
    python: getPythonStarterSnippet({ baseUrl }),
  };
}

export function projectConnectNextStep({
  isAuthenticated = false,
  verification = {},
  onboarding = null,
  host = '',
  sdk = null,
} = {}) {
  const steps = onboarding?.steps || {};
  const snippets = getAgentStarterSnippets(host);
  const validatorCommand = sdk?.commands?.node || getSdkCommands(host).node;
  const docsHref = '/connect';
  const statusItems = [
    {
      label: 'Workspace ready',
      complete: Boolean(steps.workspace_created),
    },
    {
      label: 'API key ready',
      complete: Boolean(steps.api_key_exists),
    },
    {
      label: steps.first_action_sent ? 'First live action received' : 'Waiting for first live action',
      complete: Boolean(steps.first_action_sent),
    },
  ];

  if (!isAuthenticated) {
    return {
      state: 'sign_in',
      title: 'Next step: connect your first agent',
      summary: 'Core checks can be reviewed here, but connecting a real agent requires operator access.',
      primaryCta: { label: 'Sign in to continue', href: '/login' },
      secondaryCtas: [{ label: 'Go to dashboard', href: '/approvals' }],
      statusItems: [],
      snippets: null,
      validatorCommand: '',
    };
  }

  if (!steps.workspace_created) {
    return {
      state: 'create_workspace',
      title: 'Connect your first agent',
      summary: 'Create a workspace before generating API keys or sending live agent traffic.',
      primaryCta: { label: 'Create workspace', href: '/approvals' },
      secondaryCtas: [{ label: 'Open dashboard', href: '/approvals' }],
      statusItems,
      snippets: null,
      validatorCommand: '',
    };
  }

  if (!steps.api_key_exists) {
    return {
      state: 'create_api_key',
      title: 'Connect your first agent',
      summary: 'Workspace is ready. Next, generate an API key so your first agent can authenticate.',
      primaryCta: { label: 'Generate API key', href: '/api-keys' },
      secondaryCtas: [{ label: 'Open dashboard', href: '/approvals' }],
      statusItems,
      snippets: null,
      validatorCommand: '',
    };
  }

  if (steps.first_action_sent) {
    return {
      state: 'connected',
      title: 'Your first agent is connected',
      summary:
        verification?.overall === 'verified'
          ? 'Core checks and live proof are in place. Move into day-to-day controls from here.'
          : 'DashClaw has already recorded a real agent action. From here, tighten controls and review live activity.',
      primaryCta: { label: 'Open dashboard', href: '/approvals' },
      secondaryCtas: [
        { label: 'Enable pairings', href: '/identities' },
        { label: 'Review policies', href: '/policies' },
      ],
      statusItems,
      snippets: null,
      validatorCommand,
    };
  }

  return {
    state: 'connect_agent',
    title: 'Connect your first agent',
    summary: 'Core checks are passing. Next, connect a real agent so DashClaw can record live actions.',
    primaryCta: { label: 'Open connect guide', href: docsHref },
    secondaryCtas: [
      { label: 'Node starter', href: '#connect-node' },
      { label: 'Python starter', href: '#connect-python' },
      { label: 'Run validator', href: '#connect-validator' },
    ],
    statusItems,
    snippets,
    validatorCommand,
  };
}


export function formatCapturedAt(value) {
  if (!value) return 'recently';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildSdkSection(host, report, liveProof) {
  const commands = getSdkCommands(host);
  const coreReady = report.db.ok && report.config.ok && report.auth.ok;
  const apiReady = report.auth.hasAgentApiKey || report.config.vars.some((entry) => entry.key === 'DASHCLAW_API_KEY' && entry.present);
  const hasLiveProof = Boolean(liveProof?.verified);
  const status = !coreReady ? 'warn' : hasLiveProof ? 'pass' : apiReady ? 'info' : 'warn';
  const summary = !coreReady
    ? 'Finish core verification first, then run live SDK checks.'
    : hasLiveProof
      ? 'A successful live SDK validation has been captured for this verify view.'
      : apiReady
      ? 'Live validation paths are ready to run. Proof remains pending until you execute them.'
      : 'Core checks are in place, but you still need an API key before running live SDK validation.';

  return createSection({
    id: 'sdk',
    title: 'SDK and Integration Verification',
    status,
    description: 'Provides guided live validation paths for Node and Python once core verification is in place.',
    summary,
    whatWasChecked: 'This section does not execute SDK calls. It verifies whether a live validation path is available and documents the exact next commands.',
    evidenceSummary: hasLiveProof
      ? liveProof.proofStatement
      : coreReady
      ? 'Verification path available: DashClaw can now guide live SDK checks.'
      : 'Live SDK proof is pending because core instance verification is not complete yet.',
    pendingProof: hasLiveProof
      ? ''
      : 'Use the "Run test" button above to validate your API key and capture proof.',
    checks: [
      createCheck({
        id: 'sdk_live_proof',
        label: 'Live validation proof',
        status: hasLiveProof ? 'pass' : coreReady ? 'info' : 'warn',
        detail: hasLiveProof
          ? `Validation passed on ${formatCapturedAt(liveProof.capturedAt)}.`
          : 'No live validation proof has been captured yet.',
        subDetail: hasLiveProof
          ? `${liveProof.summary.passed} passed, ${liveProof.summary.failed} failed, ${liveProof.summary.skipped} skipped.`
          : 'On the Settings page, paste your API key into the "Test your connection" panel and click "Run test" to capture proof and upgrade to verified.',
        nextAction: hasLiveProof
          ? 'Download the updated JSON proof artifact or share the setup URL that includes this live proof token.'
          : '',
      }),
      createCheck({
        id: 'sdk_gate',
        label: 'Core verification gate',
        status: coreReady ? 'pass' : 'warn',
        detail: coreReady
          ? 'Core instance verification checks are passing.'
          : 'Core verification is still incomplete, so validation should wait.',
        likelyCause: coreReady ? '' : 'Database, required configuration, or auth readiness still needs attention.',
        nextAction: coreReady ? '' : 'Fix the blocked or warning checks above first.',
      }),
      createCheck({
        id: 'sdk_api_key_gate',
        label: 'API key available',
        status: apiReady ? 'pass' : 'warn',
        detail: apiReady
          ? 'An API authentication path is available.'
          : 'You still need an API key before you can validate.',
        likelyCause: apiReady ? '' : 'Neither DASHCLAW_API_KEY nor an operator-generated workspace API key is currently available.',
        nextAction: apiReady ? '' : 'Set DASHCLAW_API_KEY or sign in and create a workspace API key.',
      }),
    ],
    commands,
    coreReady,
    apiReady,
    liveProof,
    hasLiveProof,
  });
}

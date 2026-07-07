// Policy Modes — named operating contracts that compile to packs of ordinary
// guard policies. This is the source-of-truth CATALOG: human-facing metadata
// only. The enforceable policy pack each mode compiles to lives in ./compile.
//
// Design notes:
// - `allows` / `warns` / `requiresApproval` / `blocks` are concrete, non-hype
//   descriptions of the mode's intended posture (rendered in the UI).
// - `toolVisibilityNotes` state honestly where DashClaw can and cannot see
//   actions, so the promises are never overstated.
// - Intent that DashClaw cannot hard-enforce (e.g. "periodic summaries",
//   "scope drift", "login walls") appears ONLY in `warns` / `toolVisibilityNotes`
//   — never as a fabricated policy type. See ./compile for what is enforced.

export type InterruptionLevel = 'low' | 'medium' | 'high';

export interface PolicyMode {
  /** Stable id used by the API + compiler (kebab-case). */
  id: string;
  /** Human display name, e.g. "Claude Code Mode". */
  name: string;
  /** One-line description. */
  description: string;
  /** What this mode is for. */
  purpose: string;
  /** How often the operator should expect to be interrupted. */
  interruptionLevel: InterruptionLevel;
  /** The concrete promise made to the user. */
  uxPromise: string;
  /** Actions this mode lets through without friction. */
  allows: string[];
  /** Actions this mode records/surfaces but does not stop. */
  warns: string[];
  /** Actions this mode pauses for operator sign-off. */
  requiresApproval: string[];
  /** Actions this mode denies outright. */
  blocks: string[];
  /** Honest notes on what DashClaw can/cannot observe or enforce for this mode. */
  toolVisibilityNotes: string[];
}

export const POLICY_MODE_CATALOG: Record<string, PolicyMode> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code Mode',
    description: 'Fast local coding and building. Interrupts only for destruction and secrets.',
    purpose: 'Let a coding agent read, edit, run bash, test, lint, and build without interruption — pausing only for deploys, migrations, destructive ops, and protected paths. Everything else is recorded for review on /policies.',
    interruptionLevel: 'low',
    uxPromise: "Won't interrupt normal coding.",
    allows: [
      'Reading files',
      'Editing files',
      'Running bash commands',
      'Running tests',
      'Linting',
      'Local builds',
    ],
    warns: [
      'External messages, posts, email, calendar',
      'State sync and outbound API calls',
      'High-risk actions (risk score ≥ 85)',
      'Bursts over 250 actions in 30 minutes',
    ],
    requiresApproval: [
      'Deploys, migrations, workflow execution',
      'Explicit destructive ops (delete / reset / destroy / drop)',
      'Edits to governance, auth, secrets, and policy paths',
      'Runaway loops (650+ actions in 60 minutes)',
    ],
    blocks: [
      'Extreme-risk actions (risk score ≥ 100)',
    ],
    toolVisibilityNotes: [
      'DashClaw governs only the actions your agent reports through the SDK or hooks. Routine reads, edits, and bash that are not reported are neither recorded nor gated.',
      'Destructive shell commands are caught by risk scoring of the declared goal (e.g. "rm -rf", "drop table", "truncate"), not by a dedicated "destructive" action type — so the routine `cleanup`/`build`/`test` types stay un-gated.',
      'Recorded (warn) actions land in the /policies review feed, where a one-click grant can silence a recurring shape permanently.',
    ],
  },

  'openclaw': {
    id: 'openclaw',
    name: 'OpenClaw Mode',
    description: 'A broad personal agent that pauses before touching messages or local config.',
    purpose: 'A personal agent operating across files, tools, messages, and local configuration.',
    interruptionLevel: 'medium',
    uxPromise: 'Can help broadly, pauses before touching your life.',
    allows: [
      'Reading and editing files',
      'Local tool use and research',
      'Routine, reversible automation',
    ],
    warns: [
      'High-risk actions (risk score ≥ 85)',
    ],
    requiresApproval: [
      'Telegram, Discord, email, and calendar actions',
      'Writes to local configuration and gateway actions',
      'Reads/writes to secrets and personal-data paths',
      'Explicit destructive ops (delete / reset / destroy / drop)',
    ],
    blocks: [
      'Extreme-risk actions (risk score ≥ 100)',
    ],
    toolVisibilityNotes: [
      'Messaging and calendar actions are gated by their reported `action_type` (e.g. `telegram`, `email`); an integration that does not report a recognized type will not be gated.',
      '"Personal data exposure" is approximated by protected-path rules over known secret/credential locations — DashClaw cannot classify arbitrary content as personal.',
    ],
  },

  'custom-agent': {
    id: 'custom-agent',
    name: 'Custom Agent Mode',
    description: 'Low-trust posture for unknown or experimental agents — boxed in by default.',
    purpose: 'A starting posture for unknown or experimental agents whose behavior is not yet trusted.',
    interruptionLevel: 'high',
    uxPromise: 'Unknown agents start boxed in.',
    allows: [
      'Reading files',
      'Running tests and local builds',
    ],
    warns: [
      'Moderate-risk actions (risk score ≥ 60)',
    ],
    requiresApproval: [
      'File writes and apply/sync actions',
      'Outbound API and network calls',
      'External messages, posts, and email',
      'Deploys, migrations, and workflow execution',
      'Memory writes',
      'Edits to governance, auth, and secrets paths',
    ],
    blocks: [
      'High-risk actions (risk score ≥ 90)',
    ],
    toolVisibilityNotes: [
      'This is a deliberately strict default; loosen it from the Custom tab once an agent has earned trust.',
      '"Long-running autonomy" is approximated by a tight rate limit on reported actions — DashClaw cannot directly observe wall-clock runtime.',
    ],
  },

  'enterprise-strict': {
    id: 'enterprise-strict',
    name: 'Enterprise Strict Mode',
    description: 'Company/team posture where everything sensitive is reviewed and auditable.',
    purpose: 'A company or team environment where production data and customer data must be reviewed.',
    interruptionLevel: 'high',
    uxPromise: 'Everything sensitive is reviewed and auditable.',
    allows: [
      'Reading files',
      'Local development, tests, and builds',
    ],
    warns: [
      'Elevated-risk actions (risk score ≥ 70)',
    ],
    requiresApproval: [
      'Deploys and migrations',
      'Outbound API calls and state sync',
      'External messages, posts, and email',
      'Edits to auth, billing, secrets, and customer-data paths',
      'Dependency and apply actions',
    ],
    blocks: [
      'High-risk actions (risk score ≥ 90)',
    ],
    toolVisibilityNotes: [
      'Every gated action is recorded in the decisions ledger for audit.',
      '"Production data" and "customer data" are gated by protected paths over known locations plus risk scoring — DashClaw governs reported actions, not the data itself.',
    ],
  },

  'soc2': {
    id: 'soc2',
    name: 'SOC 2 Mode',
    description: 'Helps enforce evidence and provenance controls so actions produce an audit trail.',
    purpose: 'Operate in a way that helps enforce evidence/provenance controls and produces records auditors can review.',
    interruptionLevel: 'high',
    uxPromise: 'Actions produce evidence auditors can review.',
    allows: [
      'Reading files',
      'Local development and tests',
    ],
    warns: [
      'Elevated-risk actions (risk score ≥ 80)',
      'Outputs that cannot be verified against a stated source of truth',
    ],
    requiresApproval: [
      'Access changes and permission edits',
      'Evidence and data exports',
      'Policy edits',
      'Deploys and migrations',
      'Edits to secrets, auth, and customer-data paths',
    ],
    blocks: [],
    toolVisibilityNotes: [
      'This mode helps enforce evidence/provenance controls; it does NOT by itself make an organization SOC 2 compliant and makes no certification claim.',
      'Every governed action is recorded with a timestamp, actor identity, and matched policies in the decisions ledger. Source links and before/after records are captured only when the agent reports them — DashClaw cannot synthesize provenance the agent did not provide.',
      'A non-fabrication check gates outputs that contradict a reported source of truth; it can only run when the agent reports both the content and the source.',
    ],
  },

  'research': {
    id: 'research',
    name: 'Research Mode',
    description: 'Explore freely within a privacy budget.',
    purpose: 'Web and API information gathering, kept inside a privacy budget.',
    interruptionLevel: 'low',
    uxPromise: 'Explore freely within a privacy budget.',
    allows: [
      'Read-only browsing and API lookups',
      'Reading files',
    ],
    warns: [
      'High-risk actions (risk score ≥ 85)',
    ],
    requiresApproval: [
      'Storing data to external writes, posts, messages, or email',
      'Edits to secrets and personal-data paths',
    ],
    blocks: [],
    toolVisibilityNotes: [
      'Login walls and "scraping sensitive data" cannot be detected by DashClaw directly — they are surfaced as cautions, not enforced gates.',
    ],
  },

  'autonomous-overnight': {
    id: 'autonomous-overnight',
    name: 'Autonomous Overnight Mode',
    description: 'Can work while you sleep, but cannot run away.',
    purpose: 'Unattended, long-running work that must not drift in scope.',
    interruptionLevel: 'medium',
    uxPromise: 'Can work while you sleep, but cannot run away.',
    allows: [
      'Reading and editing files',
      'Running tests, lint, and local builds',
    ],
    warns: [
      'Elevated-risk actions (risk score ≥ 80)',
      'Bursts over 300 actions in 30 minutes',
    ],
    requiresApproval: [
      'Runaway loops (800+ actions in 60 minutes)',
      'External messages, posts, email, deploys, and migrations',
      'Edits to production, deploy, and secrets paths',
    ],
    blocks: [
      'Extreme-risk actions (risk score ≥ 95)',
    ],
    toolVisibilityNotes: [
      '"Scope drift" and "periodic task summaries" are not natively enforceable — they are surfaced as cautions. Pair this mode with action records so progress is observable.',
      'Runaway protection counts reported actions in a rolling window; an agent that does not report actions cannot be rate-limited.',
    ],
  },

  'deploy': {
    id: 'deploy',
    name: 'Deploy Mode',
    description: 'Shipping is deliberate — stale branches and un-tested code are gated.',
    purpose: 'Shipping changes, where a clean and tested branch is a precondition.',
    interruptionLevel: 'high',
    uxPromise: 'Shipping is deliberate.',
    allows: [
      'Reading files',
      'Running tests and builds',
    ],
    warns: [
      'High-risk actions (risk score ≥ 80)',
    ],
    requiresApproval: [
      'Deploys, migrations, and environment changes',
      'Edits to .env and migration paths',
    ],
    blocks: [
      'Deploying from a stale or diverged branch',
      'Deploying code below the required test/green level',
      'Extreme-risk actions (risk score ≥ 90)',
    ],
    toolVisibilityNotes: [
      'Branch freshness and test-green gates require the agent to report branch and test intel (via the agent-intel hooks); without that intel these gates cannot fire.',
      '"Dirty branch", "migrations without backup", and "deploy without an explicit goal" are partly advisory — the enforceable core is the branch-freshness and green-contract gates plus approval on deploy/migrate.',
    ],
  },
};

export const AVAILABLE_MODES: string[] = Object.keys(POLICY_MODE_CATALOG);

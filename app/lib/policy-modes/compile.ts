// Policy Mode compiler — turns a named mode into a pack of ordinary guard
// policies (the exact shape `validatePolicy` accepts and `insertPolicy` stores).
//
// Every compiled policy:
//   - has policy_type ∈ the live GuardPolicyType values (nothing fabricated),
//   - carries `_mode: <id>` inside its rules JSON (mirrors the existing `_shield`
//     tag so mode-generated policies are recognizable without a schema change),
//   - is `active: 1` so applying a mode takes effect immediately.
//
// Unknown mode ids throw `UnknownPolicyModeError`; the API routes map that to 400.

import type { GuardPolicyType, DecisionType } from '@/lib/types';
import { POLICY_MODE_CATALOG } from './catalog';

export interface CompiledModePolicy {
  /** `[<Mode Name>] <title>` — unique within the mode; used for dedup on import. */
  name: string;
  policy_type: GuardPolicyType;
  /** Type-specific rules object, including the `_mode` tag. JSON-stringified on store. */
  rules: Record<string, unknown>;
  active: 0 | 1;
}

export class UnknownPolicyModeError extends Error {
  readonly modeId: string;
  constructor(modeId: string) {
    super(`Unknown policy mode: ${modeId}`);
    this.name = 'UnknownPolicyModeError';
    this.modeId = modeId;
  }
}

// Governance / auth / secrets / core-policy paths protected across several modes.
// Globs follow app/lib/behavior/path-match.ts semantics (`**` = any depth,
// `*` = one segment, non-`**` patterns also match as basename suffixes).
const GOVERNANCE_PROTECTED_PATHS = [
  '**/auth/**',
  'app/api/auth/**',
  'app/lib/guard.ts',
  'app/api/policies/**',
  'app/api/approvals/**',
  'app/api/actions/**',
  '**/*.key',
  '**/*.pem',
  '**/.env*',
  'secrets/**',
  'schema/**',
  'drizzle/**',
  '**/middleware.*',
  '.claude/hooks/**',
  'packages/openclaw-plugin/**',
  'sdk/**',
  'sdk-python/**',
];

const SECRETS_AND_CONFIG_PATHS = [
  '**/.env*',
  '**/*.key',
  '**/*.pem',
  'secrets/**',
  '**/auth/**',
  '**/config/**',
  '**/*.config.*',
];

const SHIPPING_PROTECTED_PATHS = ['**/.env*', 'drizzle/**', 'schema/**'];

const ENTERPRISE_PROTECTED_PATHS = [
  '**/auth/**',
  '**/billing*',
  '**/stripe*',
  '**/.env*',
  '**/*.key',
  'secrets/**',
];

const SOC2_PROTECTED_PATHS = [
  '**/.env*',
  '**/*.key',
  'secrets/**',
  '**/auth/**',
  'app/api/policies/**',
];

/** Build a single compiled policy, tagging it with the mode id. */
function mk(
  modeId: string,
  title: string,
  policyType: GuardPolicyType,
  rules: Record<string, unknown>,
): CompiledModePolicy {
  const mode = POLICY_MODE_CATALOG[modeId];
  const prefix = mode ? mode.name : modeId;
  return {
    name: `[${prefix}] ${title}`,
    policy_type: policyType,
    rules: { ...rules, _mode: modeId },
    active: 1,
  };
}

type ModeBuilder = () => CompiledModePolicy[];

const MODE_BUILDERS: Record<string, ModeBuilder> = {
  // ── Claude Code Mode — the must-work vertical slice ──
  // "Won't interrupt normal coding": interrupts are reserved for money,
  // destruction, and secrets. External comms / sync / API calls are RECORDED
  // (warn) for the /policies review feed, not gated. Destructive shell is
  // caught by risk scoring of the declared goal (threshold 100/85).
  'claude-code': () => {
    const m = 'claude-code';
    return [
      mk(m, 'Block extreme-risk actions', 'risk_threshold', { threshold: 100, action: 'block' }),
      mk(m, 'Warn on high-risk actions', 'risk_threshold', { threshold: 85, action: 'warn' }),
      mk(m, 'Record external comms / sync / API calls', 'warn_action_type', {
        action_types: ['message', 'post', 'email', 'calendar', 'sync', 'api'],
      }),
      mk(m, 'Pause before deploy / migrate / workflow', 'require_approval', {
        action_types: ['deploy', 'migrate', 'workflow_execute'],
      }),
      mk(m, 'Pause before destructive ops', 'require_approval', {
        action_types: ['delete', 'reset', 'destroy', 'drop'],
      }),
      mk(m, 'Protect governance / auth / secrets paths', 'protected_path', {
        paths: GOVERNANCE_PROTECTED_PATHS,
        action: 'require_approval',
      }),
      mk(m, 'Warn on action bursts', 'rate_limit', { max_actions: 250, window_minutes: 30, action: 'warn' }),
      mk(m, 'Pause on runaway loops', 'rate_limit', {
        max_actions: 650,
        window_minutes: 60,
        action: 'require_approval',
      }),
    ];
  },

  // ── OpenClaw Mode — broad personal agent, pause before "your life" ──
  'openclaw': () => {
    const m = 'openclaw';
    return [
      mk(m, 'Block extreme-risk actions', 'risk_threshold', { threshold: 100, action: 'block' }),
      mk(m, 'Warn on high-risk actions', 'risk_threshold', { threshold: 85, action: 'warn' }),
      mk(m, 'Pause before messaging / calendar', 'require_approval', {
        action_types: ['message', 'post', 'email', 'calendar', 'telegram', 'discord'],
      }),
      mk(m, 'Pause before config writes / gateway actions', 'require_approval', {
        action_types: ['config_write', 'gateway', 'apply'],
      }),
      mk(m, 'Pause before destructive ops', 'require_approval', {
        action_types: ['delete', 'reset', 'destroy', 'drop'],
      }),
      mk(m, 'Protect secrets / config / personal-data paths', 'protected_path', {
        paths: SECRETS_AND_CONFIG_PATHS,
        action: 'require_approval',
      }),
    ];
  },

  // ── Custom Agent Mode — unknown agents start boxed in (low trust) ──
  'custom-agent': () => {
    const m = 'custom-agent';
    return [
      mk(m, 'Block high-risk actions', 'risk_threshold', { threshold: 90, action: 'block' }),
      mk(m, 'Warn on moderate-risk actions', 'risk_threshold', { threshold: 60, action: 'warn' }),
      mk(m, 'Pause before writes / network / elevation', 'require_approval', {
        action_types: ['write', 'apply', 'sync', 'api', 'deploy', 'migrate', 'workflow_execute', 'memory_write'],
      }),
      mk(m, 'Pause before external comms', 'require_approval', {
        action_types: ['message', 'post', 'email', 'calendar'],
      }),
      mk(m, 'Pause before destructive ops', 'require_approval', {
        action_types: ['delete', 'reset', 'destroy', 'drop'],
      }),
      mk(m, 'Protect secrets / auth / config paths', 'protected_path', {
        paths: SECRETS_AND_CONFIG_PATHS,
        action: 'require_approval',
      }),
      // "Long-running autonomy" approximated by a tight burst limit on reported actions.
      mk(m, 'Pause on action bursts', 'rate_limit', {
        max_actions: 100,
        window_minutes: 30,
        action: 'require_approval',
      }),
    ];
  },

  // ── Enterprise Strict Mode — everything sensitive reviewed + auditable ──
  'enterprise-strict': () => {
    const m = 'enterprise-strict';
    return [
      mk(m, 'Block high-risk actions', 'risk_threshold', { threshold: 90, action: 'block' }),
      mk(m, 'Warn on elevated-risk actions', 'risk_threshold', { threshold: 70, action: 'warn' }),
      mk(m, 'Pause before deploy / migrate', 'require_approval', {
        action_types: ['deploy', 'migrate', 'workflow_execute'],
      }),
      mk(m, 'Pause before external APIs / sync / comms', 'require_approval', {
        action_types: ['api', 'sync', 'message', 'post', 'email', 'apply'],
      }),
      mk(m, 'Protect auth / billing / customer-data / secrets paths', 'protected_path', {
        paths: ENTERPRISE_PROTECTED_PATHS,
        action: 'require_approval',
      }),
    ];
  },

  // ── SOC 2 Mode — helps enforce evidence/provenance controls (no compliance claim) ──
  'soc2': () => {
    const m = 'soc2';
    return [
      mk(m, 'Warn on elevated-risk actions', 'risk_threshold', { threshold: 80, action: 'warn' }),
      mk(m, 'Pause before access / permission changes', 'require_approval', {
        action_types: ['access_change', 'permission_change', 'export', 'policy_edit'],
      }),
      mk(m, 'Pause before deploy / migrate', 'require_approval', {
        action_types: ['deploy', 'migrate'],
      }),
      mk(m, 'Protect secrets / auth / policy / customer-data paths', 'protected_path', {
        paths: SOC2_PROTECTED_PATHS,
        action: 'require_approval',
      }),
      // Evidence/provenance: gate outputs that contradict a reported source of truth.
      mk(m, 'Require evidence-consistent outputs', 'non_fabrication', {
        on_violation: 'require_approval',
      }),
    ];
  },

  // ── Research Mode — explore within a spend/privacy budget ──
  'research': () => {
    const m = 'research';
    return [
      mk(m, 'Warn on high-risk actions', 'risk_threshold', { threshold: 85, action: 'warn' }),
      mk(m, 'Pause before external writes / posts / messages', 'require_approval', {
        action_types: ['post', 'message', 'email', 'write', 'apply', 'deploy', 'sync'],
      }),
      mk(m, 'Protect secrets / personal-data paths', 'protected_path', {
        paths: SECRETS_AND_CONFIG_PATHS,
        action: 'require_approval',
      }),
    ];
  },

  // ── Autonomous Overnight Mode — can work while you sleep, cannot run away ──
  'autonomous-overnight': () => {
    const m = 'autonomous-overnight';
    return [
      mk(m, 'Block extreme-risk actions', 'risk_threshold', { threshold: 95, action: 'block' }),
      mk(m, 'Warn on elevated-risk actions', 'risk_threshold', { threshold: 80, action: 'warn' }),
      mk(m, 'Warn on action bursts', 'rate_limit', { max_actions: 300, window_minutes: 30, action: 'warn' }),
      mk(m, 'Pause on runaway loops', 'rate_limit', {
        max_actions: 800,
        window_minutes: 60,
        action: 'require_approval',
      }),
      mk(m, 'Pause before external actions / production changes', 'require_approval', {
        action_types: ['message', 'post', 'email', 'deploy', 'migrate', 'workflow_execute'],
      }),
      mk(m, 'Protect production / deploy / secrets paths', 'protected_path', {
        paths: SHIPPING_PROTECTED_PATHS,
        action: 'require_approval',
      }),
    ];
  },

  // ── Deploy Mode — shipping is deliberate ──
  'deploy': () => {
    const m = 'deploy';
    return [
      mk(m, 'Block deploys from stale / diverged branches', 'branch_freshness', {
        action_types: ['deploy'],
        freshness: ['stale', 'diverged'],
        max_commits_behind: 0,
        action: 'block',
      }),
      mk(m, 'Block deploys below merge-ready test level', 'green_contract', {
        action_types: ['deploy'],
        required_level: 'merge_ready',
        action: 'block',
      }),
      mk(m, 'Block extreme-risk actions', 'risk_threshold', { threshold: 90, action: 'block' }),
      mk(m, 'Warn on high-risk actions', 'risk_threshold', { threshold: 80, action: 'warn' }),
      mk(m, 'Pause before deploy / migrate / env change', 'require_approval', {
        action_types: ['deploy', 'migrate', 'env_change'],
      }),
      mk(m, 'Protect .env / migration paths', 'protected_path', {
        paths: SHIPPING_PROTECTED_PATHS,
        action: 'require_approval',
      }),
    ];
  },
};

/**
 * Compile a named mode into its pack of guard policies.
 * @throws {UnknownPolicyModeError} if the mode id is not in the catalog.
 */
export function compileMode(modeId: string): CompiledModePolicy[] {
  const builder = MODE_BUILDERS[modeId];
  if (!POLICY_MODE_CATALOG[modeId] || !builder) {
    throw new UnknownPolicyModeError(modeId);
  }
  return builder();
}

/**
 * The primary decision a compiled policy yields when it fires — used for the
 * preview summary. Approximation: non_fabrication uses its on_violation;
 * the rest use `rules.action` with the guard engine's per-type defaults.
 */
export function nominalDecision(policy: CompiledModePolicy): DecisionType {
  const r = policy.rules as Record<string, unknown>;
  switch (policy.policy_type) {
    case 'require_approval':
      return 'require_approval';
    case 'block_action_type':
      return 'block';
    case 'warn_action_type':
      return 'warn';
    case 'allow_grant':
      return 'allow';
    case 'non_fabrication':
      return r.on_violation === 'require_approval' ? 'require_approval' : 'block';
    case 'rate_limit':
      return (r.action as DecisionType) ?? 'warn';
    case 'protected_path':
      return (r.action as DecisionType) ?? 'require_approval';
    case 'require_evidence':
      return (r.enforcement as DecisionType) ?? 'require_approval';
    default:
      return (r.action as DecisionType) ?? 'block';
  }
}

/** Summarize a compiled pack by nominal decision — for the preview UI. */
export function summarizeModePack(policies: CompiledModePolicy[]): {
  total: number;
  warn: number;
  require_approval: number;
  block: number;
} {
  const summary = { total: policies.length, warn: 0, require_approval: 0, block: 0 };
  for (const p of policies) {
    const d = nominalDecision(p);
    if (d === 'warn') summary.warn++;
    else if (d === 'require_approval') summary.require_approval++;
    else if (d === 'block') summary.block++;
  }
  return summary;
}

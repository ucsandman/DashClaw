// app/lib/policy-modes/contract.ts
// Renders active guard policies into the /policies "interruption contract":
// plain-English sentences, grouped by tier, with live fire counts and editable
// params. Data-driven from policy rows — unknown types fall into `custom`.

import { shapeKey } from '../policy-shapes';

export interface ContractSentence {
  policy_id: string;
  text: string;
  fired_7d: number;
  editable?: { param: 'approval_threshold' | 'max_spend_usd'; value: number };
  /** Full parsed rules, present only on editable sentences (PATCH needs complete rules). */
  rules?: Record<string, unknown>;
}

export interface ContractGrant {
  policy_id: string;
  label: string;
  shape_key: string;
  /** When the rule was learned/created — drives the "added this week" rollup. */
  created_at: string | null;
}

export interface ContractView {
  governed: boolean;
  mode_id: string | null;
  interrupts: ContractSentence[];
  silent: ContractSentence[];
  blocks: ContractSentence[];
  grants: ContractGrant[];
  custom: Array<{ policy_id: string; name: string; policy_type: string }>;
  friction: { interrupts_7d: number; est_seconds: number };
}

interface PolicyRowLike {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  active?: number;
  created_at?: string | Date | null;
}

const SECONDS_PER_INTERRUPT = 20;

const usd = (n: number) => `$${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`;
const listTypes = (ts: unknown) => (Array.isArray(ts) ? ts.join(', ') : '');

export function buildContract(
  rows: PolicyRowLike[],
  fireCounts: Record<string, number>,
): ContractView {
  const active = rows.filter((r) => r.active === undefined || Number(r.active) === 1);
  const view: ContractView = {
    governed: active.length > 0,
    mode_id: null,
    interrupts: [],
    silent: [],
    blocks: [],
    grants: [],
    custom: [],
    friction: { interrupts_7d: 0, est_seconds: 0 },
  };

  for (const row of active) {
    let rules: Record<string, unknown>;
    try {
      rules = JSON.parse(row.rules) as Record<string, unknown>;
    } catch {
      view.custom.push({ policy_id: row.id, name: row.name, policy_type: row.policy_type });
      continue;
    }
    if (typeof rules._mode === 'string' && !view.mode_id) view.mode_id = rules._mode;
    const fired = fireCounts[row.id] ?? 0;
    const s = (text: string, editable?: ContractSentence['editable']): ContractSentence => ({
      policy_id: row.id,
      text,
      fired_7d: fired,
      ...(editable ? { editable } : {}),
    });

    switch (row.policy_type) {
      case 'x402_spend_limit': {
        const approve = Number(rules.approval_threshold ?? 0);
        const max = Number(rules.max_spend_usd ?? 0);
        view.interrupts.push({ ...s(`paid spend reaches ${usd(approve)}`, { param: 'approval_threshold', value: approve }), rules });
        view.blocks.push({ ...s(`paid spend exceeds ${usd(max)}`, { param: 'max_spend_usd', value: max }), rules });
        break;
      }
      case 'require_approval':
        if (!Array.isArray(rules.action_types) || rules.action_types.length === 0) {
          view.custom.push({ policy_id: row.id, name: row.name, policy_type: row.policy_type });
        } else {
          view.interrupts.push(s(`action is one of: ${listTypes(rules.action_types)}`));
        }
        break;
      case 'protected_path':
        if ((rules.action ?? 'require_approval') === 'require_approval') {
          view.interrupts.push(s('protected paths change (governance, auth, secrets)'));
        } else if (rules.action === 'block') {
          view.blocks.push(s('protected paths change (blocked)'));
        } else {
          view.silent.push(s('protected paths change (recorded)'));
        }
        break;
      case 'rate_limit': {
        const txt = `more than ${rules.max_actions} actions in ${rules.window_minutes} minutes`;
        if (rules.action === 'require_approval') view.interrupts.push(s(`runaway loop: ${txt}`));
        else if (rules.action === 'block') view.blocks.push(s(txt));
        else view.silent.push(s(`burst: ${txt}`));
        break;
      }
      case 'risk_threshold': {
        const txt = `risk score reaches ${rules.threshold}`;
        if (rules.action === 'block') view.blocks.push(s(txt));
        else if (rules.action === 'require_approval') view.interrupts.push(s(txt));
        else view.silent.push(s(txt));
        break;
      }
      case 'warn_action_type':
        if (!Array.isArray(rules.action_types) || rules.action_types.length === 0) {
          view.custom.push({ policy_id: row.id, name: row.name, policy_type: row.policy_type });
        } else {
          view.silent.push(s(`${listTypes(rules.action_types)} calls (recorded for review)`));
        }
        break;
      case 'block_action_type':
        view.blocks.push(s(`action is one of: ${listTypes(rules.action_types)}`));
        break;
      case 'allow_grant': {
        const at = String(rules.action_type ?? '');
        const tp = rules.target_prefix == null ? null : String(rules.target_prefix);
        view.grants.push({
          policy_id: row.id,
          label: tp ? `${at} → ${tp}` : at,
          shape_key: shapeKey(at, tp),
          created_at: row.created_at == null ? null : String(row.created_at),
        });
        break;
      }
      default:
        view.custom.push({ policy_id: row.id, name: row.name, policy_type: row.policy_type });
    }
  }

  const interrupts7d = view.interrupts.reduce((sum, x) => sum + x.fired_7d, 0);
  view.friction = { interrupts_7d: interrupts7d, est_seconds: interrupts7d * SECONDS_PER_INTERRUPT };
  return view;
}

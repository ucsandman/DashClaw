import { describe, it, expect } from 'vitest';
import {
  SHORT_LIST_CAP,
  effectiveAction,
  isShortListLine,
  shortListTier,
  toWatchTier,
  watchPolicyType,
  hasWatchTier,
  countShortListLines,
  ShortListFullError,
} from '@/lib/guardrails/short-list';

describe('effectiveAction', () => {
  it('honors an explicit rules.action over the type default', () => {
    expect(effectiveAction('risk_threshold', { threshold: 85, action: 'warn' })).toBe('warn');
    expect(effectiveAction('rate_limit', { action: 'require_approval' })).toBe('require_approval');
  });

  it('falls back to the per-type default when no action key is present', () => {
    expect(effectiveAction('risk_threshold', { threshold: 100 })).toBe('block');
    expect(effectiveAction('block_action_type', { action_types: ['deploy'] })).toBe('block');
    expect(effectiveAction('require_approval', { action_types: ['api'] })).toBe('require_approval');
    expect(effectiveAction('protected_path', { paths: ['**/.env*'] })).toBe('require_approval');
    expect(effectiveAction('warn_action_type', { action_types: ['post'] })).toBe('warn');
    expect(effectiveAction('rate_limit', { max_actions: 200 })).toBe('warn');
    expect(effectiveAction('allow_grant', {})).toBe('allow');
  });

  it('reads the per-type action spellings on_violation / enforcement', () => {
    expect(effectiveAction('non_fabrication', { on_violation: 'require_approval' })).toBe('require_approval');
    expect(effectiveAction('non_fabrication', {})).toBe('block');
    expect(effectiveAction('require_evidence', { enforcement: 'block' })).toBe('block');
    expect(effectiveAction('require_evidence', { enforcement: 'warn' })).toBe('warn');
  });

  it('agrees with the evaluators that default to BLOCK, not require_approval', () => {
    // policy.ts:260 / :386 / :400 all read `rules.action || 'block'`.
    expect(effectiveAction('permission_escalation', {})).toBe('block');
    expect(effectiveAction('green_contract', {})).toBe('block');
    expect(effectiveAction('branch_freshness', {})).toBe('block');
  });

  it('reads escalate_action for the types whose evaluator ignores rules.action', () => {
    // policy.ts:430 / :475 / :529 never look at rules.action.
    expect(effectiveAction('role_constraint', {})).toBe('require_approval');
    expect(effectiveAction('role_constraint', { escalate_action: 'block' })).toBe('block');
    expect(effectiveAction('role_constraint', { action: 'warn' })).toBe('require_approval');
    expect(effectiveAction('delegation_constraint', { escalate_action: 'block' })).toBe('block');
    expect(effectiveAction('deviation_response', { escalate_action: 'warn' })).toBe('warn');
    expect(effectiveAction('deviation_response', {})).toBe('require_approval');
  });

  it('returns other for an unknown/retired policy type with no action key', () => {
    expect(effectiveAction('retired_thing', {})).toBe('other');
    expect(effectiveAction('retired_thing', { action: 'block' })).toBe('other');
  });
});

describe('isShortListLine', () => {
  it('is true for require_approval with no explicit flag', () => {
    expect(isShortListLine('require_approval', { action_types: ['api'] })).toBe(true);
  });

  it('is true for a block rule', () => {
    expect(isShortListLine('risk_threshold', { threshold: 100, action: 'block' })).toBe(true);
  });

  it('is true for a warn rule that carries the short_list opt-in', () => {
    expect(isShortListLine('warn_action_type', { action_types: ['post'], short_list: true })).toBe(true);
  });

  it('is false for a warn rule without the flag', () => {
    expect(isShortListLine('warn_action_type', { action_types: ['post'] })).toBe(false);
    expect(isShortListLine('rate_limit', { max_actions: 200, action: 'warn' })).toBe(false);
  });

  it('is false for allow_grant', () => {
    expect(isShortListLine('allow_grant', {})).toBe(false);
  });
});

describe('shortListTier', () => {
  it('maps block to BLOCK, require_approval to HOLD, everything else to WATCH', () => {
    expect(shortListTier('block_action_type', { action_types: ['drop'] })).toBe('BLOCK');
    expect(shortListTier('require_approval', { action_types: ['api'] })).toBe('HOLD');
    expect(shortListTier('warn_action_type', { action_types: ['post'] })).toBe('WATCH');
    expect(shortListTier('allow_grant', {})).toBe('WATCH');
  });

  it('chips a block-defaulting type BLOCK, not HOLD', () => {
    expect(shortListTier('permission_escalation', {})).toBe('BLOCK');
    expect(shortListTier('green_contract', { action_types: ['deploy'] })).toBe('BLOCK');
  });

  it('chips an escalate_action type by its escalation', () => {
    expect(shortListTier('role_constraint', { escalate_action: 'block' })).toBe('BLOCK');
    expect(shortListTier('role_constraint', {})).toBe('HOLD');
  });
});

describe('toWatchTier', () => {
  it('turns a block rule into warn and strips the Short List flags', () => {
    const out = toWatchTier(
      { threshold: 100, action: 'block', short_list: true, ungrantable: true },
      'risk_threshold',
    );
    expect(out).toEqual({ threshold: 100, action: 'warn' });
  });

  it('demotes a rule whose interrupting action comes from its type default', () => {
    expect(toWatchTier({ threshold: 100 }, 'risk_threshold')).toEqual({ threshold: 100, action: 'warn' });
    // require_approval demotes by TYPE swap (see watchPolicyType); writing
    // `action` too would be noise — warn_action_type hardcodes its decision.
    expect(toWatchTier({ action_types: ['api'] }, 'require_approval')).toEqual({
      action_types: ['api'],
    });
  });

  it('writes require_evidence demotion to `enforcement`, the key its evaluator reads', () => {
    expect(toWatchTier({ enforcement: 'block' }, 'require_evidence')).toEqual({ enforcement: 'warn' });
  });

  it('writes deviation_response demotion to `escalate_action`, not `action`', () => {
    expect(toWatchTier({ on_kind: { drift: 'block' } }, 'deviation_response')).toEqual({
      on_kind: { drift: 'block' },
      escalate_action: 'warn',
    });
  });

  it('drops contain_above when demoting a containment band (validate.js:715)', () => {
    expect(toWatchTier({ threshold: 90, action: 'require_approval', contain_above: 70 }, 'risk_threshold'))
      .toEqual({ threshold: 90, action: 'warn' });
  });

  it('REFUSES to demote a type with no warn tier rather than writing an inert flag', () => {
    // role_constraint / delegation_constraint escalate_action is
    // require_approval|block only (validate.js:718, :748); non_fabrication
    // on_violation likewise (policy.ts:121). A written `action: warn` would be
    // ignored by the evaluator and would hide the rule from the cap count.
    for (const type of ['role_constraint', 'delegation_constraint', 'non_fabrication']) {
      expect(hasWatchTier(type)).toBe(false);
      const out = toWatchTier({ short_list: true, ungrantable: true }, type);
      expect(out).toEqual({});
      expect(out.action).toBeUndefined();
      expect(isShortListLine(type, out)).toBe(true);
    }
  });

  it('every demotable type really stops being a Short List line', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['risk_threshold', { threshold: 100 }],
      ['protected_path', { paths: ['**/.env*'] }],
      ['permission_escalation', {}],
      ['green_contract', { action_types: ['deploy'] }],
      ['branch_freshness', { action_types: ['deploy'] }],
      ['require_evidence', { enforcement: 'block' }],
      ['deviation_response', { on_kind: { drift: 'block' } }],
      ['non_fabrication', { on_violation: 'block' }],
      ['require_approval', { action_types: ['api'] }],
      ['block_action_type', { action_types: ['drop'] }],
    ];
    for (const [type, rules] of cases) {
      if (!hasWatchTier(type)) continue;
      expect(isShortListLine(watchPolicyType(type), toWatchTier(rules, type))).toBe(false);
    }
  });

  it('leaves an already-watched rule alone apart from the flags', () => {
    expect(toWatchTier({ action_types: ['post'], short_list: true }, 'warn_action_type')).toEqual({
      action_types: ['post'],
    });
  });

  it('does not mutate its input', () => {
    const input = { threshold: 100, action: 'block', short_list: true };
    toWatchTier(input, 'risk_threshold');
    expect(input).toEqual({ threshold: 100, action: 'block', short_list: true });
  });

  it('produces a rule that is no longer a Short List line', () => {
    const watched = toWatchTier({ action_types: ['api'] }, 'require_approval');
    expect(isShortListLine(watchPolicyType('require_approval'), watched)).toBe(false);
  });
});

describe('hasWatchTier', () => {
  it('is true for every demotable type', () => {
    for (const type of ['risk_threshold', 'require_approval', 'block_action_type', 'protected_path',
      'rate_limit', 'require_evidence', 'deviation_response', 'permission_escalation']) {
      expect(hasWatchTier(type)).toBe(true);
    }
  });
});

describe('watchPolicyType', () => {
  it('swaps the two types whose evaluators ignore rules.action', () => {
    expect(watchPolicyType('require_approval')).toBe('warn_action_type');
    expect(watchPolicyType('block_action_type')).toBe('warn_action_type');
  });

  it('leaves every other type unchanged', () => {
    expect(watchPolicyType('risk_threshold')).toBe('risk_threshold');
    expect(watchPolicyType('protected_path')).toBe('protected_path');
  });
});

describe('countShortListLines', () => {
  it('counts only the interrupting active rows', () => {
    const rows = [
      { policy_type: 'require_approval', rules: JSON.stringify({ action_types: ['api'] }), active: 1 },
      { policy_type: 'risk_threshold', rules: { threshold: 100 }, active: 1 },
      { policy_type: 'warn_action_type', rules: JSON.stringify({ action_types: ['post'] }), active: 1 },
      { policy_type: 'warn_action_type', rules: { action_types: ['post'], short_list: true }, active: 1 },
    ];
    expect(countShortListLines(rows)).toBe(3);
  });

  it('ignores inactive rows', () => {
    const rows = [
      { policy_type: 'require_approval', rules: { action_types: ['api'] }, active: 1 },
      { policy_type: 'require_approval', rules: { action_types: ['deploy'] }, active: 0 },
      { policy_type: 'block_action_type', rules: { action_types: ['drop'] }, active: false },
    ];
    expect(countShortListLines(rows)).toBe(1);
  });

  it('treats a row with no active column as active, and survives unparseable rules', () => {
    const rows = [
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'risk_threshold', rules: 'not json' },
    ];
    expect(countShortListLines(rows)).toBe(2);
  });
});

describe('SHORT_LIST_CAP / ShortListFullError', () => {
  it('caps at ten', () => {
    expect(SHORT_LIST_CAP).toBe(10);
  });

  it('carries the SHORT_LIST_FULL code and the operator-facing copy', () => {
    const err = new ShortListFullError();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SHORT_LIST_FULL');
    expect(err.message).toBe('The Short List is full (10 of 10). Remove a line to add this one.');
  });
});

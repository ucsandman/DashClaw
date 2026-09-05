/**
 * Policy-pack import logic, extracted (behavior-preserving) from
 * POST /api/policies/import so non-route callers — hosted-trial
 * provisioning seeds the claude-code-starter pack — can reuse it.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findPolicyByName, insertPolicy, getActivePolicies } from '../repositories/guardrails.repository';
import { inferPolicyType } from '../policyPackPreviews';
import {
  SHORT_LIST_CAP,
  countShortListLines,
  hasWatchTier,
  isShortListLine,
  toWatchTier,
  watchPolicyType,
} from './short-list';
import type { SqlTag } from '../types/db';

export interface ImportedPolicySummary {
  id: unknown;
  name: unknown;
  policy_type: unknown;
  active: unknown;
}

export interface ImportPoliciesResult {
  imported: ImportedPolicySummary[];
  /** Names that were not imported, each with a parenthesised reason where it is not a name conflict. */
  skipped: string[];
  errors: string[];
  /**
   * How many imported rules LANDED in Watch — they fire and are recorded, they
   * never interrupt. This is `imported.length - short_listed`, not the number
   * DEMOTED: a pack line that was already warn-tier is in Watch too, and the
   * install banner has to name the bucket a rule is in, not how it got there.
   */
  watched: number;
  /**
   * How many imported rules kept their interrupting action because the pack
   * opted them in with `rules.short_list: true` and a slot was free. These CAN
   * stop an agent — the banner must say so out loud.
   */
  short_listed: number;
  /**
   * How many rules installed DORMANT (active = 0) because their type has no
   * Watch tier. Not counted in `imported`: `imported + dormant` is the number
   * of pack lines that reached the database.
   */
  dormant: number;
}

/** Load and parse a pack's policies.yml. Throws when the pack file is missing. */
export async function loadPackPolicies(packName: string): Promise<Array<Record<string, unknown>>> {
  const packPath = join(process.cwd(), 'app', 'lib', 'guardrails', 'packs', packName, 'policies.yml');
  const yamlContent = await readFile(packPath, 'utf-8');
  const jsYaml = await import('js-yaml');
  const doc = jsYaml.load(yamlContent) as { policies?: unknown[] };
  return (doc.policies || []) as Array<Record<string, unknown>>;
}

/**
 * Import a list of parsed pack policies for an org: infer the policy type,
 * skip on name conflict, insert the rest. Per-policy failures are collected
 * into `errors`, never thrown.
 *
 * Short List (spec §2.3): a pack line only keeps its interrupting action when
 * it explicitly opts in with `rules.short_list: true` AND a slot is free.
 * Everything else installs in Watch — it fires and is recorded, it does not
 * stop the agent. That is why installing a pack cannot bury an operator under
 * new approvals.
 */
export async function importPolicies(
  sql: SqlTag,
  orgId: string,
  policies: Array<Record<string, unknown>>,
): Promise<ImportPoliciesResult> {
  const imported: ImportedPolicySummary[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  let dormant = 0;

  // Slots already taken by this org's active interrupting rules. Read once:
  // the loop's own inserts are tracked in `claimed`.
  let used = 0;
  if (policies.length > 0) {
    const active = await getActivePolicies(sql, orgId);
    used = countShortListLines(active as Array<{ policy_type: string; rules: unknown; active?: unknown }>);
  }
  let claimed = 0;

  for (const policy of policies) {
    try {
      let policyType = inferPolicyType(policy);
      const name = (policy.description || policy.id) as string;
      const parsedRules: Record<string, unknown> = policy.rules
        ? (policy.rules as Record<string, unknown>)
        : {
            action_types: (policy.applies_to as { tools?: unknown[] })?.tools || [],
            ...((policy.rule as Record<string, unknown>) || {}),
            tests: policy.tests || [],
          };

      // Check for existing policy with same name
      const existing = await findPolicyByName(sql, orgId, name);

      if (existing.length > 0) {
        skipped.push(name);
        continue;
      }

      let effectiveRules = parsedRules;
      let activeFlag: 0 | 1 = 1;
      if (parsedRules.short_list === true) {
        if (used + claimed >= SHORT_LIST_CAP) {
          skipped.push(`${name} (short_list_full)`);
          continue;
        }
        claimed++;
      } else if (isShortListLine(policyType, parsedRules)) {
        if (hasWatchTier(policyType)) {
          effectiveRules = toWatchTier(parsedRules, policyType);
          policyType = watchPolicyType(policyType);
        } else {
          // No warn tier exists for this type, so there is nothing we could
          // write that would make it record-without-interrupting. Spec 2.3
          // says a pack line may not interrupt until a human promotes it, so
          // it lands DORMANT with its rules untouched — the pack stays
          // complete and visible, and nothing fires until someone turns it on
          // (which runs the PATCH cap check).
          activeFlag = 0;
        }
      }

      const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

      const result = await insertPolicy(sql, orgId, {
        id,
        name,
        policyType,
        rules: JSON.stringify(effectiveRules),
        active: activeFlag,
      }) as Record<string, unknown>;

      if (activeFlag === 0) {
        dormant++;
        continue;
      }

      imported.push({
        id: result.id,
        name: result.name,
        policy_type: result.policy_type,
        active: result.active,
      });
    } catch (err) {
      errors.push(`Failed to import "${policy.id || 'unknown'}": ${(err as Error).message}`);
    }
  }

  // Every active insert that did not claim a Short List slot is in Watch, by
  // construction — no separate counter can drift away from that.
  return { imported, skipped, errors, watched: imported.length - claimed, short_listed: claimed, dormant };
}

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
  /** How many imported rules were demoted to Watch (they record, they do not interrupt). */
  watched: number;
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
  let watched = 0;

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
      if (parsedRules.short_list === true) {
        if (used + claimed >= SHORT_LIST_CAP) {
          skipped.push(`${name} (short_list_full)`);
          continue;
        }
        claimed++;
      } else {
        effectiveRules = toWatchTier(parsedRules, policyType);
        if (isShortListLine(policyType, parsedRules)) {
          policyType = watchPolicyType(policyType);
          watched++;
        }
      }

      const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

      const result = await insertPolicy(sql, orgId, {
        id,
        name,
        policyType,
        rules: JSON.stringify(effectiveRules),
      }) as Record<string, unknown>;

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

  return { imported, skipped, errors, watched };
}

/** Load a named pack and import its policies for the org. */
export async function importPolicyPack(
  sql: SqlTag,
  orgId: string,
  packName: string,
): Promise<ImportPoliciesResult> {
  const policies = await loadPackPolicies(packName);
  return importPolicies(sql, orgId, policies);
}

/**
 * Policy-pack import logic, extracted (behavior-preserving) from
 * POST /api/policies/import so non-route callers — hosted-trial
 * provisioning seeds the claude-code-starter pack — can reuse it.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findPolicyByName, insertPolicy } from '../repositories/guardrails.repository.js';
import { inferPolicyType } from '../policyPackPreviews.js';
import type { SqlTag } from '../types/db.js';

export interface ImportedPolicySummary {
  id: unknown;
  name: unknown;
  policy_type: unknown;
  active: unknown;
}

export interface ImportPoliciesResult {
  imported: ImportedPolicySummary[];
  skipped: string[];
  errors: string[];
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
 */
export async function importPolicies(
  sql: SqlTag,
  orgId: string,
  policies: Array<Record<string, unknown>>,
): Promise<ImportPoliciesResult> {
  const imported: ImportedPolicySummary[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const policy of policies) {
    try {
      const policyType = inferPolicyType(policy);
      const name = (policy.description || policy.id) as string;
      const rules = policy.rules
        ? JSON.stringify(policy.rules)
        : JSON.stringify({
            action_types: (policy.applies_to as { tools?: unknown[] })?.tools || [],
            ...((policy.rule as Record<string, unknown>) || {}),
            tests: policy.tests || [],
          });

      // Check for existing policy with same name
      const existing = await findPolicyByName(sql, orgId, name);

      if (existing.length > 0) {
        skipped.push(name);
        continue;
      }

      const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

      const result = await insertPolicy(sql, orgId, { id, name, policyType, rules }) as Record<string, unknown>;

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

  return { imported, skipped, errors };
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

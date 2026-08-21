// app/lib/setup/catastrophe-pack.mjs
//
// Seeds the "catastrophe-only" policy pack — the default guardrails for every
// newly-created self-hosted org. Plain .mjs so scripts/auto-migrate.mjs (run
// via bare `node`, cannot import .ts) can call it at org birth.
//
// The naming formula (`policy.description || policy.id`) is byte-identical to
// importPolicies() (app/lib/guardrails/import-pack.ts) and the standalone seed
// script, so a later UI import of the same pack SKIPS the seeded rows by name
// instead of duplicating them. Do NOT import from app/lib/**/*.ts or `@/`.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as jsYaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolved relative to THIS module, never process.cwd() — auto-migrate may run
// from anywhere (Vercel buildCommand, `dashclaw up`, `npm run db:migrate`).
const PACK_PATH = join(
  __dirname,
  '..',
  'guardrails',
  'packs',
  'catastrophe-only',
  'policies.yml',
);

/** Parse the catastrophe-only pack's policies.yml. */
export function loadCatastrophePackPolicies() {
  const doc = jsYaml.load(readFileSync(PACK_PATH, 'utf-8'));
  return (doc && doc.policies) || [];
}

/**
 * Seed the catastrophe-only pack into `orgId`. Idempotent per policy name:
 * skips any policy whose name already exists (second-layer defence; the caller
 * gates on org creation). Returns { imported, skipped }.
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>} sql postgres.js tag
 * @param {string} orgId
 */
export async function seedCatastrophePack(sql, orgId) {
  const policies = loadCatastrophePackPolicies();
  let imported = 0;
  let skipped = 0;

  for (const policy of policies) {
    const name = policy.description || policy.id;
    const existing = await sql`
      SELECT id FROM guard_policies
      WHERE org_id = ${orgId} AND name = ${name}
      LIMIT 1
    `;

    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();
    const rules = JSON.stringify(policy.rules);

    await sql`
      INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${name}, ${policy.policy_type}, ${rules}, 1, ${now}, ${now})
    `;
    imported += 1;
  }

  return { imported, skipped };
}

// Rows seeded by the pre-2026-08-21 packs carried `action: block` on the
// risk-100 line. Nothing in the default packs refuses outright any more — the
// runtime cannot tell "wipe the disk" from "ship the site" at score 100, so it
// holds for the human instead (a Vercel deploy was being refused). Flip every
// seeded row still on the old shape, by its seeded name, in place: the policy
// keeps its id, so grants/decisions that reference it stay attached.
const BLOCK_TO_HOLD = [
  ['Catastrophe Pack — Block Mass-Destructive Operations', 'Catastrophe Pack — Hold Mass-Destructive Operations for Approval'],
  ['Claude Code Starter — Block Mass-Destructive Operations', 'Claude Code Starter — Hold Mass-Destructive Operations for Approval'],
];

/**
 * Re-point already-seeded "Block Mass-Destructive" rows at require_approval.
 * Idempotent (matches the old name only); touches every org. Returns the
 * number of rows flipped.
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>} sql postgres.js tag
 */
export async function holdMassDestructive(sql) {
  let updated = 0;
  const now = new Date().toISOString();
  for (const [oldName, newName] of BLOCK_TO_HOLD) {
    const rows = await sql`
      UPDATE guard_policies
      SET name = ${newName},
          rules = (rules::jsonb || '{"action":"require_approval"}'::jsonb)::text,
          updated_at = ${now}
      WHERE name = ${oldName}
      RETURNING id
    `;
    updated += rows.length;
  }
  return updated;
}

// The mass-destructive line keys on the classifier's `protected_target` flag,
// not on the score (2026-08-21): risk saturates at 100 for `cat .env.example`
// or a heredoc line containing `dd `, and the bare threshold held every one of
// them. Seeded rows that predate the flag gate get it added in place (same id,
// grants/decisions stay attached); rows an operator already tuned are left
// alone because the merge only fires when the key is absent.
const FLAG_GATED_LINES = BLOCK_TO_HOLD.map(([, newName]) => newName);

/**
 * Add `only_evidence_flags: ["protected_target"]` to every seeded
 * "Hold Mass-Destructive" row that does not carry the key yet. Idempotent;
 * touches every org. Returns the number of rows updated.
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>} sql postgres.js tag
 */
export async function gateMassDestructiveOnEvidence(sql) {
  let updated = 0;
  const now = new Date().toISOString();
  for (const name of FLAG_GATED_LINES) {
    const rows = await sql`
      UPDATE guard_policies
      SET rules = (rules::jsonb || '{"only_evidence_flags":["protected_target"]}'::jsonb)::text,
          updated_at = ${now}
      WHERE name = ${name}
        AND NOT (rules::jsonb ? 'only_evidence_flags')
      RETURNING id
    `;
    updated += rows.length;
  }
  return updated;
}

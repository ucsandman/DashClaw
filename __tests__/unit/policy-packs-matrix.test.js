import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as jsYaml from 'js-yaml';
import { evaluatePolicy, KNOWN_POLICY_TYPES } from '@/lib/guard/policy.ts';
import { validatePolicy } from '@/lib/validate.js';
import { inferPolicyType, PACK_PREVIEWS, AVAILABLE_PACKS, bucketForPackPolicy } from '@/lib/policyPackPreviews.ts';

// Generic validity matrix over EVERY pack in the registry, plus an executable
// pass that runs the embedded test recipes of the gallery-era packs through the
// real evaluator. Older packs keep their own dedicated test files.

const PACKS_DIR = join(process.cwd(), 'app', 'lib', 'guardrails', 'packs');
const GUARD_DECISIONS = ['allow', 'warn', 'block', 'require_approval'];

// Packs added with the gallery (2026-08-14). Their policies are new-format
// (explicit policy_type + rules) with self-contained, evaluator-runnable tests.
const GALLERY_PACKS = [
  'spend-lockdown', 'outbound-comms-guard', 'night-shift', 'prod-infra-shield',
  'data-protection', 'fleet-control', 'support-agent', 'ci-release-bot',
  'evidence-first', 'read-only-analyst', 'browser-operator-guard',
];

// Evaluator-runnable types: pure context checks. rate_limit needs a DB count,
// webhook_check calls out, permission_escalation reads agent_pairings — their
// firing paths cannot run with sql=null.
const RUNNABLE_TYPES = new Set([
  'require_approval', 'block_action_type', 'warn_action_type', 'risk_threshold',
  'require_evidence', 'role_constraint', 'delegation_constraint',
  'protected_path', 'green_contract', 'branch_freshness', 'deviation_response',
  'non_fabrication',
]);

function loadPack(packId) {
  const raw = readFileSync(join(PACKS_DIR, packId, 'policies.yml'), 'utf-8');
  return jsYaml.load(raw);
}

describe('policy pack registry', () => {
  it('every registered pack has a policies.yml on disk', () => {
    for (const packId of AVAILABLE_PACKS) {
      expect(existsSync(join(PACKS_DIR, packId, 'policies.yml')), `missing policies.yml for ${packId}`).toBe(true);
    }
  });

  it('every pack directory is registered in PACK_PREVIEWS', () => {
    const dirs = readdirSync(PACKS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of dirs) {
      expect(AVAILABLE_PACKS, `pack directory ${dir} is not in PACK_PREVIEWS`).toContain(dir);
    }
  });

  it('every preview carries gallery taxonomy and a resolvable stack_after', () => {
    for (const [packId, preview] of Object.entries(PACK_PREVIEWS)) {
      expect(typeof preview.audience, `${packId} audience`).toBe('string');
      expect(['permissive', 'balanced', 'strict'], `${packId} strictness`).toContain(preview.strictness);
      if (preview.stack_after !== undefined) {
        expect(AVAILABLE_PACKS, `${packId} stack_after points at an unknown pack`).toContain(preview.stack_after);
      }
    }
  });

  it('all gallery packs are registered', () => {
    for (const packId of GALLERY_PACKS) {
      expect(AVAILABLE_PACKS).toContain(packId);
    }
  });
});

describe('policy pack contents', () => {
  it('every pack parses and every policy has an id and description', () => {
    for (const packId of AVAILABLE_PACKS) {
      const pack = loadPack(packId);
      expect(Array.isArray(pack.policies), `${packId} has no policies array`).toBe(true);
      expect(pack.policies.length, `${packId} is empty`).toBeGreaterThan(0);
      for (const p of pack.policies) {
        expect(p.id, `${packId} policy missing id`).toBeTruthy();
        expect(p.description, `${packId}/${p.id} missing description`).toBeTruthy();
        expect(['block', 'require_approval', 'warn', 'allow']).toContain(bucketForPackPolicy(p));
      }
    }
  });

  it('policy names are unique within each pack', () => {
    for (const packId of AVAILABLE_PACKS) {
      const names = loadPack(packId).policies.map((p) => p.description || p.id);
      expect(new Set(names).size, `${packId} has duplicate policy names`).toBe(names.length);
    }
  });

  it('gallery pack policy names are globally unique (stacking never collides)', () => {
    const seen = new Map();
    for (const packId of AVAILABLE_PACKS) {
      for (const p of loadPack(packId).policies) {
        const name = String(p.description || p.id);
        if (GALLERY_PACKS.includes(packId) || GALLERY_PACKS.includes(seen.get(name))) {
          expect(seen.has(name), `"${name}" appears in both ${seen.get(name)} and ${packId}`).toBe(false);
        }
        if (!seen.has(name)) seen.set(name, packId);
      }
    }
  });
});

describe('gallery packs (new-format)', () => {
  it('every policy declares an explicit, dispatchable policy_type', () => {
    for (const packId of GALLERY_PACKS) {
      for (const p of loadPack(packId).policies) {
        expect(p.policy_type, `${packId}/${p.id} missing explicit policy_type`).toBeTruthy();
        expect(KNOWN_POLICY_TYPES, `${packId}/${p.id} type not dispatchable`).toContain(p.policy_type);
        expect(inferPolicyType(p)).toBe(p.policy_type);
      }
    }
  });

  it('every policy passes the write-path validator (import produces enforceable rows)', () => {
    for (const packId of GALLERY_PACKS) {
      for (const p of loadPack(packId).policies) {
        const result = validatePolicy({
          name: p.description || p.id,
          policy_type: p.policy_type,
          rules: p.rules,
        });
        expect(result.valid, `${packId}/${p.id}: ${result.errors.join('; ')}`).toBe(true);
      }
    }
  });

  it('every policy ships at least one well-formed embedded test', () => {
    for (const packId of GALLERY_PACKS) {
      for (const p of loadPack(packId).policies) {
        expect(Array.isArray(p.tests) && p.tests.length > 0, `${packId}/${p.id} has no tests`).toBe(true);
        for (const t of p.tests) {
          expect(typeof t.name, `${packId}/${p.id} test missing name`).toBe('string');
          expect(t.input && typeof t.input === 'object', `${packId}/${p.id}/${t.name} missing input`).toBe(true);
          expect(GUARD_DECISIONS, `${packId}/${p.id}/${t.name} bad expect.decision`).toContain(t.expect?.decision);
        }
      }
    }
  });

  it('embedded tests pass through the real evaluator', async () => {
    for (const packId of GALLERY_PACKS) {
      for (const p of loadPack(packId).policies) {
        if (!RUNNABLE_TYPES.has(p.policy_type)) continue;
        for (const t of p.tests) {
          const result = await evaluatePolicy(
            { id: `${packId}_${p.id}`, name: p.description || p.id, policy_type: p.policy_type },
            p.rules,
            t.input,
            null,
            'org_test',
            // undefined → risk_threshold falls back to input.risk_score, same
            // as the simulate route's behavior.
            undefined,
          );
          const label = `${packId}/${p.id}/${t.name}`;
          if (t.expect.decision === 'allow') {
            expect(result === null || result.action === 'allow', `${label}: expected allow, got ${result?.action}`).toBe(true);
          } else {
            expect(result?.action, label).toBe(t.expect.decision);
          }
        }
      }
    }
  });
});

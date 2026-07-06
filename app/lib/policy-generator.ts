/**
 * AI Policy Generator.
 * Accepts natural language input, calls an LLM to generate guard policies,
 * validates the output, and returns a preview or creates policies.
 */

import { executeCompletion } from './providers';
import { validatePolicy, POLICY_TYPES } from './validate.js';
import type { SqlTag } from './types/db';
import { createHash } from 'node:crypto';
import { getDefaultProviderModel } from './providers/providerRegistry';

const ACTION_TYPES = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other',
];

const POLICY_TYPE_SCHEMAS: Record<string, string> = {
  risk_threshold: '{ "threshold": <number 0-100>, "action": "block"|"warn"|"require_approval" }',
  require_approval: '{ "action_types": ["deploy", "migrate", ...] }',
  block_action_type: '{ "action_types": ["deploy", "migrate", ...] }',
  rate_limit: '{ "max_actions": <number>, "window_minutes": <number>, "action": "warn"|"block" }',
  permission_escalation: '{ "enforce": true }',
  green_contract: '{ "action_types": ["deploy"], "required_level": "targeted"|"package"|"workspace"|"merge_ready", "action": "block"|"require_approval" }',
  branch_freshness: '{ "action_types": ["deploy"], "freshness": ["stale", "diverged"], "max_commits_behind": <number>, "action": "block"|"require_approval" }',
  protected_path: '{ "paths": ["glob", ...], "action": "block"|"warn"|"require_approval" }  // protects files/dirs from being written or deleted; use for "don\'t delete/touch X"',
};

interface PolicyDraft {
  name: string;
  policy_type: string;
  rules: Record<string, unknown>;
  confidence: number;
}

interface FewShotExample {
  input: string;
  output: PolicyDraft;
}

const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    input: 'Block all production deploys',
    output: {
      name: 'Block production deploys',
      policy_type: 'block_action_type',
      rules: { action_types: ['deploy'] },
      confidence: 0.95,
    },
  },
  {
    input: 'Require human approval for any action with risk above 70',
    output: {
      name: 'High-risk approval gate',
      policy_type: 'risk_threshold',
      rules: { threshold: 70, action: 'require_approval' },
      confidence: 0.93,
    },
  },
  {
    input: 'Limit agents to 10 actions per hour',
    output: {
      name: 'Hourly rate limit',
      policy_type: 'rate_limit',
      rules: { max_actions: 10, window_minutes: 60, action: 'warn' },
      confidence: 0.90,
    },
  },
];

export function buildSystemPrompt(): string {
  const typeDescriptions = Object.entries(POLICY_TYPE_SCHEMAS)
    .map(([type, schema]) => `- ${type}: ${schema}`)
    .join('\n');

  const examples = FEW_SHOT_EXAMPLES
    .map((ex) => `Input: "${ex.input}"\nOutput: ${JSON.stringify([ex.output], null, 2)}`)
    .join('\n\n');

  return `You are a DashClaw policy generator. Convert natural language company policies into structured guard policies.

## Valid Policy Types and Rules Schemas
${typeDescriptions}

## Valid Action Types
${ACTION_TYPES.join(', ')}

## Examples
${examples}

## Output Format
Return ONLY a single JSON object (no markdown fences, no prose) with exactly these keys:
{
  "drafts": [ { "name": string, "policy_type": one of the types above, "rules": object matching that type's schema, "confidence": 0.0-1.0 } ],
  "assumptions": [ string ],      // plain-English assumptions you made to fill gaps
  "clarifications": [ { "id": string, "question": string, "field": "rules.<key>"|"policy_type", "suggestions": [string], "multi": boolean } ]
}

## Rules
- NEVER return an empty response and NEVER refuse. Always make progress.
- If the request is clear: return one or more drafts and list any assumptions you made.
- If the request is workable but vague (e.g. "protect things I care about"): return a BEST-EFFORT draft AND clarifications that tighten it. State your assumptions.
- If you genuinely cannot draft yet: return drafts: [] and 1-3 clarifications with concrete, clickable \`suggestions\`.
- \`suggestions\` must be concrete values the user can pick (e.g. paths like ".env", "secrets/", "migrations/"; or "warn"/"block"/"require approval"). For enum fields use only allowed values.
- Map "delete/remove/protect files or paths" to \`protected_path\`.
- If the input describes multiple distinct policies, draft the single most important one now and add a clarification listing the others so the user can author them one at a time. Return at most one draft per response — the reviewer saves one policy per pass.`;
}

interface Clarification {
  id: string;
  question: string;
  field: string | null;
  suggestions: string[];
  multi: boolean;
}

function makeGenericClarification(): Clarification {
  return {
    id: 'intent',
    question: 'What should this policy govern, and how strict should it be?',
    field: 'policy_type',
    suggestions: ['block deploys', 'protect a path from deletion', 'require approval over a risk level', 'rate-limit an agent'],
    multi: false,
  };
}

interface RawClarification {
  id?: unknown;
  question?: unknown;
  field?: unknown;
  suggestions?: unknown;
  multi?: unknown;
}

function sanitizeClarifications(raw: unknown): Clarification[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawClarification[])
    .filter((c) => c && typeof c.question === 'string')
    .slice(0, 4)
    .map((c, i) => ({
      id: typeof c.id === 'string' && c.id ? c.id : `q${i}`,
      question: c.question as string,
      field: typeof c.field === 'string' ? c.field : null,
      suggestions: Array.isArray(c.suggestions) ? (c.suggestions as unknown[]).filter((s) => typeof s === 'string').slice(0, 8) as string[] : [],
      multi: Boolean(c.multi),
    }));
}

interface ParsedDraft {
  name: string;
  policy_type: string;
  rules: unknown;
  confidence: number | null;
  recovery_recipe: unknown;
}

interface ParsedPolicies {
  drafts: ParsedDraft[];
  assumptions: string[];
  clarifications: Clarification[];
  warnings: string[];
}

interface RawDraftItem {
  name?: string;
  policy_type?: string;
  rules?: unknown;
  confidence?: unknown;
  recovery_recipe?: unknown;
}

export function parseGeneratedPolicies(rawContent: string | null | undefined): ParsedPolicies {
  const warnings: string[] = [];
  let cleaned = (rawContent || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { drafts: [], assumptions: [], clarifications: [makeGenericClarification()], warnings: ['Failed to parse model response as JSON'] };
  }

  // Back-compat: a bare array means drafts-only.
  const obj: Record<string, unknown> | null = Array.isArray(parsed)
    ? { drafts: parsed }
    : (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null);
  if (!obj) {
    return { drafts: [], assumptions: [], clarifications: [makeGenericClarification()], warnings: ['Model response was not a JSON object'] };
  }

  const drafts: ParsedDraft[] = [];
  for (const item of (Array.isArray(obj.drafts) ? obj.drafts : []) as RawDraftItem[]) {
    const result = validatePolicy({ name: item.name, policy_type: item.policy_type, rules: JSON.stringify(item.rules || {}) });
    if (result.valid) {
      drafts.push({
        name: item.name as string,
        policy_type: item.policy_type as string,
        rules: item.rules,
        confidence: typeof item.confidence === 'number' ? item.confidence : null,
        recovery_recipe: item.recovery_recipe || null,
      });
    } else {
      warnings.push(`"${item.name || 'unnamed'}": ${result.errors.join(', ')}`);
    }
  }

  const assumptions = Array.isArray(obj.assumptions) ? (obj.assumptions as unknown[]).filter((a) => typeof a === 'string') as string[] : [];
  const clarifications = sanitizeClarifications(obj.clarifications);

  // Never dead-end.
  if (drafts.length === 0 && clarifications.length === 0) {
    clarifications.push(makeGenericClarification());
  }

  return { drafts, assumptions, clarifications, warnings };
}

const DEFAULT_STRATEGY_CONFIG = {
  primary: {
    provider: 'openai',
    model: getDefaultProviderModel('openai', 'policy_generation') || 'gpt-4.1',
  },
  fallback: [
    {
      provider: 'anthropic',
      model: getDefaultProviderModel('anthropic', 'policy_generation') || 'claude-sonnet-4-6',
    },
  ],
  maxRetries: 1,
  maxBudgetUsd: 0.10,
};

interface PriorAnswer {
  id?: string;
  value?: string | string[];
}

export async function generatePolicies(
  sql: SqlTag,
  orgId: string,
  inputText: string,
  priorAnswers: PriorAnswer[] = [],
) {
  const { getSettings } = await import('./repositories/settings.repository');
  const settings = await getSettings(sql, orgId, { category: 'integration' });
  const providerKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'TOGETHER_API_KEY', 'PERPLEXITY_API_KEY'];
  const hasProvider = settings.some((s: Record<string, unknown>) => providerKeys.includes(s.key as string) && Boolean(s.value));

  if (!hasProvider) {
    return { error: 'No LLM provider configured. Add an API key in Settings or /setup.' };
  }

  const answersText = (Array.isArray(priorAnswers) ? priorAnswers : [])
    .filter((a) => a && a.id)
    .map((a) => `- ${a.id}: ${Array.isArray(a.value) ? a.value.join(', ') : a.value}`)
    .join('\n');
  const userContent = answersText
    ? `${inputText}\n\nClarifications the user provided:\n${answersText}`
    : inputText;

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: userContent },
  ];

  const completion = await executeCompletion(sql, orgId, DEFAULT_STRATEGY_CONFIG, messages, {
    max_tokens: 2048,
    temperature: 0.3,
  });

  const { drafts, assumptions, clarifications, warnings } = parseGeneratedPolicies(completion.content);
  const inputHash = createHash('sha256').update(inputText).digest('hex').slice(0, 16);

  return {
    drafts,
    assumptions,
    clarifications,
    warnings,
    input_hash: inputHash,
    llm_metadata: { provider: completion.provider, model: completion.model, cost_usd: completion.cost_usd },
  };
}

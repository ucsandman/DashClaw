import { describe, it, expect, vi } from 'vitest';
import { parseGeneratedPolicies, buildSystemPrompt } from '@/lib/policy-generator.js';

describe('parseGeneratedPolicies — structured {drafts, assumptions, clarifications}', () => {
  it('keeps valid drafts and passes through assumptions + clarifications', () => {
    const raw = JSON.stringify({
      drafts: [{ name: 'Protect secrets', policy_type: 'protected_path', rules: { paths: ['.env', 'secrets/'], action: 'block' }, confidence: 0.9 }],
      assumptions: ['Assumed protected paths from common sensitive locations'],
      clarifications: [{ id: 'action', question: 'How strict?', field: 'rules.action', suggestions: ['warn', 'block', 'require approval'], multi: false }],
    });
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0].policy_type).toBe('protected_path');
    expect(out.assumptions[0]).toMatch(/Assumed/);
    expect(out.clarifications[0].id).toBe('action');
    expect(out.warnings).toEqual([]);
  });

  it('drops an invalid draft into warnings but keeps the response usable', () => {
    const raw = JSON.stringify({ drafts: [{ name: '', policy_type: 'not_a_type', rules: {} }], assumptions: [], clarifications: [] });
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(0);
    expect(out.warnings.length).toBeGreaterThan(0);
    // never dead-ends: with no drafts and no clarifications, one is synthesized
    expect(out.clarifications.length).toBeGreaterThan(0);
  });

  it('never dead-ends on a JSON parse failure', () => {
    const out = parseGeneratedPolicies('not json at all');
    expect(out.drafts).toEqual([]);
    expect(out.clarifications.length).toBeGreaterThan(0);
  });

  it('accepts a bare array as drafts (back-compat)', () => {
    const raw = JSON.stringify([{ name: 'Block deploys', policy_type: 'block_action_type', rules: { action_types: ['deploy'] } }]);
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(1);
  });
});

describe('buildSystemPrompt', () => {
  it('documents the policy types and the never-empty instruction', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('protected_path');
    expect(prompt).toContain('risk_threshold');
    expect(prompt).toMatch(/NEVER return an empty/i);
  });
});

describe('sanitizeClarifications (via parseGeneratedPolicies)', () => {
  it('caps clarifications at 4, fills ids, coerces non-string field, caps suggestions, drops non-string assumptions', () => {
    const raw = JSON.stringify({
      drafts: [],
      assumptions: ['valid assumption', 42],
      clarifications: [
        { question: 'q one', field: { not: 'a string' }, suggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] },
        { question: 'q two' },
        { question: 'q three' },
        { question: 'q four' },
        { question: 'q five' },
      ],
    });
    const out = parseGeneratedPolicies(raw);
    expect(out.clarifications).toHaveLength(4);
    expect(out.clarifications[0].id).toBe('q0');
    expect(out.clarifications[0].field).toBeNull();
    expect(out.clarifications[0].suggestions).toHaveLength(8);
    expect(out.assumptions).toEqual(['valid assumption']);
  });
});

vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: vi.fn(async () => [{ key: 'OPENAI_API_KEY', value: 'sk-test' }]),
}));
const mockExec = vi.fn();
vi.mock('@/lib/providers.js', () => ({ executeCompletion: (...a) => mockExec(...a) }));

describe('generatePolicies', () => {
  it('returns drafts+clarifications and threads prior answers into the prompt', async () => {
    const { generatePolicies } = await import('@/lib/policy-generator.js');
    mockExec.mockResolvedValue({
      content: JSON.stringify({ drafts: [{ name: 'Protect .env', policy_type: 'protected_path', rules: { paths: ['.env'], action: 'block' }, confidence: 0.9 }], assumptions: [], clarifications: [] }),
      provider: 'openai', model: 'gpt-4.1', cost_usd: 0.001,
    });
    const sql = vi.fn();
    const out = await generatePolicies(sql, 'org_1', 'protect me from deletes', [{ id: 'paths', value: ['.env'] }]);
    expect(out.drafts[0].policy_type).toBe('protected_path');
    expect(out.clarifications).toEqual([]);
    // prior answer appears in the user message sent to the LLM
    const messages = mockExec.mock.calls[0][3];
    expect(JSON.stringify(messages)).toContain('.env');
  });
});

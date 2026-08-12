import { describe, expect, it } from 'vitest';
import { buildUngovernedScopeSignals } from '@/lib/signals.ts';

/**
 * Governance-scope visibility (adversarial review 2026-08-11).
 *
 * DASHCLAW_GOVERNED_CATEGORIES narrows governance on the agent's own machine,
 * and the hook exits before the network call for an excluded category — so
 * those tool calls never reach the server at all. Unlike observe mode, which
 * every decision carries via enforcement_mode, narrowing produced no row, no
 * witness and no signal: /decisions looked clean because nothing was recorded,
 * not because nothing ran. The hook now declares the gap on the calls it does
 * still make; this builder is what turns that into something a human sees.
 */

const dec = (agentId, ctx, id = 'gd_1', createdAt = '2026-08-11T10:00:00.000Z') => ({
  id,
  agent_id: agentId,
  context: JSON.stringify(ctx),
  created_at: createdAt,
});

describe('buildUngovernedScopeSignals', () => {
  it('is silent for a healthy agent that reports no gap', () => {
    const signals = buildUngovernedScopeSignals([
      dec('claude-code', { action_type: 'other', enforcement_mode: 'enforce' }),
    ]);
    expect(signals).toEqual([]);
  });

  it('is silent on an empty or absent list', () => {
    expect(buildUngovernedScopeSignals([])).toEqual([]);
    expect(buildUngovernedScopeSignals(null)).toEqual([]);
  });

  it('is silent when the reported gap is an empty array', () => {
    const signals = buildUngovernedScopeSignals([
      dec('claude-code', { ungoverned_categories: [] }),
    ]);
    expect(signals).toEqual([]);
  });

  it('raises a red signal naming the ungoverned categories', () => {
    const signals = buildUngovernedScopeSignals([
      dec('claude-code', { ungoverned_categories: ['execution', 'file_io'] }),
    ]);

    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('ungoverned_scope');
    // Red, not amber: an ungoverned category is a standing posture, not a blip.
    expect(signals[0].severity).toBe('red');
    expect(signals[0].agent_id).toBe('claude-code');
    expect(signals[0].detected_at).toBe('2026-08-11T10:00:00.000Z');
  });

  it('names the categories in operator language, not classifier language', () => {
    const [signal] = buildUngovernedScopeSignals([
      dec('claude-code', { ungoverned_categories: ['execution', 'file_io'] }),
    ]);
    // "execution" tells an operator nothing; "shell commands" tells them what
    // is unwatched.
    expect(signal.detail).toContain('shell commands');
    expect(signal.detail).toContain('file reads and writes');
    expect(signal.help).toContain('DASHCLAW_GOVERNED_CATEGORIES');
  });

  it('passes through a category it has no plain-English name for', () => {
    const [signal] = buildUngovernedScopeSignals([
      dec('claude-code', { ungoverned_categories: ['some_future_category'] }),
    ]);
    expect(signal.detail).toContain('some_future_category');
  });

  it('reports each agent once', () => {
    const signals = buildUngovernedScopeSignals([
      dec('agent-a', { ungoverned_categories: ['execution'] }, 'gd_1'),
      dec('agent-a', { ungoverned_categories: ['execution'] }, 'gd_2'),
      dec('agent-b', { ungoverned_categories: ['mcp'] }, 'gd_3'),
    ]);
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.agent_id).sort()).toEqual(['agent-a', 'agent-b']);
  });

  // The ordering trap: decisions arrive newest-first and only SOME carry the
  // gap. Marking an agent seen on a clean decision would suppress the narrowed
  // one behind it and the signal would flicker depending on traffic.
  it('still reports an agent whose clean decision is seen first', () => {
    const signals = buildUngovernedScopeSignals([
      dec('claude-code', { enforcement_mode: 'enforce' }, 'gd_clean'),
      dec('claude-code', { ungoverned_categories: ['execution'] }, 'gd_narrowed'),
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].agent_id).toBe('claude-code');
  });

  it('skips rows with no agent_id', () => {
    const signals = buildUngovernedScopeSignals([
      { id: 'gd_1', agent_id: null, context: JSON.stringify({ ungoverned_categories: ['execution'] }) },
    ]);
    expect(signals).toEqual([]);
  });

  it('survives malformed context without throwing', () => {
    expect(() =>
      buildUngovernedScopeSignals([{ id: 'gd_1', agent_id: 'a', context: '{not json' }]),
    ).not.toThrow();
  });

  it('ignores a non-array value in the field', () => {
    const signals = buildUngovernedScopeSignals([
      dec('claude-code', { ungoverned_categories: 'execution' }),
    ]);
    expect(signals).toEqual([]);
  });
});

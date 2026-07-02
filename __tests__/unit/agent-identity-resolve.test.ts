import { describe, it, expect } from 'vitest';
import { baseAgentId, subAgentSegment, groupFleetByParent } from '@/lib/agent-identity-resolve';

describe('subAgentSegment', () => {
  it('returns the segment after the first colon', () => {
    expect(subAgentSegment('claude-code:explore')).toBe('explore');
    expect(subAgentSegment('codex:code-reviewer')).toBe('code-reviewer');
  });

  it('returns null for non-composed or malformed ids', () => {
    expect(subAgentSegment('claude-code')).toBeNull();
    expect(subAgentSegment(':explore')).toBeNull(); // no parent segment
    expect(subAgentSegment('claude-code:')).toBeNull(); // no sub segment
    expect(subAgentSegment(null)).toBeNull();
  });

  it('is the complement of baseAgentId', () => {
    expect(baseAgentId('claude-code:explore')).toBe('claude-code');
    expect(subAgentSegment('claude-code:explore')).toBe('explore');
  });
});

describe('groupFleetByParent', () => {
  const idOf = (a: { agent_id: string }) => a.agent_id;

  it('places composed ids directly under their parent, preserving order', () => {
    const list = [
      { agent_id: 'claude-code' },
      { agent_id: 'codex' },
      { agent_id: 'claude-code:explore' },
      { agent_id: 'claude-code:plan' },
    ];
    const grouped = groupFleetByParent(list, idOf);
    expect(grouped.map((g) => [g.item.agent_id, g.depth])).toEqual([
      ['claude-code', 0],
      ['claude-code:explore', 1],
      ['claude-code:plan', 1],
      ['codex', 0],
    ]);
  });

  it('keeps an orphan composed id top-level when its parent is filtered out', () => {
    const list = [{ agent_id: 'claude-code:explore' }, { agent_id: 'codex' }];
    const grouped = groupFleetByParent(list, idOf);
    expect(grouped.map((g) => [g.item.agent_id, g.depth])).toEqual([
      ['claude-code:explore', 0],
      ['codex', 0],
    ]);
  });

  it('passes a flat list through unchanged', () => {
    const list = [{ agent_id: 'a' }, { agent_id: 'b' }];
    const grouped = groupFleetByParent(list, idOf);
    expect(grouped.every((g) => g.depth === 0)).toBe(true);
    expect(grouped.map((g) => g.item.agent_id)).toEqual(['a', 'b']);
  });
});

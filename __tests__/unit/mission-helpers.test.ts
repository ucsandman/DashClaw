import { describe, it, expect } from 'vitest';
import { matchesAgent, buildInterventionList, categoryCount } from '@/mission-control/lib/missionHelpers';

describe('matchesAgent', () => {
  it('matches everything when no agent is selected', () => {
    expect(matchesAgent({ agent_id: 'a1', source: 'action' }, null)).toBe(true);
  });
  it('matches the selected agent only, for agent-scoped sources', () => {
    expect(matchesAgent({ agent_id: 'a1', source: 'action' }, 'a1')).toBe(true);
    expect(matchesAgent({ agent_id: 'a2', source: 'action' }, 'a1')).toBe(false);
  });
  it('always keeps global infra (capability/integration) regardless of agent', () => {
    expect(matchesAgent({ agent_id: null, source: 'capability' }, 'a1')).toBe(true);
    expect(matchesAgent({ agent_id: null, source: 'integration' }, 'a1')).toBe(true);
  });
});

describe('buildInterventionList', () => {
  it('puts approvals first (sortKey -1) with source/sourceId/status for bulk + context menu', () => {
    const list = buildInterventionList(
      [{ action_id: 'act_1', agent_id: 'a1', declared_goal: 'send email' }],
      [{ loop_id: 'lp_1', agent_id: 'a2', priority: 'critical', description: 'stuck' }],
    );
    expect(list).toHaveLength(2);
    const [first, second] = list;
    expect(first!.kind).toBe('approval');
    expect(first!.source).toBe('action');
    expect(first!.sourceId).toBe('act_1');
    expect(first!.status).toBe('pending_approval');
    expect(second!.kind).toBe('loop');
    expect(second!.sourceId).toBe('lp_1');
  });
  it('drops non-urgent loops (not approval/critical/high)', () => {
    const list = buildInterventionList([], [{ loop_id: 'lp_2', priority: 'low', loop_type: 'note' }]);
    expect(list).toHaveLength(0);
  });
});

describe('categoryCount', () => {
  const feed = [
    { category: 'failure', source: 'action', agent_id: 'a1' },
    { category: 'failure', source: 'action', agent_id: 'a2' },
    { category: 'stale', source: 'loop', agent_id: 'a1' },
  ];
  it('counts a category across all agents when unscoped', () => {
    expect(categoryCount(feed, null, (i) => i.category === 'failure')).toBe(2);
  });
  it('scopes the count to the selected agent', () => {
    expect(categoryCount(feed, 'a1', (i) => i.category === 'failure')).toBe(1);
  });
});

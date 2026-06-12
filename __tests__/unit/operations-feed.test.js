import { describe, expect, it } from 'vitest';
import {
  mapApprovals,
  mapFailures,
  mapSignals,
  mapCapabilityHealth,
  mapIntegrationHealth,
  mapStaleLoops,
  SEVERITY_RANK,
} from '../../app/lib/operations-feed.js';

describe('mapApprovals', () => {
  it('maps pending approval to feed item with high severity when risk >= 70', () => {
    const items = mapApprovals([{
      action_id: 'act_1',
      agent_id: 'deploy-bot',
      declared_goal: 'Deploy to production',
      risk_score: 85,
      systems_touched: '["production"]',
      timestamp_start: '2026-04-08T14:00:00Z',
    }]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'approval:act_1',
      category: 'approval',
      severity: 'high',
      title: 'Awaiting approval: Deploy to production',
      source: 'action',
      source_id: 'act_1',
      agent_id: 'deploy-bot',
      suggested_action: 'approve',
    });
  });

  it('assigns medium severity when risk < 70', () => {
    const items = mapApprovals([{
      action_id: 'act_2',
      agent_id: 'helper',
      declared_goal: 'Log summary',
      risk_score: 30,
      timestamp_start: '2026-04-08T14:00:00Z',
    }]);

    expect(items[0].severity).toBe('medium');
  });
});

describe('mapFailures', () => {
  it('marks agent with 3+ failures as high severity', () => {
    const actions = [
      { action_id: 'act_1', agent_id: 'bot_1', declared_goal: 'Task 1', error_message: 'err', timestamp_start: '2026-04-08T14:00:00Z' },
      { action_id: 'act_2', agent_id: 'bot_1', declared_goal: 'Task 2', error_message: 'err', timestamp_start: '2026-04-08T13:00:00Z' },
      { action_id: 'act_3', agent_id: 'bot_1', declared_goal: 'Task 3', error_message: 'err', timestamp_start: '2026-04-08T12:00:00Z' },
    ];

    const items = mapFailures(actions);
    expect(items[0].severity).toBe('high');
  });

  it('marks single failure as medium severity', () => {
    const items = mapFailures([{
      action_id: 'act_1',
      agent_id: 'bot_2',
      declared_goal: 'One-off fail',
      error_message: 'timeout',
      timestamp_start: '2026-04-08T14:00:00Z',
    }]);

    expect(items[0].severity).toBe('medium');
  });
});

describe('mapSignals', () => {
  it('maps red signal to critical severity', () => {
    const items = mapSignals([{
      type: 'session_stalled',
      severity: 'red',
      label: 'Session stalled: agent-1',
      detail: 'No activity for 4h',
      agent_id: 'agent-1',
    }]);

    expect(items[0].severity).toBe('critical');
    expect(items[0].category).toBe('signal');
  });

  it('maps amber signal to high severity', () => {
    const items = mapSignals([{
      type: 'autonomy_spike',
      severity: 'amber',
      label: 'Autonomy spike: bot-1',
      detail: '15 ungoverned actions/hour',
      agent_id: 'bot-1',
    }]);

    expect(items[0].severity).toBe('high');
  });

  it('passes detected_at through to timestamp when present', () => {
    const items = mapSignals([{
      type: 'high_impact_low_oversight',
      severity: 'red',
      label: 'X',
      detail: 'Y',
      agent_id: 'a1',
      detected_at: '2026-04-08T14:00:00Z',
    }]);

    expect(items[0].timestamp).toBe('2026-04-08T14:00:00Z');
  });

  it('collapses repeated occurrences of the same signal into one item carrying every dismiss key', () => {
    // Real fleets accumulate dozens of e.g. session_stalled occurrences for one agent.
    // Un-grouped they render as identical rows (same feed id → duplicate React keys) and
    // dismissing one occurrence is visually a no-op.
    const occ = (detected_at) => ({
      type: 'session_stalled',
      severity: 'red',
      label: 'Session stalled: openclaw',
      detail: 'No activity',
      agent_id: 'openclaw',
      detected_at,
    });
    const items = mapSignals([
      occ('2026-06-10T02:31:21Z'),
      occ('2026-06-12T04:31:15Z'), // newest, deliberately not first
      occ('2026-06-11T03:17:40Z'),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].occurrence_count).toBe(3);
    expect(items[0].dismiss_keys).toHaveLength(3);
    // The group is represented by its newest occurrence.
    expect(items[0].timestamp).toBe('2026-06-12T04:31:15Z');
    expect(items[0].dismiss_key).toBe(items[0].dismiss_keys[0]);
    expect(new Set(items[0].dismiss_keys).size).toBe(3);
  });

  it('keeps distinct signals (different agent or ref) as separate items', () => {
    const items = mapSignals([
      { type: 'session_stalled', severity: 'red', label: 'A', agent_id: 'a1', detected_at: '2026-06-12T00:00:00Z' },
      { type: 'session_stalled', severity: 'red', label: 'B', agent_id: 'a2', detected_at: '2026-06-12T00:00:00Z' },
      { type: 'workflow_stuck', severity: 'red', label: 'C', agent_id: 'a1', action_id: 'act_1', detected_at: '2026-06-12T00:00:00Z' },
    ]);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.occurrence_count === 1)).toBe(true);
  });

  it('returns null timestamp when source has no detected_at (no Date.now fallback)', () => {
    const items = mapSignals([{
      type: 'integration_mismatch',
      severity: 'amber',
      label: 'X',
      detail: 'Y',
      agent_id: 'a1',
    }]);

    expect(items[0].timestamp).toBeNull();
  });
});

describe('timestamp fallbacks (no Date.now lies)', () => {
  it('mapApprovals returns null when source has no timestamps', () => {
    const items = mapApprovals([{ action_id: 'act_1', agent_id: 'a1', declared_goal: 'G' }]);
    expect(items[0].timestamp).toBeNull();
  });

  it('mapFailures returns null when source has no timestamps', () => {
    const items = mapFailures([{ action_id: 'act_1', agent_id: 'a1', declared_goal: 'G' }]);
    expect(items[0].timestamp).toBeNull();
  });

  it('mapCapabilityHealth returns null when last_invocation missing', () => {
    const items = mapCapabilityHealth([{ capability_id: 'cap_1', name: 'N', status: 'failing' }]);
    expect(items[0].timestamp).toBeNull();
  });

  it('mapIntegrationHealth returns null when checked_at missing', () => {
    const items = mapIntegrationHealth({ openai: { status: 'error', message: 'm' } });
    expect(items[0].timestamp).toBeNull();
  });

  it('mapStaleLoops returns null when created_at missing', () => {
    const items = mapStaleLoops([{ loop_id: 'l1', description: 'd' }]);
    expect(items[0].timestamp).toBeNull();
  });
});

describe('mapCapabilityHealth', () => {
  it('maps failing capability to critical severity', () => {
    const items = mapCapabilityHealth([{
      capability_id: 'cap_1',
      name: 'Research API',
      status: 'failing',
      success_rate_1d: 0.12,
      recent_errors: [{}, {}, {}],
    }]);

    expect(items[0]).toMatchObject({
      category: 'health',
      severity: 'critical',
      source: 'capability',
      suggested_action: 'disable',
    });
  });

  it('maps degraded capability to high severity', () => {
    const items = mapCapabilityHealth([{
      capability_id: 'cap_2',
      name: 'Email API',
      status: 'degraded',
      success_rate_1d: 0.75,
    }]);

    expect(items[0].severity).toBe('high');
    expect(items[0].suggested_action).toBe('investigate');
  });

  it('skips healthy capabilities', () => {
    const items = mapCapabilityHealth([{ capability_id: 'cap_3', name: 'OK API', status: 'healthy' }]);
    expect(items).toHaveLength(0);
  });
});

describe('mapIntegrationHealth', () => {
  it('maps error integration to high severity', () => {
    const items = mapIntegrationHealth({
      openai: { status: 'error', message: 'Invalid API key', checked_at: '2026-04-08T14:00:00Z' },
    });

    expect(items[0]).toMatchObject({
      category: 'health',
      severity: 'high',
      source: 'integration',
      suggested_action: 'investigate',
    });
  });

  it('skips healthy and not_configured integrations', () => {
    const items = mapIntegrationHealth({
      openai: { status: 'healthy' },
      stripe: { status: 'not_configured' },
    });

    expect(items).toHaveLength(0);
  });
});

describe('mapStaleLoops', () => {
  it('maps stale open loop to medium severity', () => {
    const items = mapStaleLoops([{
      loop_id: 'loop_1',
      description: 'Awaiting data review',
      priority: 'medium',
      loop_type: 'dependency',
      created_at: '2026-04-06T10:00:00Z',
      action_id: 'act_1',
    }]);

    expect(items[0]).toMatchObject({
      category: 'stale',
      severity: 'medium',
      source: 'loop',
      suggested_action: 'investigate',
    });
  });
});

describe('SEVERITY_RANK', () => {
  it('ranks critical < high < medium < low', () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeLessThan(SEVERITY_RANK.low);
  });
});

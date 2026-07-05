import { describe, expect, it } from 'vitest';
import {
  buildActionEvent,
  buildAssumptionEvent,
  buildGuardEvent,
  collapseRoutineTelemetry,
} from '@/lib/missionControl.js';

describe('missionControl normalization', () => {
  it('marks low-risk monitor actions as telemetry', () => {
    const event = buildActionEvent({
      action_id: 'act_monitor',
      action_type: 'monitor',
      declared_goal: 'Check queue depth',
      status: 'completed',
      risk_score: 32,
      created_at: '2026-03-10T11:50:00.000Z',
    });

    expect(event.category).toBe('telemetry');
    expect(event.lowSignal).toBe(true);
  });

  it('surfaces unresolved assumptions as governance events', () => {
    const event = buildAssumptionEvent({
      assumption_id: 'asm_1',
      action_id: 'act_1',
      assumption: 'Schema matches the rollout plan',
      basis: 'Release checklist from the previous deploy',
      validated: 0,
      invalidated: 0,
      drift_score: 68,
      created_at: '2026-03-10T11:55:00.000Z',
    });

    expect(event.category).toBe('governance');
    expect(event.status).toBe('unresolved_assumption');
    expect(event.outputSummary).toContain('Schema matches the rollout plan');
  });

  it('collapses repeated telemetry while preserving high-signal events', () => {
    const collapsed = collapseRoutineTelemetry([
      buildActionEvent({
        action_id: 'act_1',
        action_type: 'monitor',
        declared_goal: 'Check queue depth',
        status: 'completed',
        risk_score: 25,
        created_at: '2026-03-10T11:58:00.000Z',
      }),
      buildActionEvent({
        action_id: 'act_2',
        action_type: 'monitor',
        declared_goal: 'Check queue depth',
        status: 'completed',
        risk_score: 24,
        created_at: '2026-03-10T11:53:00.000Z',
      }),
      buildGuardEvent({
        id: 'guard_1',
        decision: 'block',
        action_type: 'deploy',
        reason: 'Manual approval required',
        risk_score: 90,
        created_at: '2026-03-10T11:57:00.000Z',
      }),
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed.find((item) => item.aggregate)?.count).toBe(2);
    expect(collapsed.find((item) => item.entityType === 'guard')?.status).toBe('block');
  });
});


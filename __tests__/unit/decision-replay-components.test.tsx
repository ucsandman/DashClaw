import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

// Render-pins for the Decision Replay tab components extracted in the
// v4.72.0 decomposition. No jest-dom — assert via queries/textContent.

vi.mock('@/components/MessageTrail', () => ({
  TimelineMessage: ({ message }: any) => <div data-testid="timeline-message">{message.id}</div>,
}));
vi.mock('@/components/OutcomeBadge', () => ({ OutcomeBadge: () => null }));
vi.mock('@/components/AgentDefenseCard', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a>,
}));

import ChronologicalTimeline from '../../app/decisions/[actionId]/_components/ChronologicalTimeline';
import PoliciesTab from '../../app/decisions/[actionId]/_components/PoliciesTab';
import AssumptionsTab from '../../app/decisions/[actionId]/_components/AssumptionsTab';
import SignalsTab from '../../app/decisions/[actionId]/_components/SignalsTab';
import EvidenceTab from '../../app/decisions/[actionId]/_components/EvidenceTab';
import ReplaySidebar from '../../app/decisions/[actionId]/_components/ReplaySidebar';

afterEach(cleanup);

const baseAction = {
  action_id: 'act_test_1',
  agent_id: 'agent-1',
  agent_name: 'Test Agent',
  action_type: 'code_change',
  status: 'completed',
  timestamp_start: '2026-07-01T10:00:00Z',
  declared_goal: 'Do the thing',
};

describe('ChronologicalTimeline', () => {
  it('shows the empty state without events', () => {
    const { container } = render(
      <ChronologicalTimeline timelineEvents={[]} messages={[]} messageCorrelation="none" messageThreadName={null} />
    );
    expect(container.textContent).toContain('No timeline events to display.');
  });

  it('labels time-window correlation as inferred', () => {
    const { container } = render(
      <ChronologicalTimeline
        timelineEvents={[{ type: 'message', timestamp: '2026-07-01T10:01:00Z', data: { id: 'm1' } }]}
        messages={[{ id: 'm1' }]}
        messageCorrelation="time_window"
        messageThreadName={null}
      />
    );
    expect(container.textContent).toContain('inferred from timing');
    expect(screen.getByTestId('timeline-message').textContent).toBe('m1');
  });

  it('labels explicit correlation and the thread name', () => {
    const { container } = render(
      <ChronologicalTimeline
        timelineEvents={[]}
        messages={[{ id: 'm1' }]}
        messageCorrelation="explicit"
        messageThreadName="release-thread"
      />
    );
    expect(container.textContent).toContain('explicitly linked');
    expect(container.textContent).toContain('release-thread');
  });

  it('renders guard, start, and outcome events', () => {
    const { container } = render(
      <ChronologicalTimeline
        timelineEvents={[
          { type: 'guard', timestamp: '2026-07-01T09:59:00Z', data: { decision: 'allow', risk_score: 12 } },
          { type: 'action_start', timestamp: '2026-07-01T10:00:00Z', data: baseAction },
          { type: 'outcome', timestamp: '2026-07-01T10:05:00Z', data: { ...baseAction, output_summary: 'It worked' } },
        ]}
        messages={[]}
        messageCorrelation="none"
        messageThreadName={null}
      />
    );
    expect(container.textContent).toContain('ALLOW');
    expect(container.textContent).toContain('Do the thing');
    expect(container.textContent).toContain('It worked');
  });
});

describe('PoliciesTab', () => {
  it('shows the ungoverned empty state without a guard decision', () => {
    const { container } = render(
      <PoliciesTab actionId="act_test_1" action={baseAction} guardDecision={null} trace={null} assumptions={[]} />
    );
    expect(container.textContent).toContain('No Governance Data');
    expect(container.textContent).toContain('POLICIES_MATCHED: 0');
  });

  it('renders the decision and matched policies', () => {
    const { container } = render(
      <PoliciesTab
        actionId="act_test_1"
        action={baseAction}
        guardDecision={{
          decision: 'block',
          created_at: '2026-07-01T09:59:00Z',
          reason: 'Too risky',
          matched_policies: JSON.stringify(['no-prod-writes']),
        }}
        trace={null}
        assumptions={[{ assumption_id: 'a1' }]}
      />
    );
    expect(container.textContent).toContain('BLOCK');
    expect(container.textContent).toContain('Too risky');
    expect(container.textContent).toContain('no-prod-writes');
    expect(container.textContent).toContain('ASSUMPTIONS_CHECKED: 1');
  });
});

describe('AssumptionsTab', () => {
  const unresolved = { assumption_id: 'a1', assumption: 'DB is reachable' };

  it('fires onValidate for an unresolved assumption', () => {
    const onValidate = vi.fn();
    render(
      <AssumptionsTab
        assumptions={[unresolved]}
        pendingOps={{}}
        invalidateReasons={{}}
        setInvalidateReasons={vi.fn()}
        onValidate={onValidate}
        onInvalidate={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Validate'));
    expect(onValidate).toHaveBeenCalledWith('a1');
  });

  it('keeps Invalidate disabled until a reason exists', () => {
    const onInvalidate = vi.fn();
    const { rerender } = render(
      <AssumptionsTab
        assumptions={[unresolved]}
        pendingOps={{}}
        invalidateReasons={{}}
        setInvalidateReasons={vi.fn()}
        onValidate={vi.fn()}
        onInvalidate={onInvalidate}
      />
    );
    const button = screen.getByText('Invalidate') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    rerender(
      <AssumptionsTab
        assumptions={[unresolved]}
        pendingOps={{}}
        invalidateReasons={{ a1: 'stale schema' }}
        setInvalidateReasons={vi.fn()}
        onValidate={vi.fn()}
        onInvalidate={onInvalidate}
      />
    );
    fireEvent.click(screen.getByText('Invalidate'));
    expect(onInvalidate).toHaveBeenCalledWith('a1');
  });

  it('summarizes drift from invalidated assumptions', () => {
    const { container } = render(
      <AssumptionsTab
        assumptions={[{ assumption_id: 'a1', invalidated: true }, { assumption_id: 'a2', validated: true }]}
        pendingOps={{}}
        invalidateReasons={{}}
        setInvalidateReasons={vi.fn()}
        onValidate={vi.fn()}
        onInvalidate={vi.fn()}
      />
    );
    expect(container.textContent).toContain('1/2 invalidated (Elevated)');
  });

  it('shows empty states without assumptions', () => {
    const { container } = render(
      <AssumptionsTab
        assumptions={[]}
        pendingOps={{}}
        invalidateReasons={{}}
        setInvalidateReasons={vi.fn()}
        onValidate={vi.fn()}
        onInvalidate={vi.fn()}
      />
    );
    expect(container.textContent).toContain('No explicit assumptions recorded');
    expect(container.textContent).toContain('No assumptions recorded to assess drift.');
  });
});

describe('SignalsTab', () => {
  it('shows the clean state without indicators', () => {
    const { container } = render(<SignalsTab trace={null} />);
    expect(container.textContent).toContain('No anomaly signals detected');
  });

  it('renders indicators with severity badges', () => {
    const { container } = render(
      <SignalsTab trace={{
        root_cause_indicators: [{
          type: 'invalidated_assumptions',
          severity: 'high',
          detail: [{ assumption: 'DB is reachable', reason: 'connection refused' }],
        }],
      }} />
    );
    expect(container.textContent).toContain('invalidated assumptions');
    expect(container.textContent).toContain('HIGH ALERT');
    expect(container.textContent).toContain('connection refused');
  });
});

describe('EvidenceTab', () => {
  it('shows empty states when nothing was recorded', () => {
    const { container } = render(<EvidenceTab action={baseAction} />);
    expect(container.textContent).toContain('No side effects recorded.');
    expect(container.textContent).toContain('No artifacts recorded.');
    expect(container.textContent).toContain('No systems recorded.');
  });

  it('renders recorded side effects, artifacts, and systems', () => {
    const { container } = render(
      <EvidenceTab action={{
        ...baseAction,
        side_effects: JSON.stringify(['dropped index']),
        artifacts_created: JSON.stringify(['report.md']),
        systems_touched: JSON.stringify(['postgres']),
      }} />
    );
    expect(container.textContent).toContain('dropped index');
    expect(container.textContent).toContain('report.md');
    expect(container.textContent).toContain('postgres');
  });
});

describe('ReplaySidebar', () => {
  it('renders identity and gates loop resolution on a reason', () => {
    const onResolveLoop = vi.fn();
    const { container, rerender } = render(
      <ReplaySidebar
        action={baseAction}
        defense={null}
        trace={null}
        loops={[{ loop_id: 'l1', status: 'open', description: 'Follow up on export' }]}
        pendingOps={{}}
        resolveTexts={{}}
        setResolveTexts={vi.fn()}
        onResolveLoop={onResolveLoop}
        onCancelLoop={vi.fn()}
      />
    );
    expect(container.textContent).toContain('act_test_1');
    expect(container.textContent).toContain('Follow up on export');
    const resolve = screen.getByText('Resolve') as HTMLButtonElement;
    expect(resolve.disabled).toBe(true);

    rerender(
      <ReplaySidebar
        action={baseAction}
        defense={null}
        trace={null}
        loops={[{ loop_id: 'l1', status: 'open', description: 'Follow up on export' }]}
        pendingOps={{}}
        resolveTexts={{ l1: 'done via v4.72.0' }}
        setResolveTexts={vi.fn()}
        onResolveLoop={onResolveLoop}
        onCancelLoop={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Resolve'));
    expect(onResolveLoop).toHaveBeenCalledWith('l1');
  });

  it('links lineage entries to their decisions', () => {
    const { container } = render(
      <ReplaySidebar
        action={baseAction}
        defense={null}
        trace={{ parent_chain: [{ action_id: 'act_parent', declared_goal: 'Parent goal' }] }}
        loops={[]}
        pendingOps={{}}
        resolveTexts={{}}
        setResolveTexts={vi.fn()}
        onResolveLoop={vi.fn()}
        onCancelLoop={vi.fn()}
      />
    );
    const link = container.querySelector('a[href="/decisions/act_parent"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('Parent goal');
  });
});

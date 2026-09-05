import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('audit operator UI contracts', () => {
  it('never renders successful-empty approval or decision copy after a failed refresh', () => {
    const approvals = read('app/approvals/page.tsx');
    const decisions = read('app/decisions/page.tsx');
    expect(approvals).toContain('Approval queue unavailable');
    expect(approvals).toContain('Showing the last successful result');
    expect(decisions).toContain('Decision ledger unavailable');
    expect(decisions).toContain('Showing the last successful result');
  });

  it('labels the redacted bound act separately from the agent request', () => {
    const approvals = read('app/approvals/page.tsx');
    expect(approvals).toContain('Bound act');
    expect(approvals).toContain('Recorded request');
    expect(approvals).not.toContain('Exact command');
  });

  it('preserves zero confidence and distinguishes identity from payload signatures', () => {
    const list = read('app/decisions/page.tsx');
    const detail = read('app/decisions/[actionId]/page.tsx');
    expect(list).toContain('action.confidence ?? 50');
    expect(detail).toContain('action.confidence ?? 50');
    expect(list).toContain('Verified identity');
    expect(detail).toContain('Payload signed');
  });

  it('uses named controls and complete tab relationships', () => {
    const list = read('app/decisions/page.tsx');
    const detail = read('app/decisions/[actionId]/page.tsx');
    const ledger = read('app/policies/components/Ledger.tsx');
    expect(list).toContain('aria-label="Filter by action type"');
    expect(detail).toContain('role="tablist"');
    expect(detail).toContain('role="tabpanel"');
    expect(ledger).toContain('aria-controls="ledger-panel"');
  });

  it('folds Tuning into Policies and exposes measured protection state', () => {
    const sidebar = read('app/components/Sidebar.tsx');
    const setup = read('app/setup/page.tsx');
    expect(sidebar).not.toContain("label: 'Tuning'");
    expect(setup).toContain('Protection state');
    expect(setup).toContain("'mechanical'");
    expect(setup).toContain("'cooperative'");
    expect(setup).toContain("'degraded'");
    expect(setup).toContain("'unknown'");
  });
});

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import RiskBreakdownPanel from '@/components/RiskBreakdownPanel';

// The risk-derivation ledger: factor rows render with their deltas and the
// final line reproduces the persisted score.

const BREAKDOWN = {
  base: { action_type: 'deploy', score: 75 },
  modifiers: [
    { factor: 'irreversible', delta: 15 },
    { factor: 'systems:production', delta: 10 },
  ],
  server_total: 100,
  template: { id: 'rt_1', name: 'Production Safety', score: 80 },
  client_reported: 55,
  effective: 100,
  predictive: { adjustment: 5, basis: 'no_history' },
  final: 100,
};

describe('RiskBreakdownPanel', () => {
  it('renders base, each modifier, template, client, predictive, and the final score', () => {
    const { container } = render(<RiskBreakdownPanel breakdown={BREAKDOWN} />);
    const text = container.textContent;
    expect(text).toContain('Risk derivation');
    expect(text).toContain('Base · deploy');
    expect(text).toContain('irreversible');
    expect(text).toContain('+15');
    expect(text).toContain('systems:production');
    expect(text).toContain('template:Production Safety');
    expect(text).toContain('agent-reported risk');
    expect(text).toContain('predictive adjustment');
    expect(text).toContain('improves as more actions are recorded');
    expect(text).toContain('Final');
  });

  it('renders nothing for a missing/malformed breakdown', () => {
    expect(render(<RiskBreakdownPanel breakdown={null} />).container.textContent).toBe('');
    expect(render(<RiskBreakdownPanel breakdown={{}} />).container.textContent).toBe('');
  });
});

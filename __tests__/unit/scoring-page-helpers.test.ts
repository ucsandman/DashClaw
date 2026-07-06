import { describe, it, expect } from 'vitest';
import { scoreColor, scoreBg } from '../../app/scoring/_components/helpers';

// Pins the 80/60/40 score bands extracted from the Scoring page in the
// v4.72.0 decomposition.

describe('scoreColor', () => {
  it('bands at 80/60/40', () => {
    expect(scoreColor(80)).toBe('text-success');
    expect(scoreColor(79)).toBe('text-warning');
    expect(scoreColor(60)).toBe('text-warning');
    expect(scoreColor(59)).toBe('text-brand');
    expect(scoreColor(40)).toBe('text-brand');
    expect(scoreColor(39)).toBe('text-error');
    expect(scoreColor(0)).toBe('text-error');
  });
});

describe('scoreBg', () => {
  it('matches the scoreColor bands', () => {
    expect(scoreBg(80)).toBe('bg-success-subtle');
    expect(scoreBg(60)).toBe('bg-status-warning/20');
    expect(scoreBg(40)).toBe('bg-brand/20');
    expect(scoreBg(39)).toBe('bg-error-subtle');
  });
});

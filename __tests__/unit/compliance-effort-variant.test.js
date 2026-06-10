/**
 * P13: the effort Badge variant must derive from the analyzer's
 * estimated_effort hour-strings ('1-2 hours' .. '8-16 hours'). The page
 * previously looked up EFFORT_VARIANTS[r.effort] — a key the analyzer never
 * emits — so every badge rendered the 'default' variant.
 */
import { describe, expect, it } from 'vitest';
import { effortVariant } from '../../app/lib/compliance/effort';

describe('effortVariant', () => {
  it('maps the analyzer hour-strings to severity variants', () => {
    expect(effortVariant('1-2 hours')).toBe('success');
    expect(effortVariant('2-4 hours')).toBe('warning');
    expect(effortVariant('4-8 hours')).toBe('warning');
    expect(effortVariant('8-16 hours')).toBe('error');
  });

  it('falls back to default for unknown shapes', () => {
    expect(effortVariant(undefined)).toBe('default');
    expect(effortVariant(null)).toBe('default');
    expect(effortVariant('unknown')).toBe('default');
    expect(effortVariant(42)).toBe('default');
  });
});

import { describe, it, expect } from 'vitest';
import { isDrillMint, DRILL_MINT_SOURCE } from '../../../app/lib/hosted/drill-mint';

// v8.3 entry-path drills: the operator-held Turnstile substitute on the mint
// route. The whole point of these tests is the containment matrix — the
// bypass must be impossible unless a long value is deliberately configured
// AND presented exactly.

const GOOD = 'drill-0123456789abcdef0123456789abcdef';

function req(headerValue) {
  return new Request('https://hosted.example/api/hosted/workspaces', {
    method: 'POST',
    headers: headerValue === undefined ? {} : { 'x-hosted-drill-token': headerValue },
  });
}

describe('isDrillMint', () => {
  it('is false when the env var is unset — no bypass exists by default', () => {
    expect(isDrillMint(req(GOOD), {})).toBe(false);
    expect(isDrillMint(req(GOOD), { HOSTED_DRILL_TOKEN: undefined })).toBe(false);
  });

  it('refuses values shorter than 24 chars even when header matches exactly', () => {
    const weak = 'short-value';
    expect(isDrillMint(req(weak), { HOSTED_DRILL_TOKEN: weak })).toBe(false);
    expect(isDrillMint(req(''), { HOSTED_DRILL_TOKEN: '' })).toBe(false);
  });

  it('is false when the header is missing, empty, or wrong', () => {
    const env = { HOSTED_DRILL_TOKEN: GOOD };
    expect(isDrillMint(req(undefined), env)).toBe(false);
    expect(isDrillMint(req(''), env)).toBe(false);
    expect(isDrillMint(req(GOOD.slice(0, -1) + 'X'), env)).toBe(false);
    expect(isDrillMint(req(GOOD + 'x'), env)).toBe(false); // length mismatch path
  });

  it('is true only on an exact match of a configured long value', () => {
    expect(isDrillMint(req(GOOD), { HOSTED_DRILL_TOKEN: GOOD })).toBe(true);
  });

  it('exports the reserved source label the mint route force-applies', () => {
    expect(DRILL_MINT_SOURCE).toBe('drill');
  });
});

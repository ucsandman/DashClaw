import { describe, expect, it } from 'vitest';
import { doctorExitCode } from '../../scripts/lib/doctor-cli.mjs';

describe('doctor CLI status', () => {
  it('fails when doctor found real failures', () => {
    expect(doctorExitCode({ status: 'unhealthy' })).toBe(1);
  });

  it('allows advisory-only warnings in the default local doctor command', () => {
    expect(doctorExitCode({ status: 'needs_attention' })).toBe(0);
  });

  it('can be made strict for CI callers that want warnings to fail', () => {
    expect(doctorExitCode({ status: 'needs_attention' }, { strict: true })).toBe(1);
  });
});

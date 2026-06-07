import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isHostedMode, hostedConfig } from '../../../app/lib/hosted/flag.js';

describe('hosted flag', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...original }; });
  afterEach(() => { process.env = { ...original }; });

  it('isHostedMode returns false when DASHCLAW_HOSTED is unset', () => {
    delete process.env.DASHCLAW_HOSTED;
    expect(isHostedMode()).toBe(false);
  });

  it('isHostedMode returns true when DASHCLAW_HOSTED=true', () => {
    process.env.DASHCLAW_HOSTED = 'true';
    expect(isHostedMode()).toBe(true);
  });

  it('isHostedMode is false for "1", "yes", or any non-"true" value (strict)', () => {
    process.env.DASHCLAW_HOSTED = '1';
    expect(isHostedMode()).toBe(false);
  });

  it('hostedConfig returns defaults when env vars unset', () => {
    delete process.env.HOSTED_TRIAL_DAYS;
    delete process.env.HOSTED_TRIAL_ACTION_CAP;
    delete process.env.HOSTED_PROVISION_MAX_PER_IP_PER_DAY;
    delete process.env.HOSTED_MAX_ACTIVE_TRIALS;
    expect(hostedConfig()).toEqual({
      trialDays: 30,
      trialActionCap: 10000,
      maxProvisionsPerIpPerDay: 5,
      maxActiveTrials: 500,
    });
  });

  it('hostedConfig honors env overrides', () => {
    process.env.HOSTED_TRIAL_DAYS = '7';
    process.env.HOSTED_TRIAL_ACTION_CAP = '500';
    process.env.HOSTED_PROVISION_MAX_PER_IP_PER_DAY = '2';
    expect(hostedConfig()).toEqual({
      trialDays: 7,
      trialActionCap: 500,
      maxProvisionsPerIpPerDay: 2,
      maxActiveTrials: 500,
    });
  });

  it('maxActiveTrials defaults to 500 when HOSTED_MAX_ACTIVE_TRIALS is unset', () => {
    delete process.env.HOSTED_MAX_ACTIVE_TRIALS;
    expect(hostedConfig().maxActiveTrials).toBe(500);
  });

  it('maxActiveTrials reads HOSTED_MAX_ACTIVE_TRIALS env var', () => {
    process.env.HOSTED_MAX_ACTIVE_TRIALS = '25';
    expect(hostedConfig().maxActiveTrials).toBe(25);
  });

  it('hostedConfig rejects non-numeric overrides and falls back to default', () => {
    process.env.HOSTED_TRIAL_DAYS = 'abc';
    expect(hostedConfig().trialDays).toBe(30);
  });
});

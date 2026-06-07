export function isHostedMode(): boolean {
  return process.env.DASHCLAW_HOSTED === 'true';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function hostedConfig(): {
  trialDays: number;
  trialActionCap: number;
  maxProvisionsPerIpPerDay: number;
  maxActiveTrials: number;
} {
  return {
    trialDays: parsePositiveInt(process.env.HOSTED_TRIAL_DAYS, 30),
    trialActionCap: parsePositiveInt(process.env.HOSTED_TRIAL_ACTION_CAP, 10000),
    maxProvisionsPerIpPerDay: parsePositiveInt(process.env.HOSTED_PROVISION_MAX_PER_IP_PER_DAY, 5),
    maxActiveTrials: parsePositiveInt(process.env.HOSTED_MAX_ACTIVE_TRIALS, 500),
  };
}

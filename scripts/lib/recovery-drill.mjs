function databaseIdentity(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Recovery database URL is invalid');
  }
  const port = parsed.port || (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:' ? '5432' : '');
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}${parsed.pathname}${parsed.search}`;
}

export function assertDisposableRestoreTarget(targetUrl, sourceUrl, environment = 'nonproduction') {
  if (!targetUrl || !sourceUrl) throw new Error('Both restore target and source database URLs are required');
  if (environment !== 'nonproduction') throw new Error('Recovery drills require RECOVERY_DRILL_ENVIRONMENT=nonproduction');
  if (databaseIdentity(targetUrl) === databaseIdentity(sourceUrl)) {
    throw new Error('Recovery drill target must differ from the source database');
  }
}

function objectiveCheck(measuredSeconds, objectiveSeconds) {
  if (!Number.isFinite(measuredSeconds) || !Number.isFinite(objectiveSeconds)) {
    return { status: 'fail', measured_seconds: measuredSeconds, objective_seconds: objectiveSeconds };
  }
  return {
    status: measuredSeconds <= objectiveSeconds ? 'pass' : 'fail',
    measured_seconds: measuredSeconds,
    objective_seconds: objectiveSeconds,
  };
}

export function evaluateRecoverySnapshot({
  counts,
  outstandingClaims,
  outstandingClaimCount = outstandingClaims.length,
  historicalVerification,
  measuredRpoSeconds,
  measuredRtoSeconds,
  objectives,
}) {
  const failedVerification = historicalVerification.filter((row) => !row.verified);
  const checks = {
    inventory: {
      status: counts.actions >= 0 && counts.signingKeys > 0 ? 'pass' : 'fail',
      counts,
    },
    outstandingClaims: {
      status: outstandingClaimCount > 0 ? 'review' : 'pass',
      count: outstandingClaimCount,
      sample_count: outstandingClaims.length,
      truncated: outstandingClaimCount > outstandingClaims.length,
      rows: outstandingClaims,
    },
    historicalVerification: {
      status: failedVerification.length > 0 ? 'fail' : historicalVerification.length === 0 ? 'review' : 'pass',
      checked: historicalVerification.length,
      failures: failedVerification,
    },
    rpo: objectiveCheck(measuredRpoSeconds, objectives.rpoSeconds),
    rto: objectiveCheck(measuredRtoSeconds, objectives.rtoSeconds),
  };
  const statuses = Object.values(checks).map((check) => check.status);
  return {
    status: statuses.includes('fail') ? 'fail' : statuses.includes('review') ? 'review' : 'pass',
    checks,
    limitation: 'This verdict covers the supplied disposable restore only; it does not prove provider backup availability or external-effect reconciliation.',
  };
}

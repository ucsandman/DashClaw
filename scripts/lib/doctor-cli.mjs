export function doctorExitCode(result, { strict = false } = {}) {
  if (result?.status === 'unhealthy') return 1;
  if (strict && result?.status !== 'healthy') return 1;
  return 0;
}

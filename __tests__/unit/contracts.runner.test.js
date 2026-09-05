import { describe, expect, it } from 'vitest';
import { runContractsCheck } from '../../scripts/check-contracts.mjs';

describe('runContractsCheck', () => {
  it('fails ci mode when no validators execute and reports processed counts', async () => {
    const result = await runContractsCheck({
      mode: 'ci',
      contracts: {
        index: { validators: {} },
        api: { capabilities: {} },
        schema: {},
        setup: {},
        sdk: {},
      },
      validatorFns: [],
    });

    expect(result.exitCode).toBe(1);
    expect(result.validatorsRun).toBe(0);
    expect(result.contractsProcessed).toBe(1);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'no_validators' }),
    ]);
  });

  it('returns non-zero in ci mode when a validator reports drift', async () => {
    const result = await runContractsCheck({
      mode: 'ci',
      contracts: { index: { validators: {} } },
      validatorFns: [
        async () => ({ ok: false, findings: [{ code: 'drift', message: 'drift detected' }] }),
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it('returns zero in warn mode when validators report findings', async () => {
    const result = await runContractsCheck({
      mode: 'warn',
      contracts: { index: { validators: {} } },
      validatorFns: [
        async () => ({ ok: false, findings: [{ code: 'drift', message: 'drift detected' }] }),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toHaveLength(1);
  });

  it('returns zero when all validators pass', async () => {
    const result = await runContractsCheck({
      mode: 'ci',
      contracts: { index: { validators: {} } },
      validatorFns: [
        async () => ({ ok: true, findings: [] }),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('aggregates findings from multiple validators', async () => {
    const result = await runContractsCheck({
      mode: 'ci',
      contracts: { index: { validators: {} } },
      validatorFns: [
        async () => ({ ok: false, findings: [{ code: 'schema', message: 'schema drift' }] }),
        async () => ({ ok: false, findings: [{ code: 'api', message: 'api drift' }] }),
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.code)).toEqual(['schema', 'api']);
  });
});

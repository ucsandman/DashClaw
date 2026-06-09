import { describe, expect, it } from 'vitest';
import { loadContracts } from '../../scripts/lib/contracts/load-contracts.mjs';
import { checkSetupEnvPrerequisites } from '../../scripts/lib/contracts/check-setup-env-prerequisites.mjs';
import {
  PRODUCTION_REQUIRED_ENV_VARS,
  PRODUCTION_ADVISORY_ENV_VARS,
  READINESS_REQUIRED_ENV_VARS,
  READINESS_ADVISORY_ENV_VARS,
  SELF_HOST_GENERATED_ENV_VARS,
  ENV_CONSTRAINTS,
} from '../../app/lib/setup/runtime-env-prerequisites.mjs';

const VALID_CONSUMERS = {
  startup_validation: "import { ENV_CONSTRAINTS, PRODUCTION_ADVISORY_ENV_VARS, PRODUCTION_REQUIRED_ENV_VARS } from './setup/runtime-env-prerequisites.mjs';",
  readiness_constants: "import { describeEnvVars, READINESS_ADVISORY_ENV_VARS, READINESS_REQUIRED_ENV_VARS } from '../setup/runtime-env-prerequisites.mjs';",
  self_host_init: "import { SELF_HOST_GENERATED_ENV_VARS } from '../app/lib/setup/runtime-env-prerequisites.mjs';",
};

function envExampleFor(keys) {
  return keys.map((key) => `# ${key}=<placeholder>`).join('\n');
}

function envContractFor(runtime) {
  return {
    setup: {
      'runtime-env-prerequisites': {
        owner: 'app/lib/setup/runtime-env-prerequisites.mjs',
        production_required_env: runtime.productionRequiredEnv,
        production_advisory_env: runtime.productionAdvisoryEnv,
        readiness_required_env: runtime.readinessRequiredEnv,
        readiness_advisory_env: runtime.readinessAdvisoryEnv,
        self_host_generated_env: runtime.selfHostGeneratedEnv,
        constraints: runtime.constraints.map(({ key, type, value }) => ({ key, type, value })),
        consumers: {
          startup_validation: 'app/lib/validateEnv.js',
          readiness_constants: 'app/lib/readiness/constants.mjs',
          self_host_init: 'scripts/init-self-host-env.mjs',
        },
      },
    },
  };
}

function matchingRuntime(overrides = {}) {
  return {
    productionRequiredEnv: PRODUCTION_REQUIRED_ENV_VARS,
    productionAdvisoryEnv: PRODUCTION_ADVISORY_ENV_VARS,
    readinessRequiredEnv: READINESS_REQUIRED_ENV_VARS,
    readinessAdvisoryEnv: READINESS_ADVISORY_ENV_VARS,
    selfHostGeneratedEnv: SELF_HOST_GENERATED_ENV_VARS,
    constraints: ENV_CONSTRAINTS,
    consumers: VALID_CONSUMERS,
    envExampleText: envExampleFor([
      ...PRODUCTION_REQUIRED_ENV_VARS,
      ...PRODUCTION_ADVISORY_ENV_VARS,
      ...READINESS_REQUIRED_ENV_VARS,
      ...READINESS_ADVISORY_ENV_VARS,
      ...SELF_HOST_GENERATED_ENV_VARS,
    ]),
    ...overrides,
  };
}

describe('checkSetupEnvPrerequisites', () => {
  it('fails when env prerequisite contracts drift from runtime declarations', async () => {
    const result = await checkSetupEnvPrerequisites({
      setup: {
        'runtime-env-prerequisites': {
          owner: 'app/lib/setup/runtime-env-prerequisites.mjs',
          production_required_env: ['DATABASE_URL'],
          production_advisory_env: ['NEXTAUTH_URL'],
          self_host_generated_env: ['DATABASE_URL'],
          constraints: [{ key: 'ENCRYPTION_KEY', type: 'length', value: 32 }],
          consumers: {
            startup_validation: 'app/lib/validateEnv.js',
            readiness_constants: 'app/lib/readiness/constants.mjs',
            self_host_init: 'scripts/init-self-host-env.mjs',
          },
        },
      },
    }, {
      productionRequiredEnv: ['DATABASE_URL', 'NEXTAUTH_SECRET'],
      productionAdvisoryEnv: ['NEXTAUTH_URL', 'CRON_SECRET'],
      selfHostGeneratedEnv: ['DATABASE_URL', 'NEXTAUTH_SECRET'],
      constraints: [{ key: 'ENCRYPTION_KEY', type: 'length', value: 64 }],
      consumers: {
        startup_validation: '',
        readiness_constants: '',
        self_host_init: '',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.code === 'setup_env_required_contract_drift')).toBe(true);
    expect(result.findings.some((finding) => finding.code === 'setup_env_constraints_contract_drift')).toBe(true);
    expect(result.findings.some((finding) => finding.code === 'setup_env_consumer_not_using_shared_prerequisites')).toBe(true);
  });

  it('fails when a production-relevant env var lacks operator documentation', async () => {
    const planted = 'PHASE3_PLANTED_OPERATOR_ENV';
    const runtime = matchingRuntime({
      productionAdvisoryEnv: [...PRODUCTION_ADVISORY_ENV_VARS, planted],
    });

    const result = await checkSetupEnvPrerequisites(envContractFor(runtime), runtime);

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual({
      code: 'setup_env_operator_doc_missing',
      message: `production-relevant env vars missing from .env.example: ${planted}`,
    });
  });

  it('passes the operator documentation check once the env var has a placeholder', async () => {
    const planted = 'PHASE3_PLANTED_OPERATOR_ENV';
    const runtime = matchingRuntime({
      productionAdvisoryEnv: [...PRODUCTION_ADVISORY_ENV_VARS, planted],
      envExampleText: envExampleFor([
        ...PRODUCTION_REQUIRED_ENV_VARS,
        ...PRODUCTION_ADVISORY_ENV_VARS,
        ...READINESS_REQUIRED_ENV_VARS,
        ...READINESS_ADVISORY_ENV_VARS,
        ...SELF_HOST_GENERATED_ENV_VARS,
        planted,
      ]),
    });

    const result = await checkSetupEnvPrerequisites(envContractFor(runtime), runtime);

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('passes when runtime env prerequisites and consumers match the contract', async () => {
    const contracts = await loadContracts(process.cwd());
    const result = await checkSetupEnvPrerequisites(contracts, {
      productionRequiredEnv: PRODUCTION_REQUIRED_ENV_VARS,
      productionAdvisoryEnv: PRODUCTION_ADVISORY_ENV_VARS,
      readinessRequiredEnv: READINESS_REQUIRED_ENV_VARS,
      readinessAdvisoryEnv: READINESS_ADVISORY_ENV_VARS,
      selfHostGeneratedEnv: SELF_HOST_GENERATED_ENV_VARS,
      constraints: ENV_CONSTRAINTS,
      consumers: VALID_CONSUMERS,
      envExampleText: envExampleFor([
        ...PRODUCTION_REQUIRED_ENV_VARS,
        ...PRODUCTION_ADVISORY_ENV_VARS,
        ...READINESS_REQUIRED_ENV_VARS,
        ...READINESS_ADVISORY_ENV_VARS,
        ...SELF_HOST_GENERATED_ENV_VARS,
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

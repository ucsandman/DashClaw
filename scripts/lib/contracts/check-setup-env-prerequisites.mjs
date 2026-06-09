import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ENV_CONSTRAINTS,
  PRODUCTION_ADVISORY_ENV_VARS,
  PRODUCTION_REQUIRED_ENV_VARS,
  READINESS_ADVISORY_ENV_VARS,
  READINESS_REQUIRED_ENV_VARS,
  SELF_HOST_GENERATED_ENV_VARS,
} from '../../../app/lib/setup/runtime-env-prerequisites.mjs';

const CONSUMER_EXPECTATIONS = {
  startup_validation: [
    './setup/runtime-env-prerequisites.mjs',
    'PRODUCTION_REQUIRED_ENV_VARS',
    'PRODUCTION_ADVISORY_ENV_VARS',
    'ENV_CONSTRAINTS',
  ],
  readiness_constants: [
    '../setup/runtime-env-prerequisites.mjs',
    'READINESS_REQUIRED_ENV_VARS',
    'READINESS_ADVISORY_ENV_VARS',
    'describeEnvVars',
  ],
  self_host_init: [
    '../app/lib/setup/runtime-env-prerequisites.mjs',
    'SELF_HOST_GENERATED_ENV_VARS',
  ],
};

function sameList(left = [], right = []) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeConstraints(items = []) {
  return items.map(({ key, type, value }) => ({ key, type, value }));
}

function parseEnvExampleKeys(text = '') {
  const keys = new Set();
  const regex = /^#?\s*([A-Z][A-Z0-9_]+)=/gm;
  let match;
  while ((match = regex.exec(text)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function uniqueKeys(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

async function loadEnvExampleText(rootDir) {
  try {
    return await readFile(path.join(rootDir, '.env.example'), 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return '';
    throw err;
  }
}

async function loadConsumerSources(rootDir, consumers = {}) {
  const sources = {};
  await Promise.all(Object.entries(consumers).map(async ([name, relativePath]) => {
    const full = path.join(rootDir, relativePath);
    try {
      sources[name] = await readFile(full, 'utf8');
    } catch (err) {
      // TS migration: a .js consumer source may now be .ts (no Node extensionAlias).
      if (err?.code === 'ENOENT' && full.endsWith('.js')) {
        sources[name] = await readFile(full.replace(/\.js$/, '.ts'), 'utf8');
      } else {
        throw err;
      }
    }
  }));
  return sources;
}

export async function checkSetupEnvPrerequisites(contracts, runtimeSetup = null, rootDir = process.cwd()) {
  const findings = [];
  const setupContract = contracts.setup['runtime-env-prerequisites'];
  const runtime = runtimeSetup || {
    productionRequiredEnv: PRODUCTION_REQUIRED_ENV_VARS,
    productionAdvisoryEnv: PRODUCTION_ADVISORY_ENV_VARS,
    readinessRequiredEnv: READINESS_REQUIRED_ENV_VARS,
    readinessAdvisoryEnv: READINESS_ADVISORY_ENV_VARS,
    selfHostGeneratedEnv: SELF_HOST_GENERATED_ENV_VARS,
    constraints: ENV_CONSTRAINTS.map(({ key, type, value }) => ({ key, type, value })),
    consumers: await loadConsumerSources(rootDir, setupContract?.consumers),
    envExampleText: await loadEnvExampleText(rootDir),
  };

  const pairs = [
    ['setup_env_required_contract_drift', setupContract?.production_required_env, runtime.productionRequiredEnv, 'shared production required env inventory does not match contracts/setup/runtime-env-prerequisites.json'],
    ['setup_env_advisory_contract_drift', setupContract?.production_advisory_env, runtime.productionAdvisoryEnv, 'shared production advisory env inventory does not match contracts/setup/runtime-env-prerequisites.json'],
    ['setup_env_readiness_required_contract_drift', setupContract?.readiness_required_env, runtime.readinessRequiredEnv, 'shared readiness required env inventory does not match contracts/setup/runtime-env-prerequisites.json'],
    ['setup_env_readiness_advisory_contract_drift', setupContract?.readiness_advisory_env, runtime.readinessAdvisoryEnv, 'shared readiness advisory env inventory does not match contracts/setup/runtime-env-prerequisites.json'],
    ['setup_env_self_host_contract_drift', setupContract?.self_host_generated_env, runtime.selfHostGeneratedEnv, 'shared self-host generated env inventory does not match contracts/setup/runtime-env-prerequisites.json'],
  ];

  for (const [code, left, right, message] of pairs) {
    if (!sameList(left, right)) {
      findings.push({ code, message });
    }
  }

  if (!sameList(setupContract?.constraints || [], normalizeConstraints(runtime.constraints || []))) {
    findings.push({
      code: 'setup_env_constraints_contract_drift',
      message: 'shared env constraints do not match contracts/setup/runtime-env-prerequisites.json',
    });
  }

  const operatorDocRequired = uniqueKeys(
    runtime.productionRequiredEnv,
    runtime.productionAdvisoryEnv,
    runtime.readinessRequiredEnv,
    runtime.readinessAdvisoryEnv,
    runtime.selfHostGeneratedEnv,
  );
  const envExampleKeys = parseEnvExampleKeys(runtime.envExampleText);
  const missingOperatorDocs = operatorDocRequired.filter((key) => !envExampleKeys.has(key));
  if (missingOperatorDocs.length > 0) {
    findings.push({
      code: 'setup_env_operator_doc_missing',
      message: `production-relevant env vars missing from .env.example: ${missingOperatorDocs.join(', ')}`,
    });
  }

  for (const [consumerName, source] of Object.entries(runtime.consumers || {})) {
    const missingToken = (CONSUMER_EXPECTATIONS[consumerName] || []).find((token) => !source.includes(token));
    if (missingToken) {
      findings.push({
        code: 'setup_env_consumer_not_using_shared_prerequisites',
        message: `${consumerName} is missing shared env prerequisite token ${missingToken}`,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}

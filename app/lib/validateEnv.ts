/**
 * Startup environment variable validation.
 * Import this module early to fail fast on misconfiguration.
 * Only validates in production (NODE_ENV=production).
 */
import { getAuthConfig, getMissingAuthMessage } from './authConfig.mjs';
import {
  ENV_CONSTRAINTS,
  PRODUCTION_ADVISORY_ENV_VARS,
  PRODUCTION_REQUIRED_ENV_VARS,
} from './setup/runtime-env-prerequisites.mjs';

const isProd = process.env.NODE_ENV === 'production';

const warnings: string[] = [];
const errors: string[] = [];

// Required in all modes
if (!process.env.DATABASE_URL) {
  warnings.push('DATABASE_URL is not set - using mock database driver');
}

if (isProd) {
  for (const key of PRODUCTION_REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      if (key === 'ENCRYPTION_KEY') {
        errors.push('ENCRYPTION_KEY must be set in production - sensitive settings cannot be stored securely');
      } else {
        errors.push(`${key} must be set in production`);
      }
    }
  }

  for (const constraint of ENV_CONSTRAINTS) {
    const value = process.env[constraint.key];
    if (constraint.type === 'length' && value && value.length !== constraint.value) {
      errors.push(constraint.message);
    }
  }

  const authConfig = getAuthConfig();
  if (!authConfig.hasAnySignInMethod) {
    warnings.push(getMissingAuthMessage());
  }

  if (process.env.OIDC_CLIENT_ID || process.env.OIDC_CLIENT_SECRET || process.env.OIDC_ISSUER_URL) {
    if (!process.env.OIDC_CLIENT_ID) errors.push('OIDC_CLIENT_ID is required when OIDC is partially configured');
    if (!process.env.OIDC_CLIENT_SECRET) errors.push('OIDC_CLIENT_SECRET is required when OIDC is partially configured');
    if (!process.env.OIDC_ISSUER_URL) errors.push('OIDC_ISSUER_URL is required when OIDC is partially configured');
  }

  const oidcEndpointOverrides = [
    process.env.OIDC_AUTHORIZATION_URL,
    process.env.OIDC_TOKEN_URL,
    process.env.OIDC_USERINFO_URL,
  ].filter(Boolean);
  if (oidcEndpointOverrides.length > 0 && oidcEndpointOverrides.length < 3) {
    warnings.push('Only some OIDC endpoint overrides are set. For Authentik, set all three: OIDC_AUTHORIZATION_URL, OIDC_TOKEN_URL, and OIDC_USERINFO_URL');
  }

  for (const key of PRODUCTION_ADVISORY_ENV_VARS) {
    if (process.env[key]) continue;
    if (key === 'CRON_SECRET') {
      warnings.push('CRON_SECRET is not set - cron endpoints will return 503');
    } else if (key === 'ALLOWED_ORIGIN') {
      warnings.push('ALLOWED_ORIGIN is not set - CORS will block cross-origin API requests');
    } else {
      warnings.push(`${key} is not set`);
    }
  }
}

if (process.env.DISABLE_PROMPT_INJECTION_SCAN === 'true') {
  console.info('[ENV] INFO: Prompt injection scanning is disabled (DISABLE_PROMPT_INJECTION_SCAN=true)');
}

for (const warning of warnings) {
  console.warn(`[ENV] WARNING: ${warning}`);
}

for (const error of errors) {
  console.error(`[ENV] ERROR: ${error}`);
}

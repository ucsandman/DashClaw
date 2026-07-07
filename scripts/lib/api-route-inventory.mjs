import fs from 'node:fs/promises';
import path from 'node:path';

export const API_MATURITY_LEVELS = ['stable', 'beta', 'experimental'];

export const API_MATURITY_RULES = {
  stable: [
    '/api/actions',
    '/api/guard',
    '/api/policies',
    '/api/settings',
    '/api/webhooks',
    '/api/messages',
    '/api/context',
    '/api/handoffs',
    '/api/snippets',
    '/api/memory',
    '/api/keys',
    '/api/orgs',
    '/api/team',
    '/api/invite',
    '/api/usage',
    '/api/health',
  ],
  beta: [
    '/api/auth',
    '/api/onboarding',
    '/api/setup',
    '/api/notifications',
    '/api/activity',
    '/api/cron',
    '/api/docs',
    '/api/security',
  ],
  experimental: [
    '/api/agents',
    '/api/bounties',
    '/api/calendar',
    '/api/content',
    '/api/identities',
    '/api/inspiration',
    '/api/relationships',
    '/api/schedules',
    '/api/swarm',
    '/api/tokens',
    '/api/workflows',
  ],
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

function getApiRoot(rootDir = process.cwd()) {
  return path.join(rootDir, 'app', 'api');
}

function toOpenApiPath(routeFile, apiRoot) {
  const rel = path.relative(apiRoot, path.dirname(routeFile)).replace(/\\/g, '/');
  const raw = rel ? `/api/${rel}` : '/api';
  return raw
    .replace(/\[\.{3}([^\]]+)\]/g, '{$1}')
    .replace(/\[([^\]]+)\]/g, '{$1}');
}

function pathMatchesPrefix(apiPath, prefix) {
  return apiPath === prefix || apiPath.startsWith(`${prefix}/`);
}

function getRuleEntries() {
  const entries = [];
  for (const maturity of API_MATURITY_LEVELS) {
    for (const prefix of API_MATURITY_RULES[maturity] || []) {
      entries.push({ maturity, prefix });
    }
  }
  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  return entries;
}

const RULE_ENTRIES = getRuleEntries();

export function classifyApiPath(apiPath) {
  for (const rule of RULE_ENTRIES) {
    if (pathMatchesPrefix(apiPath, rule.prefix)) {
      return {
        maturity: rule.maturity,
        matchedPrefix: rule.prefix,
      };
    }
  }

  return {
    maturity: 'experimental',
    matchedPrefix: '(default)',
  };
}

function extractMethods(source) {
  const methods = [];
  for (const method of HTTP_METHODS) {
    const pattern = new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`);
    if (pattern.test(source)) methods.push(method);
  }
  return methods;
}

async function walkRouteFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkRouteFiles(full)));
      continue;
    }
    if (entry.isFile() && /^route\.(js|ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

export async function discoverApiRoutes(rootDir = process.cwd()) {
  const apiRoot = getApiRoot(rootDir);
  const files = await walkRouteFiles(apiRoot);
  const routes = [];

  for (const file of files) {
    const apiPath = toOpenApiPath(file, apiRoot);
    const source = await fs.readFile(file, 'utf8');
    const methods = extractMethods(source);
    if (methods.length === 0) continue;

    const classification = classifyApiPath(apiPath);
    routes.push({
      path: apiPath,
      methods: methods.sort(),
      maturity: classification.maturity,
      matched_prefix: classification.matchedPrefix,
      file: path.relative(rootDir, file).replace(/\\/g, '/'),
    });
  }

  // Use simple comparison (not localeCompare) for cross-platform determinism.
  routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return routes;
}

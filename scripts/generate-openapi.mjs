#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverApiRoutes } from './lib/api-route-inventory.mjs';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

export function getOpenApiOutputPath(rootDir = process.cwd()) {
  return path.join(rootDir, 'docs', 'openapi', 'critical-stable.openapi.json');
}

function extractPathParams(openApiPath) {
  const params = [];
  const re = /\{([^}]+)\}/g;
  let match;
  while ((match = re.exec(openApiPath)) !== null) {
    params.push({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: `Path parameter: ${match[1]}`,
    });
  }
  return params;
}

function buildOperation(openApiPath, method, maturity) {
  const tag = (openApiPath.split('/')[2] || 'api').replace(/[^a-zA-Z0-9_-]/g, '');
  const operationId = `${method.toLowerCase()}_${openApiPath
    .replace(/^\/+/, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9/]/g, '')
    .replace(/\//g, '_')}`;

  const operation = {
    operationId,
    tags: [tag],
    summary: `${method} ${openApiPath}`,
    parameters: extractPathParams(openApiPath),
    security: [{ ApiKeyAuth: [] }],
    'x-api-maturity': maturity,
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
      400: { description: 'Validation or request error' },
      401: { description: 'Authentication required' },
      403: { description: 'Forbidden' },
      500: { description: 'Internal server error' },
    },
  };

  if (method === 'POST') {
    operation.responses[201] = { description: 'Created' };
    operation.responses[202] = { description: 'Accepted' };
  }

  if (METHODS_WITH_BODY.has(method)) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    };
  }

  return operation;
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortObjectDeep(value[key]);
    }
    return out;
  }
  return value;
}

export async function generateOpenApiSpec(rootDir = process.cwd()) {
  const routes = await discoverApiRoutes(rootDir);
  const stableRoutes = routes.filter((route) => route.maturity === 'stable');
  const paths = {};

  for (const route of stableRoutes) {
    if (!paths[route.path]) paths[route.path] = {};
    for (const method of route.methods) {
      paths[route.path][method.toLowerCase()] = buildOperation(route.path, method, route.maturity);
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'DashClaw Critical Stable API',
      version: '2.0.0',
      description:
        'Generated OpenAPI spec for critical stable DashClaw endpoints. Source: app/api/**/route.js',
    },
    servers: [{ url: '/' }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
    },
    paths: sortObjectDeep(paths),
  };
}

export function serializeOpenApiSpec(spec) {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export async function writeOpenApiSpec(rootDir = process.cwd()) {
  const spec = await generateOpenApiSpec(rootDir);
  const outputPath = getOpenApiOutputPath(rootDir);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serializeOpenApiSpec(spec), 'utf8');
  return outputPath;
}

async function main() {
  const rootDir = process.cwd();
  const outputPath = await writeOpenApiSpec(rootDir);
  console.log(`OpenAPI spec written to ${path.relative(rootDir, outputPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`OpenAPI generation failed: ${err.message}`);
    process.exitCode = 1;
  });
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('release verification gates', () => {
  it('runs root syntax/type checks and separately packaged CLI/MCP suites in CI', () => {
    const workflow = read('.github/workflows/ci.yml');

    expect(workflow).toContain('run: npm run typecheck');
    expect(workflow).toContain('run: npm run scripts:check-syntax');
    expect(workflow).toContain('run: npm test --prefix cli');
    expect(workflow).toContain('run: npm test --prefix mcp-server');
    expect(workflow).toContain('run: npm run typecheck --prefix mcp-server');
  });

  it('runs separately packaged CLI/MCP suites in the authoritative release check', () => {
    const releaseCheck = read('scripts/check-production-ready.mjs');

    expect(releaseCheck).toContain("['cli-tests', npmCmd, [...npmPrefix, 'test', '--prefix', 'cli']]");
    expect(releaseCheck).toContain("['mcp-tests', npmCmd, [...npmPrefix, 'test', '--prefix', 'mcp-server']]");
    expect(releaseCheck).toContain("['mcp-typecheck', npmCmd, [...npmPrefix, 'run', 'typecheck', '--prefix', 'mcp-server']]");
  });

  it('bounds both Vitest projects to the canonical root test tree', () => {
    const config = read('vitest.config.js');

    expect(config).toContain("const ROOT_TESTS = ['__tests__/**/*.test.{js,jsx,ts,tsx,mjs,cjs}'];");
    expect(config).toContain("include: ROOT_TESTS");
    expect(config).toContain("'plans/**'");
  });

  it('runs the hosted happy path against an isolated Postgres service', () => {
    const workflow = read('.github/workflows/ci.yml');
    const hostedTest = read('__tests__/integration/hosted/end-to-end.test.js');

    expect(workflow).toContain('hosted-integration:');
    expect(workflow).toContain('INTEGRATION_DATABASE_URL: postgresql://');
    expect(workflow).toContain('INTEGRATION_ADMIN_API_KEY:');
    expect(workflow).toContain('HOSTED_DRILL_TOKEN:');
    expect(workflow).toContain('npx vitest run __tests__/integration/hosted/end-to-end.test.js');
    expect(workflow).toContain('__tests__/integration/execution-claims.test.ts');
    expect(hostedTest).toContain("headers: { 'x-api-key': ADMIN_API_KEY }");
    expect(hostedTest).not.toContain('expect([200, 403, 404]).toContain(res.status)');
  });
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Only the tests that touch the DOM run under jsdom. Booting a jsdom window
// per file cost the full suite ~680 s of summed environment time against
// ~37 s of actual test time (measured 2026-09-04, 517 files), and ~450 of
// those files are pure Node (repositories, guard, middleware, scripts). Every
// React component/hook test (.jsx/.tsx) plus the .js/.ts files below that
// reference window/document/localStorage stay on jsdom; everything else runs
// on node. A test that needs the DOM and is not matched here fails with a
// "document is not defined" — add it to DOM_TESTS, or put
// `// @vitest-environment jsdom` at the top of the file.
const DOM_TESTS = [
  '__tests__/**/*.test.{jsx,tsx}',
  '__tests__/unit/artifacts.repository.test.js',
  '__tests__/unit/auth-invite-join.test.js',
  '__tests__/unit/calibration-controller.route.test.ts',
  '__tests__/unit/calibration-mining.test.js',
  '__tests__/unit/cli-openclaw-install.test.js',
  '__tests__/unit/containment-route.test.ts',
  '__tests__/unit/context-menu-resolve.test.ts',
  '__tests__/unit/discord-interactions-route.test.js',
  '__tests__/unit/guard-hotpath.test.js',
  '__tests__/unit/guard-risk-breakdown.test.js',
  '__tests__/unit/measurement-read.test.js',
  '__tests__/unit/no-silent-catch.guard.test.js',
  '__tests__/unit/org-rate-limit.test.js',
  '__tests__/unit/policy-contract.test.ts',
  '__tests__/unit/signal-dismissals.test.js',
  '__tests__/unit/trial-session-middleware.test.js',
  '__tests__/unit/trial-session-routes.test.ts',
  '__tests__/unit/usage-demo-fixture.test.js',
  '__tests__/unit/use-list-controls.test.js',
  '__tests__/unit/use-select-all-hotkey.test.ts',
  '__tests__/unit/use-selection.test.ts',
  '__tests__/unit/widget-pulse.logic.test.js',
];

const ROOT_TESTS = ['__tests__/**/*.test.{js,jsx,ts,tsx,mjs,cjs}'];

// Exclude Playwright specs (tests/) — they use @playwright/test, not vitest.
// Also skip the Playwright defaults, Vitest's own build outputs, and the
// CLI's node:test suite under cli/test/ (run separately by `npm test -w
// @dashclaw/cli` or `cli && npm test`).
const EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/tests/**',
  '**/playwright-report/**',
  '**/test-results/**',
  'cli/test/**',
  // mcp-server's TS package suite runs separately via `cd mcp-server &&
  // npm run verify` (its own vitest); lib/ and dist/ are compiled output.
  'mcp-server/test/**',
  'mcp-server/lib/**',
  'mcp-server/dist/**',
  'plans/**',
  // Git worktrees may hold sibling-branch copies of the test suite with
  // their own divergent state; vitest should never walk into them. Cover
  // both a top-level `.worktrees/` and Claude Code's `.claude/worktrees/`.
  '**/.worktrees/**',
  '**/worktrees/**',
];

export default defineConfig({
  plugins: [react()],
  test: {
    // Project arrays replace (not merge) the root value, so the node project
    // restates EXCLUDE alongside the DOM set it hands to jsdom.
    projects: [
      { extends: true, test: { name: 'dom', environment: 'jsdom', include: DOM_TESTS, exclude: EXCLUDE } },
      { extends: true, test: { name: 'node', environment: 'node', include: ROOT_TESTS, exclude: [...EXCLUDE, ...DOM_TESTS] } },
    ],
    globals: true,
    // Automatically reset env-var mutations between tests so `vi.stubEnv`
    // or direct `process.env.X = ...` writes in one test do not leak into
    // the next. Many existing tests set env vars without a matching
    // afterEach restore — `unstubEnvs: true` provides the guardrail while
    // those test files are gradually migrated to vi.stubEnv.
    unstubEnvs: true,
    // Exclude Playwright specs (tests/) — they use @playwright/test, not vitest.
    // Also skip the Playwright defaults, Vitest's own build outputs, and the
    // CLI's node:test suite under cli/test/ (run separately by `npm test -w
    // @dashclaw/cli` or `cli && npm test`).
    exclude: EXCLUDE,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
      'openclaw/plugin-sdk/plugin-entry': path.resolve(
        __dirname,
        './__tests__/fixtures/openclaw-plugin-entry.js'
      ),
    },
  },
});

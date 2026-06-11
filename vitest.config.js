import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Reset the llm.ts module-level provider cache after every test so a
    // provider key set in one test file can't leak a cached provider into a
    // later file (root cause of the eval full-suite flake). See the setup file.
    setupFiles: ['./__tests__/llm-cache-reset.setup.js'],
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
    exclude: [
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
      // Git worktrees may hold sibling-branch copies of the test suite with
      // their own divergent state; vitest should never walk into them. Cover
      // both a top-level `.worktrees/` and Claude Code's `.claude/worktrees/`.
      '**/.worktrees/**',
      '**/worktrees/**',
    ],
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

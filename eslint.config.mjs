import { defineConfig, globalIgnores } from 'eslint/config'
// Parity with the pre-flat config ({"extends": "next/core-web-vitals"}):
// core-web-vitals only — the eslint-config-next/typescript preset is a new
// (stricter) surface, not something the repo ever gated on.
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // react-hooks v7 compiler-era rules: five of the six formerly-disabled
    // rules were fixed repo-wide and now run at their eslint-config-next
    // defaults (error). The one hold-out is set-state-in-effect — 49
    // pre-existing sites, dominated by the fetch-on-mount setLoading
    // pattern; rewriting them is a dedicated behavior-risking pass, not a
    // lint chore. Scoped to the same files as the config object that
    // defines the react-hooks plugin — an unscoped override also matches
    // *.cjs, where the plugin is absent and any non-'off' severity
    // crashes eslint.
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // eslint 9 reports unused disable directives by default; eslint 8 did
    // not, and the repo's directives predate that change. Parity.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  globalIgnores([
    // eslint 8 ignored dot-directories by default (.claude worktrees,
    // .launch, .gitnexus, ...); eslint 9 flat config does not. Parity.
    '**/.*/**',
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'node_modules/**',
    'dist/**',

    // Test / fuzz reports — bundled third-party minified JS, not our code
    'playwright-report/**',
    'test-results/**',
    '.fuzz-report/**',
    '.hypothesis/**',

    // Graphify generated output — read-only
    'graphify-out/**',

    // mcp-server TS package — linted/verified by its own toolchain
    // (`cd mcp-server && npm run verify`); lib/ is compiled output
    'mcp-server/src/**',
    'mcp-server/test/**',
    'mcp-server/lib/**',
  ]),
])

export default eslintConfig

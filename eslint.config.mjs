import { defineConfig, globalIgnores } from 'eslint/config'
// Parity with the pre-flat config ({"extends": "next/core-web-vitals"}):
// core-web-vitals only — the eslint-config-next/typescript preset is a new
// (stricter) surface, not something the repo ever gated on.
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // react-hooks v7 (pulled in by eslint-config-next 16) ships new
    // compiler-era rules the codebase was never gated on (191 pre-existing
    // sites, dominated by fetch-in-useEffect). Off for parity with the old
    // gate; enabling them is a dedicated pass, not a dependency bump.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
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

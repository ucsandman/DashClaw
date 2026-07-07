/** @type {import('next').NextConfig} */

// Single source of truth for displayed version strings. Each entry derives
// from its package's authoritative manifest so a version bump never requires
// hand-editing UI copy. NEVER hardcode versions in app/ — read from these.
const PYPROJECT_VERSION_RE = /^version\s*=\s*"([^"]+)"/m;
const pyprojectMatch = require('fs')
  .readFileSync(require('path').join(__dirname, 'sdk-python', 'pyproject.toml'), 'utf8')
  .match(PYPROJECT_VERSION_RE);
if (!pyprojectMatch) {
  throw new Error('Could not parse version from sdk-python/pyproject.toml — UI version strings cannot resolve');
}

const { buildSecurityHeaderRules } = require('./app/lib/next-config-headers.cjs');

const nextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: false,
  // Pin the workspace root: a stray package-lock.json one directory up
  // (C:\Projects) otherwise makes Next infer the wrong root and warn on every
  // dev/build run.
  outputFileTracingRoot: __dirname,
  env: {
    // Platform version — surfaced in the Sidebar build stamp.
    NEXT_PUBLIC_DASHCLAW_VERSION: require('./package.json').version,
    // Node SDK published to npm — surfaced in /docs and /downloads install copy.
    NEXT_PUBLIC_SDK_NODE_VERSION: require('./sdk/package.json').version,
    // Python SDK published to PyPI — surfaced in /docs and /downloads install copy.
    NEXT_PUBLIC_SDK_PYTHON_VERSION: pyprojectMatch[1],
    // Plugin bundle manifest version — surfaced in /downloads bundle description.
    NEXT_PUBLIC_PLUGIN_MANIFEST_VERSION: require('./plugins/dashclaw/.claude-plugin/plugin.json').version,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
    ],
  },
  // Security headers — see app/lib/next-config-headers.cjs for the builder
  // (extracted so vitest can test the real function instead of a copy).
  // LAN self-host fix: TLS-conditional CSP + HSTS. Contributed by Lief (RyanTJoy).
  async headers() {
    return buildSecurityHeaderRules();
  },
  // API Rewrites for backward compatibility with older SDKs
  async rewrites() {
    return [
      { source: '/api/actions/:actionId/approve', destination: '/api/approvals/:actionId' },
      { source: '/api/actions/assumptions', destination: '/api/assumptions' },
      { source: '/api/actions/assumptions/:assumptionId', destination: '/api/assumptions/:assumptionId' },
      { source: '/api/actions/signals', destination: '/api/signals' },
      // Standard OIDC-style discovery path for the instance's public signing key
      // (used to re-verify integrity receipts + signed compliance bundles).
      { source: '/.well-known/jwks.json', destination: '/api/integrity/jwks' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata/authorization-server' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/metadata/protected-resource' },
      // Bare /explain serves the static explainer (public/ dirs don't index-resolve on `next dev`).
      { source: '/explain', destination: '/explain/index.html' },
    ];
  },
  // Permanent redirects for retired surfaces.
  // The legacy Python agent-toolkit (/toolkit) has been replaced by the MCP tools
  // surface documented under /docs#mcp-tools (governed-agent MCP tools — handoffs,
  // secret rotation, skill safety, open loops, learning, audit retrospection).
  async redirects() {
    return [
      {
        source: '/toolkit',
        destination: '/docs#mcp-tools',
        permanent: true,
      },
      // Model strategies live under /workflows/strategies (retired /model-strategies
      // path). The retired /labs/branch-finish operator page now points at the
      // decisions ledger. API routes (/api/model-strategies/*) are unchanged.
      { source: '/model-strategies', destination: '/workflows/strategies', permanent: true },
      { source: '/model-strategies/new', destination: '/workflows/strategies/new', permanent: true },
      { source: '/model-strategies/:strategyId', destination: '/workflows/strategies/:strategyId', permanent: true },
      { source: '/labs/branch-finish', destination: '/decisions', permanent: true },
    ];
  },
  // Incremental TypeScript migration: resolve `.js` import specifiers to
  // converted `.ts`/`.tsx` files. tsc (bundler resolution) and vitest already
  // do this; the webpack production build does not by default, so converting a
  // module while its importers keep their `.js` specifiers would 404 the build.
  // Tries TS first, then falls back to the real JS/JSX file (existing imports
  // keep working). Turbopack (dev) prefers TS via resolveExtensions order.
  turbopack: {
    root: __dirname,
    resolveExtensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
}

module.exports = nextConfig

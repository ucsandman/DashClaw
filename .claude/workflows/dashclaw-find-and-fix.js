export const meta = {
  name: 'dashclaw-find-and-fix',
  description: 'Smoke every DashClaw page + run code gates, triage breakage into atomic issues, fix the top ones in parallel worktrees, integrate the green diffs sequentially.',
  whenToUse: 'Recurring quality pass so you stop clicking through the app by hand. Pair with the /dashclaw-quality goal prompt, which boots the dev server, runs frontend-verify for the browser layer, and feeds those findings in via args.browserFindings.',
  phases: [
    { title: 'Discover', detail: 'glob app/**/page.* into routes + confirm dev server' },
    { title: 'Detect', detail: 'HTTP smoke chunks + lint/vitest/build/contract gates in parallel' },
    { title: 'Triage', detail: 'dedup + cluster + rank findings into atomic fixable issues' },
    { title: 'Fix', detail: 'one worktree-isolated agent per issue, verified in isolation' },
    { title: 'Integrate', detail: 'apply green diffs sequentially on the main tree, defer conflicts' },
  ],
}

// ---- structured-output schemas (agents are forced to return these) ----
const DISCOVER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['routes', 'serverUp'],
  properties: {
    routes: { type: 'array', items: { type: 'string' } },
    serverUp: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'severity', 'summary'],
        properties: {
          source: { type: 'string', enum: ['http-smoke', 'lint', 'typecheck', 'vitest', 'build', 'contracts', 'browser'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          summary: { type: 'string' },
          location: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const ISSUES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'severity', 'files', 'fixHint'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          files: { type: 'array', items: { type: 'string' } },
          repro: { type: 'string' },
          fixHint: { type: 'string' },
        },
      },
    },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'diff'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['fixed', 'partial', 'skipped'] },
    diff: { type: 'string' },
    verification: { type: 'string' },
    notes: { type: 'string' },
  },
}

const INTEGRATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['landed', 'deferred'],
  properties: {
    landed: { type: 'array', items: { type: 'string' } },
    deferred: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    finalGate: { type: 'string' },
  },
}

// ---- inputs (passed by /dashclaw-quality via Workflow args) ----
const DEV_URL = (args && args.baseUrl) || 'http://localhost:3000'
const browserFindings = (args && args.browserFindings) || []
// Scale depth to the turn's token target if one was set ("+500k"); sane defaults otherwise.
const TOP_N = budget.total ? Math.max(3, Math.min(12, Math.floor(budget.total / 120000))) : 6
const SMOKE_CHUNKS = budget.total ? Math.max(2, Math.min(6, Math.floor(budget.total / 250000))) : 3

log('Find-and-fix pass - base ' + DEV_URL + ' - top ' + TOP_N + ' issues - ' + browserFindings.length + ' browser findings passed in')

// ===== 1. Discover =====
phase('Discover')
const disc = await agent(
  'You are scoping a DashClaw quality pass. Return JSON only; do NOT edit any files.\n' +
    '1. List every Next.js page route by globbing app/**/page.{js,jsx,ts,tsx}. EXCLUDE app/api/**, anything under an _archive/ segment, and any path containing a dynamic segment (a folder in [brackets]) since those need params and cannot be smoke-tested. Convert each remaining file path to its URL route: strip the leading "app", drop the trailing "/page.*", strip Next route groups (a folder in (parentheses) contributes nothing to the URL), and treat app/page.js as "/". Example: app/(marketing)/spend/code/page.js -> /spend/code.\n' +
    '2. Check whether a dev server answers at ' +
    DEV_URL +
    ' (e.g. curl -s -o /dev/null -w "%{http_code}" ' +
    DEV_URL +
    '). Set serverUp true only if it returns a real HTTP status (not 000 / connection refused). Do NOT start the server yourself - the caller owns its lifecycle.',
  { phase: 'Discover', schema: DISCOVER_SCHEMA, model: 'haiku' },
)

const routes = (disc && disc.routes) || []
if (!disc || !disc.serverUp) {
  log('Dev server not reachable at ' + DEV_URL + ' - running code gates only (HTTP smoke skipped).')
}

// ===== 2. Detect (parallel barrier - need every finding before triage) =====
phase('Detect')
const chunkSize = Math.max(1, Math.ceil(routes.length / SMOKE_CHUNKS))
const routeChunks = []
for (let i = 0; i < routes.length; i += chunkSize) routeChunks.push(routes.slice(i, i + chunkSize))

const detectThunks = []

if (disc && disc.serverUp) {
  // Gated dashboard pages only render without a session when the target server
  // runs in demo mode (DASHCLAW_MODE=demo - e.g. `npm run dev:smoke` on :3099,
  // pointed at via args.baseUrl, the same server playwright.config.js uses).
  // Against a regular dev server the middleware auth gate 307s them to /login -
  // that is intentional behavior (middleware.js handlePageRequest), not breakage.
  routeChunks.forEach((chunk, i) => {
    detectThunks.push(() =>
      agent(
        'HTTP-smoke these DashClaw routes against ' +
          DEV_URL +
          ': ' +
          chunk.join(', ') +
          '.\nFor each route: request the full URL sending the demo-mode cookie (e.g. curl -s -H "Cookie: dashclaw_demo=1" ...), mirroring playwright.config.js storageState so gated pages render when the target server runs in demo mode. Record the status code and inspect the start of the HTML body. Report a finding (source "http-smoke", location = the route) when: status is >= 500; the page returns a Next.js error overlay, "Application error", "Internal Server Error", an unhandled exception or a stack trace; or the route 404s even though a page file exists. A 200 that renders is NOT a finding. EXPECTED-SKIP - do NOT report these as findings at any severity, they are intentional behavior: a 307/302 redirect to /login (the middleware auth gate when smoking without a session); /demo redirecting to /#live-demo (the intentional demo entrypoint); a redirect to /setup or /connect (onboarding gates). Return JSON findings; empty array if all clean. Do not edit files.',
        { label: 'smoke:' + (i + 1) + '/' + routeChunks.length, phase: 'Detect', schema: FINDINGS_SCHEMA, model: 'haiku' },
      ),
    )
  })
}

// Each code gate is its own agent so they run concurrently. Build uses the webpack script, NOT `npx next build`.
const GATES = [
  { key: 'lint', src: 'lint', cmd: 'npm run lint' },
  { key: 'typecheck', src: 'typecheck', cmd: 'npm run typecheck' },
  { key: 'vitest', src: 'vitest', cmd: 'npx vitest run' },
  { key: 'build', src: 'build', cmd: 'npm run build' },
  {
    key: 'contracts',
    src: 'contracts',
    cmd: 'npm run openapi:check, then npm run api:inventory:check, then npm run route-sql:check, then npm run version:check, then npm run docs:check (run each one separately and report EVERY failure, not just the first)',
  },
]
GATES.forEach((g) => {
  detectThunks.push(() =>
    agent(
      'Run the DashClaw ' +
        g.key +
        ' gate from the repo root and READ the output: ' +
        g.cmd +
        '.\nPipe noisy output to a file and read only the failing lines if it is large. Report each distinct failure as a finding (source "' +
        g.src +
        '", location = the file:line or check name, evidence = the error message). If it passes clean, return an empty findings array. Do NOT fix anything and do NOT edit files - this is detection only.',
      { label: 'gate:' + g.key, phase: 'Detect', schema: FINDINGS_SCHEMA, model: 'haiku' },
    ),
  )
})

const detectResults = (await parallel(detectThunks)).filter(Boolean)
const allFindings = browserFindings.concat(detectResults.flatMap((r) => r.findings || []))
log('Detected ' + allFindings.length + ' raw findings (' + browserFindings.length + ' browser + ' + (allFindings.length - browserFindings.length) + ' smoke/gate).')

if (allFindings.length === 0) {
  log('Clean pass - nothing to fix.')
  return { routesChecked: routes.length, issuesFound: 0, landed: [], deferred: [], stillBroken: [] }
}

// ===== 3. Triage =====
phase('Triage')
const triage = await agent(
  'You are triaging DashClaw quality findings into an actionable fix plan. Findings (JSON): ' +
    JSON.stringify(allFindings) +
    '\nOne root cause often appears as several findings (a 500 in http-smoke + a console error in browser + a failing test). Dedup them. Cluster into ATOMIC issues, each fixable independently in one small change. Rank by severity: critical = app/route down or build fails; high = a feature broken or a test failing; medium = console error or visual breakage; low = cosmetic or expected auth/setup gating. For each issue give a stable kebab-case id, the files most likely involved (read the repo to confirm, do not guess), a one-line repro, and a concrete fixHint. Respect the DashClaw governance boundary: never propose extending app/api/_archive/** or adding agent-platform features. Return at most ' +
    TOP_N +
    ' issues, highest severity first.',
  { phase: 'Triage', schema: ISSUES_SCHEMA, model: 'sonnet' },
)
const issues = (triage && triage.issues) || []
if (issues.length === 0) {
  log('Triage produced no actionable issues.')
  return { routesChecked: routes.length, issuesFound: 0, landed: [], deferred: [], stillBroken: [] }
}
log('Triaged to ' + issues.length + ' fixable issues.')

// ===== 4. Fix (parallel, each in its own worktree so concurrent edits cannot collide) =====
phase('Fix')
const GUARDRAILS =
  'DashClaw guardrails (non-negotiable): make the SMALLEST change that fixes this issue and touch only what it needs; match existing style. No direct SQL in app/api/**/route.js - go through app/lib/repositories/*.repository.js. Never hardcode a version number (injected via next.config.js) or a hex color (use the CSS tokens in app/globals.css). Do not extend app/api/_archive/**. If you change schema/ or drizzle/, say so loudly in notes (a db:migrate will be needed). Build with: npm run build (webpack), NOT npx next build. A fresh worktree checks out CRLF, so a handful of line-ending-only test failures unrelated to your change are expected - note them and proceed; integration re-verifies on the main tree (LF), which is authoritative.'

const fixed = (
  await parallel(
    issues.map((issue) => () =>
      agent(
        'Fix this DashClaw issue, then verify it in isolation.\nIssue (JSON): ' +
          JSON.stringify(issue) +
          '\nApproach: reproduce it first; where practical write or extend a test that fails because of the bug, then make it pass (TDD); make the minimal fix; run the cheapest check that PROVES it (the specific test file, or npm run lint, or request the route at ' +
          DEV_URL +
          ' if a dev server is up). ' +
          GUARDRAILS +
          '\nReturn JSON: status (fixed | partial | skipped); diff = the unified diff of your change from "git --no-pager diff" (empty string if skipped); verification = exactly what you ran and its result; notes. If you cannot fix it safely, return status "skipped" with an empty diff and the reason in notes.',
        { label: 'fix:' + issue.id, phase: 'Fix', isolation: 'worktree', schema: FIX_SCHEMA, model: 'sonnet' },
      ),
    ),
  )
).filter(Boolean)

const applicable = fixed.filter((f) => f.status !== 'skipped' && f.diff && f.diff.trim())
log(applicable.length + '/' + issues.length + ' issues produced a candidate fix.')

if (applicable.length === 0) {
  const stillBroken = issues.map((i) => ({ id: i.id, title: i.title, severity: i.severity }))
  return { routesChecked: routes.length, issuesFound: issues.length, landed: [], deferred: [], stillBroken }
}

// ===== 5. Integrate (sequential on the real working tree - parallel diffs cannot corrupt each other) =====
phase('Integrate')
const integrate = await agent(
  'Integrate these verified candidate fixes into the main working tree, one at a time, keeping ONLY what stays green. Candidates (JSON, each has id + a unified diff): ' +
    JSON.stringify(applicable.map((f) => ({ id: f.id, diff: f.diff, verification: f.verification }))) +
    '\nProcess them in severity order. For each: apply the diff with "git apply" (or re-create the edit by hand if the patch no longer applies cleanly against current state). After applying, run the cheapest check that proves it did not break anything - always npm run lint, plus the relevant test file, plus npm run build for any app/** change. If it applies clean and the check passes, KEEP it and add its id to landed. If it conflicts or regresses, revert just that change ("git checkout -- <files>") and add it to deferred with the reason. Do NOT git commit - leave the landed changes in the working tree for the operator to review and ship. Finally run npm run lint once more and report it as finalGate. Return JSON {landed, deferred, finalGate}.',
  { phase: 'Integrate', schema: INTEGRATE_SCHEMA, model: 'sonnet' },
)

const landed = (integrate && integrate.landed) || []
const deferred = (integrate && integrate.deferred) || []
const stillBroken = issues
  .filter((i) => !landed.includes(i.id))
  .map((i) => ({ id: i.id, title: i.title, severity: i.severity }))

log('Landed ' + landed.length + ' - deferred ' + deferred.length + ' - still broken ' + stillBroken.length)

return {
  routesChecked: routes.length,
  issuesFound: issues.length,
  landed,
  deferred,
  stillBroken,
  finalGate: integrate && integrate.finalGate,
}

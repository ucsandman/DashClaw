export const meta = {
  name: 'dashclaw-preship-sweep',
  description: 'Pre-ship go/no-go: run the verification gates, the drift/count audit, and a DashClaw-stack security review in parallel, then synthesize one BLOCK/PASS verdict. Roster = the project-pinned subagents (gate-runner=haiku, drift-auditor=sonnet, security-reviewer=opus) so the cheap work runs cheap and Opus is reserved for the security pass + synthesis.',
  whenToUse: 'Run right before `dashclaw-ship` (or before pushing to main). It replaces the manual "lint+vitest+build, then check the counts, then eyeball security" sequence with three parallel specialists and a single verdict. Pass the changed-files summary or diff scope via args.scope to focus the security + drift passes. Entry-path drill precondition (v8.3): a diff touching cli/**, scripts/setup.mjs, or the up path needs a green `npm run drill:fresh-windows` (or drill:fresh-linux) first; one touching hosted mint/export/import needs `npm run drill:hosted` — see scripts/drills/README.md.',
  phases: [
    { title: 'Sweep', detail: 'gate-runner + drift-auditor + security-reviewer in parallel' },
    { title: 'Synthesize', detail: 'combine into one go/no-go verdict' },
  ],
}

const scope = (args && args.scope) ? String(args.scope) : 'the pending changes on the current branch (use git diff/status to find them)'

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['result'],
  properties: {
    result: { type: 'string', enum: ['PASS', 'FAIL'] },
    lint: { type: 'string' }, vitest: { type: 'string' }, build: { type: 'string' }, contracts: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const DRIFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['result'],
  properties: {
    result: { type: 'string', enum: ['CLEAN', 'DRIFT'] },
    liveTruth: { type: 'string' },
    drift: { type: 'array', items: { type: 'string' } },
  },
}

const SEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'BLOCK'] },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'title'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string' }, location: { type: 'string' }, fix: { type: 'string' },
        },
      },
    },
  },
}

phase('Sweep')
// Barrier is correct here: the go/no-go needs all three results together.
const [gate, drift, sec] = await parallel([
  () => agent(
    'Run the DashClaw verification gates (lint, full vitest, webpack build, and the contract checks since changes may touch routes/SDK/schema) and report only failures.',
    { agentType: 'dashclaw-gate-runner', label: 'gates', phase: 'Sweep', schema: GATE_SCHEMA },
  ),
  () => agent(
    `Audit the drift-prone counts and the unified version against live truth. Scope of change: ${scope}.`,
    { agentType: 'dashclaw-drift-auditor', label: 'drift', phase: 'Sweep', schema: DRIFT_SCHEMA },
  ),
  () => agent(
    `Security-review ${scope}. Focus on the DashClaw auth / API-key / x402 / webhook / repository-SQL / secrets surface.`,
    { agentType: 'dashclaw-security-reviewer', label: 'security', phase: 'Sweep', schema: SEC_SCHEMA },
  ),
])

phase('Synthesize')
const blockers = []
if (!gate || gate.result !== 'PASS') blockers.push(`GATES FAIL: ${gate ? (gate.failures || []).join('; ') : 'gate-runner did not return'}`)
if (drift && drift.result === 'DRIFT') blockers.push(`COUNT DRIFT: ${(drift.drift || []).join('; ')}`)
const sevBlock = sec ? (sec.findings || []).filter(f => f.severity === 'critical' || f.severity === 'high') : []
if (!sec || sec.verdict === 'BLOCK' || sevBlock.length) {
  blockers.push(`SECURITY BLOCK: ${sevBlock.map(f => `[${f.severity}] ${f.title} (${f.location || '?'})`).join('; ') || 'review did not pass'}`)
}

const verdict = blockers.length ? 'NO-GO' : 'GO'
log(`Pre-ship verdict: ${verdict}${blockers.length ? ` (${blockers.length} blocker${blockers.length > 1 ? 's' : ''})` : ''}`)

return {
  verdict,
  blockers,
  gate,
  drift,
  security: sec,
}

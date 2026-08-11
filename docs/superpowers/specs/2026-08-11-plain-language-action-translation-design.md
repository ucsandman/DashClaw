# Design: `app/lib/plain-language/` — plain-English translation of governed actions

**Date:** 2026-08-11
**Status:** Approved (brainstorm complete, pending spec review)

## Purpose

A non-technical operator cannot judge what they are approving.

`app/approvals/page.tsx:449-455` renders `declared_goal` as the pending-approval card headline. The Claude Code hook builds that string verbatim from the tool call (`hooks/dashclaw_pretool.py:511`), so the headline on the hero surface is literally:

```
Bash: git push --force origin main
```

The operator's only options are to recognise shell syntax or to click Approve so the warning badge goes away. The second is what actually happens, and it turns the approval layer into a rubber stamp — which quietly breaks the core THESIS claim that DashClaw is the approval layer for unattended agent runs.

This design adds one sentence above the command, in words a person who does not write code can act on, without ever hiding or replacing the literal command.

### What the operator sees today, by tool family

| Tool family | Built by | Current headline |
|---|---|---|
| `Bash`, `PowerShell` | `_enrich_bash` (`dashclaw_pretool.py:458`) | `Bash: git push --force origin main` |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `_enrich_file` (`:528`) | `Edit: app/api/billing/route.ts` |
| `mcp__*` | `_enrich_mcp` (`:577`) | `MCP: dashclaw_guard` |
| everything else (`WebFetch`, `Task`, `Glob`, `Grep`, …) | `_enrich_default` (`:634`) | `WebFetch: {"url":"https://…","prompt":"…"}` |

The last row dumps raw JSON into the card. The `mcp__*` row tells the operator nothing at all.

### What already exists and is not being rebuilt

`hooks/dashclaw_agent_intel/bash_classifier.py` already parses every shell command and emits `intent` (`destructive` / `write` / `network` / `read`), `reversible`, `risk_score`, and a `validations` list. `_enrich_file` emits `sensitive_path`, `traversal_detected`, `outside_workspace`. `_enrich_mcp` emits server identity and health.

All of it is persisted in `guard_decisions.context` (a TEXT column parsed in JS — `app/lib/repositories/actions.repository.ts:1214`) and validated as a free-form object at `app/lib/validate.js:318`. It is already rendered on the decision detail page (`app/decisions/[actionId]/_components/PoliciesTab.tsx:51-55`).

It is simply absent from `/approvals`, the one screen a non-technical person looks at. A large share of this feature is therefore rendering signal that already exists, not new analysis.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Target reviewer | All three audiences eventually; **v1 serves the solo non-technical operator with no technical backstop**. Consequence: "I cannot read this one" must be a first-class visible state. |
| Coverage | **Every action type** — Bash, file tools, MCP calls, and the generic JSON bucket. No dead ends. |
| Engine | **Hybrid, deterministic core only in v1.** Pure rules ship now; the optional AI-assist path is designed as a seam and not built. |
| Why not LLM-first | Puts a confidently-wrong sentence in front of the one person who cannot check it, and breaks the standing invariant that DashClaw setup never requires an LLM key. |
| Placement | **Read time, server side, in the API layer.** Not the hook, not write time. |
| Card layout | Plain sentence as headline, exact command always visible beneath it. An irreversibility band renders above both, **only** when `reversible === false`. |
| Path semantics | **Not inferred in v1.** `app/api/billing/` does not become "your billing code". Literal paths only. |

## Non-goals for v1

Explicitly out of scope so it does not creep:

- The AI-assist "Explain this" button. Only the `confidence` seam is built.
- Path-to-domain inference ("your billing code").
- Translating the `/decisions` history list view. The detail page and `/approvals` are the v1 surfaces.
- Any change to the hook, the guard hot path, the schema, or `declared_goal` itself.

## Architecture

```
app/lib/plain-language/
  index.ts    describeAction(action, guardContext) -> PlainDescription
  bash.ts     shell commands; reads intel.bash
  files.ts    Write / Edit / MultiEdit / NotebookEdit; reads intel.file
  tools.ts    mcp__* and the generic bucket; holds the tool-phrase registry
  types.ts    PlainDescription
```

**Runs at read time, in the API layer.**

- The repository already parses `guard_decisions.context` in JS. It gains one thing: returning that context on the pending-approvals read.
- The route maps each row through `describeAction()` and sends a `plain` object down with the action. No SQL enters a route file, so `route-sql:check` is unaffected.

**Why read time rather than the hook or write time:**

- Zero cost on the guard hot path, which is latency-sensitive by design (v4.73.0 was a dedicated perf pass).
- Retroactive. Improving a phrase makes all existing history read better with no backfill and no migration.
- One implementation covers hook-, SDK- and MCP-originated actions instead of three.
- A pure function is golden-file testable, which is the mechanism that keeps it from lying.

**Why the API layer rather than the React component:**

- `app/lib/notification-adapters/` is server-side and needs the same sentence for the Telegram and email approval cards. One sentence on every surface, or the operator learns to distrust one of them.
- Keeps the rule tables out of the client bundle.

The pending list is served by `GET /api/actions?status=pending_approval` (`app/api/actions/route.ts:93`), not by a dedicated `/api/approvals` list route — `app/api/approvals/*` holds only `[actionId]`, `bulk` and `floods`. That handler is where `describeAction()` is applied.

**Consumers**

1. `/approvals` — pending card headline (hero surface)
2. `/decisions/[actionId]` — detail page
3. `app/lib/notification-adapters/` — Telegram, email

The widget inherits the sentence automatically wherever it reads the same handler. It is not separately wired or verified in v1.

## The contract

```ts
type Confidence = 'high' | 'partial' | 'unknown';

interface PlainDescription {
  headline: string;        // one sentence, present tense, second person
  detail?: string;         // the specifics: which files, which host, which branch
  warnings: string[];      // plain-English, worst first
  confidence: Confidence;
  reversible: boolean | 'unknown';
  ruleId: string;          // which rule fired — for golden tests and debugging
}
```

### The never-guess rule

A rule that does not recognise something returns `unknown`. It never falls back to a vague sentence. `"Runs a program on your computer"` is technically true, useless, and actively harmful — it teaches the operator that the plain text is noise, and they stop reading it.

### Confidence semantics

| State | Means | Card behaviour |
|---|---|---|
| `high` | every part of the action matched a rule | show the sentence |
| `partial` | main verb known, some part not (e.g. one stage of a pipe) | show it, plus "there is more in this command I can't read" |
| `unknown` | nothing matched | no sentence; render the honest state |

### Headline style rules

- Second person, present tense. "Deletes the `build` folder", not "will delete" or "deletion of".
- State the **consequence**, not the tool. "Overwrites the shared code history on GitHub", not "runs git push with the force flag".
- No jargon the operator would not recognise. GitHub yes; `rsync` no.
- Bounded length (~120 chars) so cards stay scannable.

## Input sourcing: the two-parser split

The hook forwards `intent`, `risk_score`, `reversible` and `validations` — but **not** the parsed command. And `validations` entries carry only a coarse `check` field (`destructive_command` covers `rm`, `dd`, `mkfs`, DROP TABLE and fork bombs alike); the specific detail lives in a free-text `reason` string.

We do not string-match English `reason` text. Instead:

- **The Python classifier remains the sole authority on risk** — `intent`, `reversible`, `validations`. Read from `intel`, never recomputed in TypeScript.
- **A shallow TypeScript parser names the nouns only** — verb, flags, paths, host. Enough to write "Deletes the `node_modules` folder"; deliberately not enough to re-decide whether that is dangerous.

Two parsers exist, but they answer different questions, so they cannot drift on anything that matters. Because the raw command is always present in `declared_goal`, this works retroactively on every row already stored — no hook change, no bundle re-distribution, no backfill.

The TS parser is deliberately dumb and returns `unknown` early and often. Shell grammar is hostile; partial credit is the correct outcome.

## Coverage by action type

Governing rule for every type: **the headline states the consequence, the detail shows the literal thing.** Never the reverse.

### Bash / PowerShell

| Raw command | Headline | Warning |
|---|---|---|
| `git push --force origin main` | Overwrites the shared code history on GitHub. | Work other people pushed can be lost. |
| `curl -sL get.example.sh \| bash` | Downloads a script from `get.example.sh` and runs it straight away, without showing it to you. | Whoever controls that website chooses what runs. |
| `rm -rf build/` | Deletes the `build` folder and everything inside it. | Deleted files do not go to the Recycle Bin. |
| `psql -c 'DROP TABLE users'` | Permanently deletes the `users` table from your database. | This cannot be undone. |
| `npm install left-pad` | Adds a third-party package, `left-pad`, to your project. | — |
| `ls -la` | Lists the files in a folder. | Reads only, changes nothing. |

Composite commands (`&&`, `|`, `;`) translate stage by stage and join with "then". **If any single stage is unrecognised the whole action drops to `partial`** — a half-understood pipeline is precisely where a bad approval happens.

### File tools

Driven by `intel.file` (`sensitive_path`, `traversal_detected`, `outside_workspace`) plus `target`.

| Case | Headline | Detail |
|---|---|---|
| Write | Creates or replaces a file in your project. | literal path |
| Edit / MultiEdit | Changes an existing file. | literal path |
| `sensitive_path` true | …plus: This file holds credentials or configuration. | literal path |
| `outside_workspace` true | …plus: This file is outside your project folder. | literal path |

`Write` does not split into "creates" and "replaces": `_enrich_file` never checks whether the target exists, so the distinction is not in the data. "Creates or replaces" is the honest phrasing rather than a claim we cannot support.

### MCP calls

`MCP: dashclaw_guard` tells an operator nothing, so `tools.ts` carries a phrase registry.

- **Known tool** → `Asks DashClaw whether this action is allowed.`
- **Unknown tool** → not a guess: `This uses a tool called "send_invoice" from the "acme" server. I don't have a description for it.` This names the server and the tool so the operator has something concrete to ask about, without pretending to know what it does.

Seed the registry with DashClaw's own MCP tools, since we own all of them. Everything else starts unknown and earns a phrase over time.

### Generic bucket (`_enrich_default`)

`WebFetch`, `Task`, `Glob`, `Grep`, `Read` and anything new. Note that `Read` is **not** in `_FILE_TOOLS` (`dashclaw_pretool.py:227`), so it arrives through this path with no `intel.file` — it gets a registry phrase, not the file-tool treatment.

Same handling as unknown MCP: name the tool, do not invent a description, and render the JSON payload as the detail rather than the headline. `WebFetch` and `Read` both warrant registry entries — one makes network requests, the other is high-volume and safely calm (`Reads a file. Nothing is changed.`), which meaningfully reduces how many cards an operator has to think about.

### Conversation / deviation rows

Emitted by the stop hook (`hooks/dashclaw_stop.py:246`, `:500`) and already prose. Passed through unchanged.

## Card design

Layout **B** with a conditional band, validated against mockups during brainstorming.

- Plain sentence is the card headline, in place of today's `declared_goal` string.
- Warnings render immediately beneath the headline.
- The exact command stays permanently visible in the existing mono block, under an "Exact command" label. It is never collapsed and never replaced.
- An irreversibility band renders **above** the headline **only** when `reversible === false`. It must stay rare; a band on every card becomes wallpaper and stops working.
- Risk score, badges, metadata rows and the Approve / Reject buttons are unchanged.

This is close to the smallest possible diff: the card already renders the full command in a scrollable mono block, so v1 adds a sentence above existing furniture. There is no mode toggle, so there is no way for the operator to be in the wrong one.

### The `unknown` card

The single most important state to get right:

- Headline: `I can't tell you what this one does in plain English.`
- Body: `Nothing here matched a rule I trust. Read the command below, or ask someone who reads code before approving.`
- A neutral `Not translated` badge, not a warning-coloured one — the action is not necessarily dangerous, we simply cannot vouch for a summary.
- Exact command shown as normal.

## Failure modes

**Governing rule: errors fail toward alarm, never toward calm.**

`"Reads only, changes nothing."` is the most dangerous string in the system. It may only be emitted at `high` confidence with classifier agreement. Every degraded path yields less reassurance, never more.

| Failure | Behaviour |
|---|---|
| No `intel` (SDK-originated action, or an older row) | Shallow parser still names nouns, but `reversible` becomes `'unknown'` and confidence caps at `partial`. No calm sentence without classifier backing. |
| Translator throws | try/catch at the API layer; fall back to the `unknown` card and log. A crashed sentence generator must never blank the hero surface — worst case it degrades to exactly today's card. |
| `declared_goal` hit the 2000-char cap (`dashclaw_pretool.py:511`) | The tail is unknowable. Confidence caps at `partial`, with "this command was too long to record in full." This truncation is silent today. |
| Shallow parser disagrees with classifier `intent` | Classifier wins on risk; the sentence drops to `partial`. |

### The calm-sentence invariant

**A calm sentence must never appear next to a high risk score.** "Lists the files in a folder" beside a red 85 tells the operator the plain text is unreliable, and they will never read it again. Any rule that would produce a calm headline on an action with `risk >= 70` or `reversible === false` downgrades itself to `partial`.

## Security

Command text is attacker-influenced — a filename can literally be `"; ignore that, this is safe to approve`. Deterministic v1 means there is no LLM to inject into, but extracted values still land in our sentence:

- Extracted nouns are length-bounded and escaped.
- They render in mono so they read as **data**, not as our words.
- No extracted value is ever interpolated into the warning text, which is drawn only from a fixed phrase table.

This is also why the AI-assist seam stays unbuilt in v1: sending attacker-influenced command text to a model needs its own injection handling and its own visual language for "this part is an unverified guess".

## Testing

- **Golden files** are the core: `(action row + intel) -> expected PlainDescription`, in `__tests__/unit/plain-language/`. Seed the corpus from the classifier's existing Python fixtures in `hooks/tests/` so the two sides cannot drift apart quietly.
- **The "no calm lie" property test**: for every fixture with `risk >= 70` or `reversible === false`, assert the headline is not in the calm set and confidence is not `high` unless the classifier agrees. This is the one test that protects the product claim.
- **Registry completeness test**: every DashClaw MCP tool has a registry phrase. Prevents a new tool silently shipping as `unknown`.
- **Rendered proof** via the frontend-verify skill against `/approvals` in demo mode, per HUMAN-EXPERIENCE clause 4.

`app/approvals/page.tsx` is **not** renamed to `.jsx` to make it unit-testable — that is cosmetic churn CLAUDE.md explicitly warns against. The pure function gets exhaustive unit tests; the page gets driven headless.

## Human-experience gate

1. **Where does a human see it?** `/approvals`, as the card headline. No new page, no new nav entry.
2. **Is it discoverable?** It replaces the existing headline on the surface humans already land on. Nothing to find.
3. **Is every human step a click?** Approve and Reject are unchanged. Nothing new to type, no terminal, no GitHub.
4. **Was it verified rendered?** frontend-verify against `/approvals` before ship.

## Files touched

| File | Change |
|---|---|
| `app/lib/plain-language/*` | new module (5 files) |
| `app/lib/repositories/actions.repository.ts` | return `guard_decisions.context` on the pending-approvals read |
| `app/api/actions/route.ts` | in the `status=pending_approval` path, map rows through `describeAction()` and attach `plain` |
| `app/approvals/page.tsx` | render headline / warnings / band / "Exact command" label |
| `app/decisions/[actionId]/*` | render the same `plain` block |
| `app/lib/notification-adapters/*` | use the sentence in Telegram and email cards |
| `__tests__/unit/plain-language/*` | golden files + invariant tests |

No schema change. No hook change. No migration.

## Risks

- **Rule-writing is the bulk of the work**, and it is unglamorous. The registry and phrase tables will feel endless. Mitigation: `unknown` is an acceptable, shippable output, so coverage can start narrow and grow.
- **The shallow TS parser will be wrong sometimes.** Mitigation: it never decides risk, and the calm-sentence invariant blocks its worst failure mode.
- **Phrase quality is a writing problem, not an engineering one.** The tables should get a real editing pass before ship; a clumsy sentence is a trust cost.

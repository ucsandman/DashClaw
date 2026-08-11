# `dashclaw install openclaw` — design

**Date:** 2026-08-11 · **Status:** Approved by owner (Wes) in-session · **Ships as:** third install target in the DashClaw CLI, plus a `/guides/openclaw` page

## Why

`dashclaw install` supports `claude` and `codex`. There is no OpenClaw target,
so OpenClaw users run `dashclaw install codex` — and get a governance protocol
describing machinery OpenClaw does not have.

The failure is concrete and was observed in production on 2026-08-10. The codex
installer resolves its AGENTS.md target as:

```js
const agentsMdPath = join(projectDir, 'AGENTS.md');   // cli/lib/codex/install.js
```

`projectDir` defaults to the cwd. Run from an OpenClaw workspace, it writes a
Codex protocol into the OpenClaw agent's bootstrap file. That protocol
instructs the agent to call `dashclaw_session_start` and `dashclaw_guard`
"via the `dashclaw` MCP server" and references a `PreToolUse` hook installed by
`dashclaw install codex`.

None of that exists under OpenClaw. OpenClaw governance is the
`@dashclaw/openclaw-plugin` package, which intercepts `before_tool_call`
automatically. `mcp.servers` was empty on both audited machines; the MCP server
the block names had never been wired anywhere.

Consequence: the agent (Forge) read its own protocol literally, could not reach
the required MCP tools, and fail-closed — refusing to work while its governance
was in fact fully operational (814 recorded decisions). An agent was blocked by
a document, not by a policy.

## What it does

One command wires DashClaw governance into an OpenClaw install correctly:

```
dashclaw install openclaw
```

Unlike `installCodex` it takes **no `repoRoot`** — the plugin resolves from npm
— so it works for users who installed the CLI and never cloned DashClaw.

## Approach: hybrid, split by risk

`openclaw.json` is strictly validated at gateway startup; an invalid write does
not fail loudly, it boots and later crash-loops (observed: a `--strict-json`
planted key booted fine on 2026-06-05 and went fatal on 2026-07-09). A DashClaw
installer must not be able to do that to someone.

So the schema-shaped risk goes to the tool that owns the schema, and everything
else stays a pure, testable function:

| Artifact | Method | Rationale |
|---|---|---|
| `openclaw.json` | `openclaw config patch` | One validated write, recursive merge |
| Plugin lifecycle | `openclaw plugins install` / `enable` | Accepts npm specs; don't reinvent resolution |
| `.env` beside `openclaw.json` | direct write | Plain `KEY=value`; we own the format, and the path follows `--profile` |
| `AGENTS.md` block | direct write | Reuse `replaceManagedBlock` from the codex installer |
| Verification | `openclaw config validate` + `plugins doctor` | Prove it worked |

If `openclaw` is not on PATH the installer stops with an install hint rather
than writing a config it cannot validate.

## Secret handling

The API key goes to the `.env` beside `openclaw.json` as `DASHCLAW_API_KEY`, **not** into
`openclaw.json`. This matches the plugin's own documented recommendation
("environment variables — recommended when secrets live outside the gateway
config"), and `.env` already carries `OPENAI_API_KEY` and `GEMINI_API_KEY`, so
it is an established path rather than a new mechanism.

`--write-config` forces the legacy in-config behaviour for anyone who wants it.

Installing over an existing plaintext `dashclawApiKey` migrates it to `.env`
and removes it from the config, so `openclaw secrets audit` comes back clean.

That last clause is the reason the `openclaw.json` backup is **scrubbed** of
that one field rather than copied byte for byte: a verbatim backup of a config
that still held the key would leave the secret sitting in a second file on the
same disk, so the audit would not come back clean and the "removed the
plaintext key" line would be pointing the operator at a copy of it. Only
`dashclawApiKey` is emptied; everything else survives, so the backup is still a
usable restore point — and by the time it is written the key is already in
`.env`. A `.dashclaw-bak` an earlier `--write-config` run left behind is
scrubbed on the same pass, since the first backup is the one that is kept.

## Components

`cli/lib/openclaw/install.js`, mirroring the existing installers: pure exported
builders plus one async orchestrator.

| Function | Purpose | Pure |
|---|---|---|
| `openclawBin(env)` | Resolve the executable, or `--openclaw-bin` | yes |
| `runOpenclaw(args)` | Subprocess wrapper → `{ok, stdout, stderr}` | no |
| `resolveConfigPath()` | `openclaw config file` | no |
| `resolveWorkspace()` | `openclaw config get agents.defaults.workspace` | no |
| `buildPluginConfigPatch({...})` | JSON5 object for `config patch` | yes |
| `upsertEnvVar(path, key, value)` | `.env` merge; replace in place, never duplicate | yes |
| `buildAgentsMdBlock({baseUrl, agentId})` | OpenClaw-correct protocol text | yes |
| `isCodexAuthoredBlock(source)` | Detect the wrong block | yes |
| `mergeAgentsMd({...})` | Reuses `replaceManagedBlock` | yes |
| `installOpenclaw({...})` | Orchestrator | no |

**Workspace resolution is the fix.** The AGENTS.md target comes from
`agents.defaults.workspace`, never from the cwd. `--workspace` overrides.

## Data flow

Read-only through step 3. Nothing is written until success is known to be possible.

1. **Preflight** — reuse `claude/install.js`'s `preflight(endpoint, apiKey)`.
   Verify DashClaw is reachable and the key valid before touching any file.
2. Resolve the `openclaw` binary; clear error with install hint if absent.
3. `openclaw config file` → config path; `openclaw config get
   agents.defaults.workspace` → workspace. Both read-only, and both resolved
   here rather than at the step that needs them: an unresolvable workspace must
   fail before the first write, not after governance is already live.
4. `openclaw plugins install @dashclaw/openclaw-plugin@1.6.2`; skip if already
   present at or above that version — so the flag is a **minimum**, not a pin.
   1.6.2 is the current published version and the one verified running in
   production on 2026-08-10; the floor is raised deliberately, never floated.
5. `upsertEnvVar(<dir of openclaw.json>/.env, 'DASHCLAW_API_KEY', key)`. **This
   is the first write, and it precedes both remaining steps deliberately** — a
   key in `.env` is inert until a plugin exists to read it, while a plugin made
   live before the key exists refuses every tool call under `failClosed`. It
   precedes the *patch* as well as the enable, because on the migration path
   the patch is what deletes the plaintext key from `openclaw.json`.
6. Back up `openclaw.json` (scrubbed, see *Secret handling*), then
   `openclaw config patch` → plugin entry: `enabled`, `agentId`, `dashclawUrl`,
   `failClosed`. No key unless `--write-config`.
7. `openclaw plugins enable dashclaw-governance` — separate from the patch
   because `config patch` replaces arrays wholesale, and `plugins.allow` is an
   array holding every other enabled plugin.
8. `AGENTS.md` in the resolved workspace → back up → replace or insert the
   managed block, migrating a codex-authored block if present.
9. Verify: `openclaw config validate`, `openclaw plugins doctor`, and a
   read-back of `plugins.entries.dashclaw-governance.enabled`.
10. Print a summary: agent id used, files touched, backup paths, and
    "restart the gateway".

## Migration of a codex-authored block

Automatic, not flagged. Leaving a wrong protocol in place is the bug a flag
would preserve. Guarded by an unambiguous signal: the block is treated as
codex-authored only if it names both `dashclaw_session_start` and
`install codex`. A backup is always written.

The managed markers (`<!-- >>> dashclaw start … -->` / `<!-- <<< dashclaw end -->`)
stay byte-identical to the codex installer's, because `replaceManagedBlock`
matches by `indexOf` and **appends** when markers are absent — renaming them
would produce two blocks.

## The AGENTS.md block it writes

States what is true under OpenClaw: governance is automatic, the agent calls no
DashClaw tools itself, and there is no `dashclaw` MCP server in the runtime.
Retains the load-bearing rules — a block is final and must not be routed
around, what counts as a risky action, and that `failClosed` firing is correct
behaviour rather than an obstacle.

## Error handling

The failure mode that matters is **governance silently not enforcing** — the
same class the codex installer already shouts about for untrusted hooks. So:

- Preflight fails → exit non-zero, zero writes.
- `config patch` fails → **report the backup path and the state; do not restore
  it.** *(Amended 2026-08-11, after the fix round the implementation forced.)*
  The original line said "restore backup". Restoring is wrong here for three
  reasons the code made obvious. The backup is written **once** — the first one
  wins, so on a re-install it can be arbitrarily old, and restoring it would
  revert config the operator changed since for reasons unrelated to DashClaw.
  It is also **scrubbed** of any plaintext `dashclawApiKey` (see *Secret
  handling*), so restoring it over a live config would destroy a credential.
  And `config patch` validates before it writes, so a failed patch leaves
  `openclaw.json` untouched — there is nothing to roll back. What the operator
  actually needs is the information: the error names the backup path, says the
  plugin was not enabled and the config is unchanged, and the success summary
  prints the path too. A `plugins enable` failure after a successful patch gets
  the same treatment, plus the one instruction that fixes it (re-run).
- `plugins doctor` reports the plugin unloadable after install → loud warning,
  not a footnote. An install that appears to succeed while governance is dead
  is worse than a visible failure.
- Partial state is never silent.

## Testing

`__tests__/unit/cli-openclaw-install.test.js`, alongside
`cli-codex-install.test.js`:

- `upsertEnvVar` — adds when absent, replaces when present, preserves
  neighbours, never duplicates a key, survives a missing trailing newline.
- `buildAgentsMdBlock` contains **no** `dashclaw_guard`,
  `dashclaw_session_start`, or `install codex`. Direct regression test for the
  originating bug.
- `isCodexAuthoredBlock` — true on the real codex block, false on ours.
- `buildPluginConfigPatch` — omits the key by default, includes it under
  `--write-config`.
- `mergeAgentsMd` — replaces an existing block, appends when absent, and is
  idempotent: two runs produce identical output.
- Orchestrator with a mocked `runOpenclaw` — asserts step ordering and that a
  preflight failure aborts before any write.

## Flags

```
dashclaw install openclaw
  --agent-id <id>        default: openclaw  (set a distinct one per machine)
  --base-url <url>       default: configured DashClaw URL
  --api-key <key>        see precedence below
  --write-config         put the key in openclaw.json instead of .env
  --openclaw-bin <path>  if not on PATH
  --workspace <path>     override the resolved workspace
  --plugin-version <v>   default: 1.6.2
  --no-verify            skip step 9
```

API key precedence, first hit wins: `--api-key` → `DASHCLAW_API_KEY` in the
environment or the saved config → `DASHCLAW_API_KEY` in the profile's `.env` → existing
`dashclawApiKey` in `openclaw.json` (migrated out on write) → error asking for
`--api-key`. Resolution happens before preflight so step 1 tests the key that
will actually be installed.

`--agent-id` defaults to `openclaw`; the guide instructs setting a distinct id
per machine (e.g. `moltfire-openclaw`, `forge-openclaw`) so the audit trail
attributes correctly. The chosen id is printed prominently on completion.

## Ship surface

- `cli/bin/dashclaw.js` — command dispatch and `--help` text
- `app/guides/openclaw/page.tsx` — matching the codex and hermes guides
- README, CHANGELOG, version bump

## Out of scope

- **A `dashclaw doctor` check for "codex-authored block in an OpenClaw
  workspace."** Proposed and deliberately deferred; it is the diagnostic that
  would have caught this in seconds and is the natural follow-up.
- Any change to the codex or claude targets. `installCodex`'s cwd-based
  AGENTS.md resolution is correct for Codex; it was only wrong when pointed at
  an OpenClaw workspace, which this target now makes unnecessary.

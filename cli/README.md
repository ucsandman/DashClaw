# @dashclaw/cli

Terminal client for [DashClaw](https://dashclaw.io) — approve agent actions and diagnose your instance without leaving the shell.

## Install

```bash
npm install -g @dashclaw/cli
```

## Configure

The CLI resolves config in this order:

1. Environment variables (`DASHCLAW_BASE_URL`, `DASHCLAW_API_KEY`, optional `DASHCLAW_AGENT_ID`)
2. Saved config at `~/.dashclaw/config.json` (mode `600`)
3. Interactive prompt (first run)

On first run, if neither env vars nor a saved config are present, the CLI walks you through setup and offers to save the values to `~/.dashclaw/config.json`. Env vars always override saved values.

```bash
# Option A: env vars (one-shot or CI)
export DASHCLAW_BASE_URL="https://your-dashclaw.example.com"
export DASHCLAW_API_KEY="oc_live_..."

# Option B: interactive first run (persists)
dashclaw doctor
# → DashClaw instance URL: ...
# → API key: ********
# → Save to ~/.dashclaw/config.json? [Y/n]

# Later: remove the saved config
dashclaw logout
```

Optionally set `DASHCLAW_AGENT_ID` (defaults to `cli-operator`) for audit attribution.

## Commands

### `dashclaw up`

Install + start a local DashClaw (one command, resumable).

```bash
npx dashclaw up
npx dashclaw up --update            # upgrade an existing install in place
npx dashclaw up --yes               # non-interactive, accept all defaults
npx dashclaw up --no-browser        # skip opening /setup in the browser
npx dashclaw up --db docker         # force Docker Postgres
npx dashclaw up --db embedded       # force embedded Postgres (~40 MB download)
npx dashclaw up --db url            # bring your own Postgres — prompts for a postgresql:// connection string
npx dashclaw up --dir <path>        # install to a custom directory (default: ~/.dashclaw)
npx dashclaw up --port <n>          # bind to a custom port (default: 3000)
npx dashclaw up --source-dir <path> # use a local repo checkout instead of the published tarball
```

Re-running `npx dashclaw up` on an existing install boots the server without re-provisioning. Failures checkpoint and resume from where they stopped.

Postgres prefers host port 5433; when something else already holds it, provisioning scans forward to the first free port and says so (an existing `dashclaw-pg` container keeps whatever port it was created with — data lives in the `dashclaw_pgdata` volume and survives container recreation).

### `dashclaw down`

Stop the local server (and the Docker DB if `up` started it).

```bash
npx dashclaw down
```

### `dashclaw import <bundle.json>`

Load a workspace carry-out bundle — the file **Export workspace** downloads on a trial's `/connect` card (or `GET /api/workspace/export` on any instance) — into the configured instance. Policies, guard decisions, action records, open loops, assumptions, and agent identities carry over; API keys, OAuth tokens, and secret values never ride a bundle. Idempotent: re-running skips rows that already exist.

```bash
DASHCLAW_BASE_URL=http://localhost:3000 DASHCLAW_API_KEY=oc_live_... \
  dashclaw import dashclaw-workspace-*.json
```

### `dashclaw approvals`

Interactive inbox for all pending approval requests. Use arrow keys to navigate, `A` to approve, `D` to deny, `O` to open the replay link, `Q` to quit.

### `dashclaw approve <actionId>`

Approve a single action by ID.

```bash
dashclaw approve act_01h... --reason "Verified change window"
```

### `dashclaw deny <actionId>`

Deny a single action by ID.

```bash
dashclaw deny act_01h... --reason "Outside change window"
```

### `dashclaw halt`

The org kill switch, from the terminal. Requires an admin API key.

```bash
dashclaw halt on --reason "runaway deploy loop"   # every guard evaluation for the org returns block
dashclaw halt status                              # who halted, why, since when
dashclaw halt off                                 # resume normal guard evaluation
```

The halt is absolute at the decision layer (propagates across instances in ~3 s); whether a blocked action is mechanically stopped depends on the surface — see `docs/architecture/enforcement-boundary.md` in the repo.

### `dashclaw contained list|diff|apply`

Terminal client for Containment Verdicts (RFC 2026-07-06): an agent's provably file-scoped change is staged in an isolated git worktree instead of applied directly, and an operator reviews the diff before it merges.

```bash
dashclaw contained list                # actions awaiting an operator's promote/discard verdict
dashclaw contained diff act_01h...     # print the captured patch for one contained action
dashclaw contained apply act_01h...    # after promoting in the dashboard: run the governed merge
```

`apply` refuses to run unless the action's `containment_status` is `promoted` (the dashboard's verdict is the only source of truth), then re-presents the exact promotion act (`git merge --no-ff <containment_ref>`) to `guard()` so it resolves against the operator's grant. `allow` runs the merge and cleans up the worktree/branch; `require_approval` means promote from the dashboard first (or re-promote if the 15-minute grant window lapsed); a merge conflict surfaces git's raw output and exits 1 — resolve manually and commit, or re-promote for a fresh grant.

### `dashclaw install claude`

Provision DashClaw governance into Claude Code without cloning the repo.

```bash
dashclaw install claude                          # prompts for endpoint + API key
dashclaw install claude --endpoint <url> --key <oc_live_...>
dashclaw install claude --trial                  # browser signup on hosted.dashclaw.io, paste the key
```

Flow: preflight (`/api/health` + an authenticated read — nothing is written until it passes), hooks downloaded from your instance's `/downloads/dashclaw-claude-code-hooks.zip` (or copied from a repo checkout), `python3`/`python` resolved automatically, managed hook entries merged into `~/.claude/settings.json` (`.dashclaw-bak` backup, replace-on-reinstall), credentials written to `~/.dashclaw/claude-hooks/.env` (mode 600 — no secret lands in settings.json). Installs in **observe mode**; flip to enforce by setting `DASHCLAW_HOOK_MODE=enforce` in that `.env`. `--trial` defaults to the public trial at `https://hosted.dashclaw.io`; point it at your own hosted instance with `--endpoint <url>` (or `DASHCLAW_HOSTED_URL`).

### `dashclaw doctor`

Diagnose your DashClaw instance **and this machine**. Remote checks cover database, configuration, auth, deployment, SDK reachability, governance, and data hygiene; local checks cover what the server can't see — a stale compiled `mcp-server/lib`, `.gitattributes` drift, a local DB schema behind code, a disabled OpenClaw runtime plugin, a stale global CLI shim, broken Claude hook installs, and leaked machine-scope `DASHCLAW_*` env vars.

```bash
dashclaw doctor                          # report-only (DEFAULT — applies nothing)
dashclaw doctor --fix                    # apply safe auto-fixes, re-check, report what changed
dashclaw doctor --json                   # JSON output for CI/scripts (includes local checks)
dashclaw doctor --category database,config   # filter remote checks
dashclaw doctor --repo /path/to/dashclaw     # point repo checks at a checkout
dashclaw doctor --no-fix                 # accepted no-op alias (report-only is the default)
```

> **Changed in 0.4.0:** `dashclaw doctor` no longer applies remote auto-fixes by default — it reports and prints would-fix entries. Pass `--fix` to apply. Exit codes are unchanged (0 healthy, 1 otherwise).

Detect-only classes are never auto-fixed: leaked machine env vars (removal instructions printed) and OpenClaw gateway configs (remediation text printed). The `.gitattributes` restore runs only when the diff is provably line-ending/whitespace-only. Remote fixes go through `POST /api/doctor/fix`; fixes that need server filesystem access remain self-hoster territory via `npm run doctor` (also report-only by default now, same `--fix` opt-in).

### `dashclaw install codex`

Provision DashClaw governance into the Codex CLI: copies the governance hooks, merges them into `config.toml`, writes an AGENTS.md governance block into the target project, and (optionally) wires Codex's notify config.

```bash
dashclaw install codex --project <path>          # default: current directory
dashclaw install codex --approval-policy on-request
dashclaw install codex --include-notify          # also wire notify → dashclaw codex notify
dashclaw install codex --codex-bin <path>        # codex binary for the trust step (default: auto-detect)
dashclaw install codex --no-trust-hooks          # skip the hook-trust step
```

The install ends with a **hook-trust step**: codex-cli 0.142+ silently skips hooks it has not been told to trust — no prompt, no log line, the hook just never fires — so an untrusted install looks governed but enforces nothing. The installer spawns `codex app-server`, reads each hook's trust hash via `hooks/list`, writes the matching `[hooks.state]` entries into `config.toml`, and re-lists to verify every hook reports `trusted`. Binary auto-detection checks `--codex-bin`, OpenClaw's vendored codex copies, then `PATH`, and uses the newest hook-capable (≥ 0.142) binary it finds. If none exists the install still succeeds but prints a loud warning with the fix.

### `dashclaw install openclaw`

Provision DashClaw governance into an OpenClaw agent: installs and enables the `dashclaw-governance` OpenClaw plugin, patches the agent's identity/URL into `openclaw.json` via `openclaw config patch`, writes the API key to `~/.openclaw/.env` (or into `openclaw.json` with `--write-config`), and merges a governance protocol block into the resolved workspace's `AGENTS.md` (migrating a pre-existing codex-authored block if found, with a `.dashclaw-bak` backup).

```bash
dashclaw install openclaw                        # uses the resolved DASHCLAW_BASE_URL / DASHCLAW_API_KEY
dashclaw install openclaw --agent-id forge-1      # ledger identity (default: openclaw)
dashclaw install openclaw --api-key oc_live_...   # explicit key (or DASHCLAW_API_KEY / saved config)
dashclaw install openclaw --write-config          # store the key in openclaw.json instead of .env
dashclaw install openclaw --openclaw-bin <path>   # openclaw executable, if not on PATH
dashclaw install openclaw --workspace <path>      # override the workspace resolved from config
dashclaw install openclaw --no-verify             # skip the post-install config validate + plugins doctor check
```

Unlike `install claude`/`install codex`, the target agent calls no DashClaw tools itself — the plugin intercepts every tool call automatically, so guard/record/session-start are already satisfied. The install ends with a verification step (`openclaw config validate` + `openclaw plugins doctor`, skippable with `--no-verify`): the install still completes and files are written even if verification fails, but the command exits `1` and prints what to check, because an install that looks done while governance silently isn't enforcing is the one failure mode this feature exists to prevent.

### `dashclaw codex notify '<json>'`

Records a Codex turn-complete event as a DashClaw action record. Called by Codex's notify config (wired by `install codex --include-notify`); always exits 0 so Codex never sees an error from the spawn.

Accepts `--agent-id <id>` in the argv prefix (Codex appends the JSON payload after it). argv identity beats the machine-ambient `DASHCLAW_AGENT_ID`, so turns are never mis-attributed on a machine shared by several harnesses. Both notify payload key styles are understood: snake_case (current Codex CLIs) and kebab-case (the 0.13x line).

**OpenClaw embedded-codex bridge.** OpenClaw's `codex` agent runtime spawns a vendored `codex app-server` with `CODEX_HOME=<agent-dir>/codex-home` — native tool calls there never cross the OpenClaw plugin hook bus, and the vendored 0.13x binary does not execute `hooks.json`/config hooks, so that lane is invisible to both the OpenClaw governance plugin and the Codex hook pack. The bridge is this notify target: add to `~/.openclaw/agents/<agent>/agent/codex-home/config.toml` (top of file, before any `[table]`):

```toml
notify = ["node", '<path-to>/cli/bin/dashclaw.js', "codex", "notify", "--agent-id", "<your-agent-id>"]
```

Credentials resolve from the gateway environment (`DASHCLAW_URL`/`DASHCLAW_BASE_URL` + `DASHCLAW_API_KEY`). Each embedded-codex turn then lands in the decisions ledger as one `agent_turn` action (`metadata.source: codex-notify`). This is recording, not enforcement — full guard hooks become available when OpenClaw's vendored codex reaches ≥ 0.142.

### `dashclaw logout`

Remove the saved config at `~/.dashclaw/config.json`.

### `dashclaw version`

Print the CLI version (`--version` / `-v` also work).

### `dashclaw help`

Show all commands and flags.

## Exit codes

- `0` — healthy
- `1` — warnings present, failures, or the instance was unreachable

## License

MIT.

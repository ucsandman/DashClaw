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
npx dashclaw up --db <url>          # use an existing postgresql:// connection string
npx dashclaw up --dir <path>        # install to a custom directory (default: ~/.dashclaw)
npx dashclaw up --port <n>          # bind to a custom port (default: 3000)
npx dashclaw up --source-dir <path> # use a local repo checkout instead of the published tarball
```

Re-running `npx dashclaw up` on an existing install boots the server without re-provisioning. Failures checkpoint and resume from where they stopped.

### `dashclaw down`

Stop the local server (and the Docker DB if `up` started it).

```bash
npx dashclaw down
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

### `dashclaw install claude`

Provision DashClaw governance into Claude Code without cloning the repo.

```bash
dashclaw install claude                          # prompts for endpoint + API key
dashclaw install claude --endpoint <url> --key <oc_live_...>
dashclaw install claude --trial                  # browser signup on hosted.dashclaw.io, paste the key
```

Flow: preflight (`/api/health` + an authenticated read — nothing is written until it passes), hooks downloaded from your instance's `/downloads/dashclaw-claude-code-hooks.zip` (or copied from a repo checkout), `python3`/`python` resolved automatically, managed hook entries merged into `~/.claude/settings.json` (`.dashclaw-bak` backup, replace-on-reinstall), credentials written to `~/.dashclaw/claude-hooks/.env` (mode 600 — no secret lands in settings.json). Installs in **observe mode**; flip to enforce by setting `DASHCLAW_HOOK_MODE=enforce` in that `.env`. `--trial` defaults to the public trial at `https://hosted.dashclaw.io`; point it at your own hosted instance with `--endpoint <url>` (or `DASHCLAW_HOSTED_URL`).

### `dashclaw cost`

Spend readback from `GET /api/finops/spend` — your own Claude Code cost or the fleet rollup, straight from the terminal.

```bash
dashclaw cost                            # Claude Code spend, last 7 days (defaults)
dashclaw cost --lens claude-code --period 30d
dashclaw cost --lens fleet --period 90d  # agent LLM cost + x402 purchases
```

Outputs an aligned table (total, sessions, cache savings, by-project breakdown for the Claude-Code lens; Agent LLM / x402 / Total for the Fleet lens) plus a one-line summary. Unconfigured exits non-zero with a `dashclaw install claude` hint; bad `--lens`/`--period` values are rejected with usage text.

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

### `dashclaw code`

Subcommand group for Code Sessions (Claude Code analytics, ported from AgentLens). Three actions:

```bash
dashclaw code ingest                     # walk ~/.claude/projects and POST every .jsonl
dashclaw code ingest --dry-run           # preview the file list and payload shape without POSTing
dashclaw code ingest --projects-dir <p>  # override the default projects directory (also reads $CLAUDE_PROJECTS_DIR)

dashclaw code memo --project <slug>      # show the most recent weekly memo for a project
dashclaw code memo --project <slug> --save  # write the memo to ./memos/<iso-week>.md

dashclaw code apply <manifest-id> --dest=<project-cwd>   # apply an Optimal Files manifest locally
dashclaw code apply <manifest-id> --dest=<project-cwd> --dry-run
```

`ingest` stream-reads each session JSONL line-by-line and ships raw lines; large request bodies are brotli-compressed on the wire (via the `x-dashclaw-encoding: br` header — no base64 inflation) to fit Vercel's 4.5 MB per-request limit. It retries 429s and 5xxs with exponential backoff and throttles 150 ms between POSTs. Files over 40 MB raw are skipped with a `too_large` log entry. Never logs raw transcript content.

There is also `dashclaw code ingest-codex [--dry-run]`, which backfills Codex CLI transcripts from `~/.codex/sessions` (`--sessions-dir <path>` to override; `--out <dir>` for the local output directory).

`apply` fetches a manifest from `/api/code-sessions/manifests/<id>`, re-runs the secret scan, and writes the bundled files to `--dest`. Existing files get a three-way merge via the section-aware markdown merger; new files are written directly. Refuses any path outside `--dest` (path-traversal guard).

### `dashclaw install codex`

Provision DashClaw governance into the Codex CLI: writes an AGENTS.md governance block into the target project and (optionally) wires Codex's notify config.

```bash
dashclaw install codex --project <path>          # default: current directory
dashclaw install codex --approval-policy on-request
dashclaw install codex --include-notify          # also wire notify → dashclaw codex notify
```

### `dashclaw codex notify '<json>'`

Records a Codex turn-complete event as a DashClaw action record. Called by Codex's notify config (wired by `install codex --include-notify`); always exits 0 so Codex never sees an error from the spawn.

### `dashclaw prompts`

Prompt-library client: `list [--category C]`, `get <id>`, `versions <id>`, `render <templateId> [--version-id <vid>] [--var key=value] [--record]`, `create --name N --description D --category C` (admin), `add-version <id> --content C` (admin), `activate <id> <vid>` (admin), `stats [--template-id X]`.

### `dashclaw inbox`

Agent message inbox: `inbox list [--unread] [--limit N]`, `inbox read <id> [...]`, `inbox archive <id> [...]`.

### `dashclaw behavior`

Behavior Learning readback: `behavior status` (local recorder sample counts) and `behavior suggestions [--agent-id <id>]` (evidence-backed policy suggestions).

### `dashclaw posture` / `dashclaw next`

`posture` prints the governance posture score and the remediation queue; `posture resolve <key> [--snooze | --accept-risk] [--note "..."]` dispositions a finding. `next` prints the single top open governance gap and its fix.

### `dashclaw env`

Run a command with managed secrets injected in-memory (values never touch disk or the terminal):

```bash
dashclaw env [--agent <id>] -- node my-agent.js   # inject managed secrets into the child env
dashclaw env                                      # list secret NAMES + count (never values)
```

Fail-closed: if the secrets fetch fails, the child is not spawned.

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

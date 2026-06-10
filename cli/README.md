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

### `dashclaw cost`

Spend readback from `GET /api/finops/spend` — your own Claude Code cost or the fleet rollup, straight from the terminal.

```bash
dashclaw cost                            # Claude Code spend, last 7 days (defaults)
dashclaw cost --lens claude-code --period 30d
dashclaw cost --lens fleet --period 90d  # agent LLM cost + x402 purchases
```

Outputs an aligned table (total, sessions, cache savings, by-project breakdown for the Claude-Code lens; Agent LLM / x402 / Total for the Fleet lens) plus a one-line summary. Unconfigured exits non-zero with a `dashclaw install claude` hint; bad `--lens`/`--period` values are rejected with usage text.

### `dashclaw doctor`

Diagnose your DashClaw instance and auto-fix safe issues. Checks database, configuration, auth, deployment, SDK reachability, and governance.

```bash
dashclaw doctor                          # rich terminal output, auto-fix what it can
dashclaw doctor --json                   # JSON output for CI/scripts
dashclaw doctor --no-fix                 # diagnose only
dashclaw doctor --category database,config
```

The CLI invokes your instance's `/api/doctor` endpoints, so fixes that need filesystem access (env writes) are handled separately by self-hosters running `npm run doctor` locally.

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

`ingest` stream-reads each session JSONL line-by-line and ships raw lines; large request bodies are gzip-compressed on the wire (raw gzip via the `x-dashclaw-encoding: gzip` header — no base64 inflation) to fit Vercel's 4.5 MB per-request limit. It retries 429s and 5xxs with exponential backoff and throttles 150 ms between POSTs. Files over 40 MB raw are skipped with a `too_large` log entry. Never logs raw transcript content.

`apply` fetches a manifest from `/api/code-sessions/manifests/<id>`, re-runs the secret scan, and writes the bundled files to `--dest`. Existing files get a three-way merge via the section-aware markdown merger; new files are written directly. Refuses any path outside `--dest` (path-traversal guard).

### `dashclaw help`

Show all commands and flags.

## Exit codes

- `0` — healthy
- `1` — warnings present, failures, or the instance was unreachable

## License

MIT.

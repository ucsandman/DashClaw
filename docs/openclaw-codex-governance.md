# OpenClaw embedded-codex agents: risk-tiered governance setup

**Who this is for:** you run an OpenClaw gateway agent with `agentRuntime: codex`
(the embedded Codex app-server lane) and you are getting a Telegram
"Plugin approval required — Allow Once / Allow Always / Deny" ping for **every
shell command** the agent runs.

**What this runbook does:** replaces that blanket per-command approval with
DashClaw's risk-tiered guard:

| Command risk | What happens |
|---|---|
| Low (reads, `git status`, builds) | Auto-allowed, recorded in `/decisions` |
| Medium | Allowed with a `warn`, recorded |
| High (deletes, secrets, sends, spend) | Blocked until you approve in `/approvals` |
| Policy-blocked | Blocked, full stop |

You stop being the approval bottleneck for routine work and keep a one-click
hold on the dangerous class. Every command still lands in the decision ledger.

## Prerequisites

- OpenClaw 2026.7.x or newer with the codex plugin generation that vendors
  **codex ≥ 0.142** (older vendored codex runs no hooks at all — check with
  the version command in step 2).
- Node 18+ and Python 3 on the machine (`node --version`, `python --version`).
- Your DashClaw instance URL and an API key for the workspace
  (dashboard → Settings → API keys).

## Steps

### 1. Get the DashClaw repo on the machine

The governance hooks ship in the repo (the npm CLI package does not include
them):

```powershell
git clone https://github.com/ucsandman/DashClaw C:\Projects\DashClaw
```

Already cloned? `git -C C:\Projects\DashClaw pull` instead.

### 2. Confirm the vendored codex is hook-capable

```powershell
Get-ChildItem -Recurse "$env:USERPROFILE\.openclaw\npm\projects" -Filter codex.exe | ForEach-Object { & $_.FullName --version }
```

You need at least one line reporting `codex-cli 0.142.0` or newer. If every
copy is 0.13x, update OpenClaw and force-install the codex plugin first
(`openclaw plugins install @openclaw/codex` — plain `plugins update` lies
"up to date" across generations).

### 3. Give the hooks credentials via the agent workspace `.env`

Create (or edit) `.env` in the agent's workspace directory — the folder the
agent works in, e.g. `C:\Users\<you>\clawd`:

```ini
DASHCLAW_URL=https://<your-dashclaw-instance>
DASHCLAW_API_KEY=<your-workspace-api-key>
```

The hooks walk up from their working directory and read this file; values
already in the machine environment win over the file.

### 4. Run the installer against the agent's codex-home

The embedded lane uses a per-agent `CODEX_HOME`, **not** `~/.codex`. For an
agent named `main`:

```powershell
$env:CODEX_HOME = "$env:USERPROFILE\.openclaw\agents\main\agent\codex-home"
node C:\Projects\DashClaw\cli\bin\dashclaw.js install codex --project C:\Users\<you>\clawd --agent-id <agent>-openclaw --approval-policy never
```

- `--approval-policy never` is what turns off the codex-native per-command
  Telegram pings. Safe **only** because the DashClaw hooks now enforce
  instead; do not set it without them.
- `--agent-id` is the identity every decision is recorded under.

The install ends with the hook-trust step. You must see:

```
Hooks trusted. 4 hook(s) via codex 0.144.x (verified).
```

codex ≥ 0.142 **silently skips untrusted hooks** — if you instead see
`WARNING: hooks are installed but NOT trusted`, nothing enforces yet; re-run
with `--codex-bin <path-to-codex.exe from step 2>`.

### 5. Restart the gateway

The app-server children are long-lived and read config at spawn:

```powershell
openclaw gateway restart
```

(or restart the machine's gateway service/login item, whichever you use).

### 6. Verify it works

1. Ask the agent (via Telegram or the console) to run something harmless,
   e.g. "run git status". No approval ping should appear.
2. Open your DashClaw dashboard → `/decisions`: the command is there, risk
   scored, decision `allow` or `warn`.
3. Ask it to do something risky (e.g. "delete <some scratch file> with a
   recursive force flag"). The tool call pauses, and the item is waiting in
   `/approvals` with Approve / Deny buttons; the hook polls and releases the
   command the moment you approve.

Want the high-risk approvals pinged to you in Telegram with inline
Approve/Reject buttons (instead of watching `/approvals`)? Wire
[Telegram approvals](./telegram-setup.md) — you keep the same chat UX you had
before, but only for the commands that deserve a human.

## Tuning which risk level pings you

The thresholds live in your DashClaw workspace, not on the machine:
dashboard → **Policies**. The stock setup that produces the table above is a
`risk_threshold` policy (`threshold` + `action: require_approval`) plus any
targeted `require_approval` policies for action types you always want held
(emails, social posts, payments). Adjust in the UI; changes apply to the next
guard call — no restart, nothing to redeploy on the agent machine.

## Troubleshooting

- **Still getting codex-native pings** — the gateway kept an old app-server
  child; restart the gateway (step 5). Also confirm `approval_policy = "never"`
  appears in the agent's `codex-home\config.toml` root-keys managed block.
- **Commands run but nothing appears in `/decisions`** — hooks untrusted
  (re-run step 4 and read its output) or credentials missing (step 3).
- **Every request answers 401/403** — wrong or revoked API key, or the key
  belongs to a different workspace.
- **`SCHEMA_NOT_INITIALIZED`** — self-hosted instance behind on migrations;
  run `npm run db:migrate` on the instance.

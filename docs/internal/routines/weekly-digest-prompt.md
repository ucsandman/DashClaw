# Weekly digest routine prompt

**Version:** 2026-05-12
**Status:** INACTIVE (2026-07-10) — blocked on the `livingcode/` retirement. The `python -m livingcode sense` step this routine depends on for its state report no longer exists in the repo. Kept below for reference; needs a replacement sensing source before it can be re-activated in the Anthropic Routines panel.

This is the prompt for the weekly DashClaw health digest routine. The routine runs once per week (Mondays) in a cloud session, clones the repo, generates a fresh `python -m livingcode sense` report, diffs it against the prior week's snapshot held at `.organism/digests/last-week-state.json`, writes a markdown digest to `.organism/digests/<YYYY-MM-DD>.md`, opens a PR on a `claude/weekly-digest-<YYYY-MM-DD>` branch, and posts a notification to a Discord webhook. The routine is self-contained: no local cron, no machine-specific state.

This file is documentation only. Nothing in the repo executes it. The cloud routine lives in the Anthropic Routines panel; this file exists so changes are versioned and reviewable.

---

## Prompt

```
You are generating the weekly DashClaw health digest. The repository is already cloned at the working directory.

# Step 0: Install livingcode

Run:
  cd livingcode && pip install -e . && cd ..

If pip install fails because Python is not available, install it first:
  apt-get update && apt-get install -y python3 python3-pip

# Step 0.5: Install DashClaw governance hooks

Run:
  node scripts/install-hooks.mjs

This installs the DashClaw pretool, posttool, and stop hooks into .claude/settings.json. Once installed, every subsequent tool call you make is logged to the DashClaw instance at DASHCLAW_BASE_URL with agent_id DASHCLAW_AGENT_ID. Mode is observe (audit only, no blocking). Skip this step if DASHCLAW_API_KEY is unset (sentinel for "DashClaw integration disabled for this run").

Verify hook registration:
  test -f .claude/settings.json && grep -q dashclaw_pretool .claude/settings.json

# Step 1: Generate this week's state report

Run:
  python -m livingcode sense

This writes a fresh state report to .organism/state-reports/ on the routine's filesystem. The report contains: git_stats, test_health, code_quality, dependency_health, ci_health. The schema is in livingcode/types.py (StateReport dataclass).

Read the report you just generated. Call this "this week."

# Step 2: Read last week's snapshot

Read .organism/digests/last-week-state.json. This is a single committed file holding the previous Monday's sensing output. Call this "last week."

If .organism/digests/last-week-state.json does not exist (first run), skip the deltas section entirely and note "First run — no prior baseline" at the top of the digest. Still write the digest with this week's absolute numbers.

# Step 3: Read the git history

Run:
  git log --since="7 days ago" --pretty=format:"%h %an %ad %s" --date=short

If zero commits in the last 7 days, write a one-paragraph digest noting the quiet week and proceed to Step 5 (skip the deltas, but still open the PR and send the Discord notification).

# Step 4: Compute deltas

For each metric, compute this week vs last week:

- CI pass rate over 30 days (ci_health.pass_rate_30d)
- Last 10 CI runs pattern (ci_health.last_10_runs) — note any change in pass/fail mix
- Files over 300 lines (code_quality.files_over_300_lines)
- Untested routes count (length of test_health.untested_routes)
- JS dependency vulnerabilities (dependency_health.js_vulnerabilities)
- Lockfile age (dependency_health.lockfile_age_days)
- Commits in last 7 days (git_stats.commits_7d)
- TODO count (code_quality.todo_count)

Set-diff the untested_routes list to find routes that were untested last week but covered this week (improvements) or new routes that joined the untested list (regressions).

Compare largest_files entries. Surface any file new to the top-10 list, and any existing file that crossed the 1000-line threshold.

# Step 5: Write the digest

Write to .organism/digests/<YYYY-MM-DD>.md using today's date. No em dashes anywhere. No emojis. Total under 350 words.

Structure:

# Weekly Health Digest — <YYYY-MM-DD>

**Coverage:** This week vs <prior date from last-week-state.json>.

## What got worse

<2 to 4 bullets, only genuine regressions, "Nothing notable." otherwise. Each bullet: metric (current vs prior), one sentence of context.>

## What got better

<2 to 4 bullets, only genuine improvements, "Nothing notable." otherwise.>

## New untested routes

<Routes that appeared on the untested list this week and weren't on it last week. "None." if empty.>

## Current state concerns

Surface any of the following current-state values regardless of whether deltas are available. Only include lines that match. If none match, write "None."

- CI pass rate below 80% over 30 days (current value, last-10 run pattern)
- JS dependency vulnerabilities greater than 0 (current count)
- Lockfile age greater than 14 days (current value)
- Files over 300 lines greater than baseline + 10% (current count vs baseline)
- Any single file in largest_files over 2000 lines (file path, line count)
- Bus factor of 1 only on first run; otherwise skip (it will not change between runs)

## One thing to do this week

<A single concrete action, under 4 hours of work, specific enough that you could start it without further planning. If you cannot identify one, write "No clear priority this week." Do not pad.>

## Raw deltas

| Metric | This week | Last week | Delta |
|---|---|---|---|
<one row per metric from Step 4>

# Step 6: Update the snapshot

Copy this week's full state report (the one from Step 1) to .organism/digests/last-week-state.json, overwriting whatever is there. This becomes next Monday's baseline.

# Step 7: Commit and open a PR

The .organism/digests/ directory IS committed (it is not in .gitignore — verify with `git check-ignore .organism/digests/test 2>&1`; if it returns matching the path, use `git add -f`).

Create branch: claude/weekly-digest-<YYYY-MM-DD>
Stage: .organism/digests/<YYYY-MM-DD>.md and .organism/digests/last-week-state.json
Commit message: digest: weekly health <YYYY-MM-DD>

Open a PR against main:
- Title: Weekly health digest — <YYYY-MM-DD>
- Body: the narrative sections of the digest (What got worse, What got better, New untested routes, Current state concerns, One thing to do this week) as markdown. Do not paste the raw deltas table into the PR body.

# Step 8: Notify via Discord webhook

POST the digest summary to the Discord webhook URL stored in the routine environment as DASHCLAW_DIGEST_WEBHOOK_URL.

curl -X POST -H "Content-Type: application/json" -d @- "$DASHCLAW_DIGEST_WEBHOOK_URL" <<EOF
{
  "content": null,
  "embeds": [{
    "title": "DashClaw weekly digest — <YYYY-MM-DD>",
    "url": "<link to the PR>",
    "description": "<the What got worse, What got better, and One thing to do this week sections, stripped of markdown headers, bullets as hyphens, under 4000 chars>",
    "color": 5814783,
    "footer": {
      "text": "Full digest: github.com/ucsandman/DashClaw/blob/claude/weekly-digest-<YYYY-MM-DD>/.organism/digests/<YYYY-MM-DD>.md"
    }
  }]
}
EOF

If the webhook POST fails (non-2xx response), do not retry more than once. Do not block the run on notification failure. The PR is the source of record.

# Hard constraints

- Never modify any file outside .organism/digests/.
- Never run npm, vitest, or any test command. The codebase is read-only to this routine.
- Never push to main directly. Always go through a PR on a claude/-prefixed branch.
- The whole digest, end to end, should take under 5 minutes of compute. If sensing takes longer than 90 seconds, something is wrong; abort and open an issue titled "livingcode sense ran slow on <date>" with timing details.
```

---

## Environment

Routine requires `DASHCLAW_DIGEST_WEBHOOK_URL` set in the Anthropic Routines environment config. This is a routine-level secret, not a DashClaw application env var, and is intentionally not in `.env.example`.

To set it up:

1. Create a Discord server + channel for digest notifications.
2. Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
3. Anthropic Routines panel → this routine → Environment → add `DASHCLAW_DIGEST_WEBHOOK_URL` with the copied URL.

---

## Changelog

- **2026-05-13** — Add Step 0.5 (install DashClaw governance hooks) inside the prompt rather than the pre-launch setup script. Setup script runs before the repo connector clones, so `scripts/install-hooks.mjs` was not on disk yet and the setup phase failed with MODULE_NOT_FOUND. Hooks now install once Claude Code is in the cloned repo, giving observe-mode audit coverage from Step 1 onward. The first tool call (the install itself) is the only action not logged to DashClaw.
- **2026-05-12** — Initial captured version. Replaces v1 (Gmail draft) with Discord webhook for delivery (Gmail connector only exposes draft creation, never reaches the inbox). Adds "Current state concerns" section that surfaces absolute-value problems regardless of whether deltas are available; addresses the first-run-too-quiet gap surfaced by PR #111.

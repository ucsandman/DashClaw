# v5.4 — The outsider run: CLI trial path walked cold (recorded)

Roadmap v5.4 (owner-roadmap.md). The CLI/MCP path is the trial's power path
(`dashclaw install claude --trial`, QUICK-START's "3-Minute Hosted Trial") —
and before this run, no one had ever walked it as a genuine outsider on a
cold machine. This document is the recorded run the item's acceptance calls
for: every stumble is a defect; each was fixed in the same item.

## Run conditions (2026-07-05)

- Fresh simulated machine: empty home directory (`USERPROFILE` redirected),
  isolated npm prefix, **all `DASHCLAW_*` ambient env vars stripped** (this
  machine carries user-level leaks that would have silently skipped the
  trial flow — a real outsider box doesn't have them).
- The **published** `@dashclaw/cli@0.5.0` from npm — what an outsider
  actually gets — not the repo checkout.
- Target: the live public trial instance `https://hosted.dashclaw.io`.
- Trial workspace provisioned server-side via the same
  `provisionHostedWorkspace` repository function the Turnstile mint route
  calls (the browser mint itself is human-click-gated by design and was
  live-proven in v5.1/v5.2; this run tests everything around it). The
  workspace was deleted after the run with `trial_action_cap = 0`, so it
  left no funnel mint and no snapshot.

## The recorded run, timed

| Step | Result | Time |
|------|--------|------|
| `npm i -g @dashclaw/cli` | 25 packages, clean | 5s |
| `dashclaw install claude --trial` (URL prompt) | **STUCK — defect F1** (see below) | — |
| retry with `--endpoint https://hosted.dashclaw.io` | preflight OK → hooks bundle downloaded from the live instance → settings wired → observe mode | 0.9s after key paste |
| Governed tool call through the installed PreToolUse hook (`git status` payload, exactly what Claude Code sends) | exit 0, decision recorded live: `act_341724fe…`, agent `claude-code`, action_type `review`, risk 15 | 0.9s |
| `dashclaw cost` | truthful zero ("No Claude Code spend recorded yet for 7d" + how sessions arrive) | 1s |
| Stop hook | recap line: `[DashClaw] Governed 1 action(s) this session → https://hosted.dashclaw.io/decisions` | <1s |

Server-side verification on the live DB after the run: 1 guard decision,
1 action record, **4 starter policies pre-seeded** (QUICK-START's
"pre-seeded" claim is true), and the v5.3 instrument stamped both
`api_keys.first_used_at` and `last_used_at` on a genuine cold path — the
first real-world exercise of the v5.3 activation instrument.

**The "3-Minute Hosted Trial" claim stands.** Machine time totals under
10 seconds; the human steps (browser mint, pasting the key) dominate and
fit comfortably inside three minutes — *once F1 is fixed*. Before the fix,
the claim was unreachable from a cold start at the first prompt.

## Defects found → fixed

- **F1 (blocker): the first question was unanswerable.** With no ambient
  env, `--trial` prompted *"Hosted DashClaw URL (where you signed up / will
  sign up):"* — and neither QUICK-START nor README ever names
  `hosted.dashclaw.io`. A stranger following the docs cannot answer it.
  **Fix:** the CLI now defaults `--trial` to `https://hosted.dashclaw.io`
  (announced, overridable with `--endpoint <url>` / `DASHCLAW_HOSTED_URL`);
  QUICK-START, README, and the CLI help/README now name the instance.
  Pinned by test (`--trial with no endpoint anywhere defaults to the public
  hosted trial URL`).
- **F2: stdin EOF during prompts exited 0 silently, installing nothing.**
  `ask()`/`askSecret()` left their promises pending when stdin ended
  (piped input exhausted, Ctrl+D); node drained the event loop and exited
  clean — success exit code, nothing installed. **Fix:** both prompts now
  reject on EOF ("stdin closed before the prompt was answered"); the
  install exits 1 loudly. Pinned by child-process regression tests
  (`cli/test/prompt-eof.test.js`).
- **F3: the published CLI was three weeks stale under the same version.**
  `@dashclaw/cli@0.5.0` (published 2026-06-13) differs from the repo at the
  same version number: outsiders were getting hooks without the `--agent-id`
  identity declaration (roadmap v2.2), without the `Workflow` matcher
  (v4.3), and without the Codex session-digest wiring. **Fix:** version
  bumped to 0.6.0; republish rides this ship's release step.
- **F4 (copy): QUICK-START said "paste the endpoint + key into the
  installer prompt"** — the trial flow only prompts for the key. Corrected.

Flagged, not fixed (deliberately out of scope): `cli/package.json` depends
on `dashclaw@^2.2.1` (locks 2.13.1; latest is 4.x). The CLI only uses the
SDK constructor for approve/posture calls and nothing failed on the run;
widening the range is a separate, regression-bearing change.

## What was already good (observed, not assumed)

Preflight (health + authenticated read before any write), hooks-bundle
download from the live instance, `python3` Store-alias-safe resolution,
settings.json merge with backup, 0600 credentials file, observe-mode
default, truthful `cost` empty state, and the recap line — all worked
first try on the cold box.

# ERRORS.md — repeated failures and their fixes

Newest first. Full entries for multi-attempt debugging or reusable lessons; one-liners for immediate breaks/corrections.

---

- 2026-08-14 (amended) — CI-only failure in `policies-inert-banner-reveal.test.jsx`: first diagnosed as a one-shot-read race and "fixed" with `waitFor` — WRONG, it failed again in CI with the retry in place / status: not reproducible locally (0/15 isolated, 0/5 with 120ms-delayed mocks); text renders while the sentences tab reads unselected for >1s, which no single-tree state can produce / action: failure-time DOM diagnostics now ship in the test (tablist count, per-tab aria state, hidden ancestry, text presence) so the next CI failure names the mechanism / lesson: a "flake" fix that only adds retries is a hypothesis, not a fix — it was falsified by the very next run.

---

## 2026-08-14 — adversarial sweep #2: durable-mute key coarser than the signal it mutes; publish() reused a client its own timeout handler destroyed

Three lessons from the 13-finding sweep over the v5.23.4 arc, same-day catches of code shipped earlier in the arc:

1. **A dismissal key must match the granularity the signal is MINTED at.** `mcp_degraded` signals are built one per MCP *server*, but `SAMPLED_TIME_SIGNAL_TYPES` reduced its durable-mute key to (type, agent) — muting server A muted server B, and the key's agent_id was whichever `guard_decisions` row happened to be seen first, so the mute also churned. Shipped in f3e49a76, caught by the same-day sweep. Fix: the signal now carries `mcp_server` and the key is (type, server), reusing the empty timestamp slot so every other type's persisted key stays byte-identical.
2. **An error handler that tears down a resource must not let the caller keep using its stale reference.** `events.ts` `publish()` fetched the Redis publisher once; the XADD timeout path called `dropPublisher()` (socket destroyed, promise cleared), then fell through to `publisher.publish(...)` on the dead client — instant `ClientClosedError`, event lost for live-Redis SSE subscribers. Shipped in 1cc7e1ae. The first fix attempt reconnected ad hoc via `connectClient()`, which leaked one unmanaged connection per timeout AND bypassed the #223 failure cooldown — re-fetching through `getPublisher()` (cached, cooldown-honoring) is the only correct shape.
3. **Review agents must search every test tree before claiming "zero tests".** Finding "zero regression tests for the config.toml fix" survived adversarial verification because finder AND verifier only searched `cli/test/` — the tests existed in `__tests__/unit/cli-codex-install.test.js`, shipped inside b10d7798 itself and CI-visible. Prompt-scope blindness is a correlated failure across finder and skeptic: they inherited the same wrong search space from the scope brief.

## 2026-08-14 — verification drill wrote to the real ~/.codex/config.toml (one-liner)

What happened: while verifying the installer fix below, a `node -e` drill passed `process.env.SCRATCH` for `CODEX_HOME`, but the shell variable was set without `export` — undefined env → installer fell back to the real `~/.codex` and the repo's AGENTS.md. Root cause: un-exported shell variable consumed inside a subprocess. Prevention: verification scripts that target a sandbox path now hardcode the path and hard-fail if the resolved write path is outside it (see the guard in the drill script pattern). The new TOML round-trip gate held: the live config stayed parseable; AGENTS.md restored from git.

## 2026-08-14 — `dashclaw install codex` corrupted ~/.codex/config.toml; every `codex exec` failed

**Symptom:** every `codex` invocation on the machine failed to parse `~/.codex/config.toml` ("invalid type: string, expected u32" / duplicate-table parse errors).

**Root cause — two distinct bugs in the managed-block merge:**

1. **Duplicate table.** The installer appended its `[mcp_servers.dashclaw]` table without detecting a pre-existing hand-written `[mcp_servers.dashclaw]` elsewhere in the file. TOML rejects duplicate table definitions, so the whole config failed to load.
2. **Bare root key after tables.** The old managed block (pre-a0b114e3, 2026-08-12) started with a bare `approval_policy = "on-request"` and was appended at the END of the file — in TOML a bare key after a table header belongs to that table, so it landed inside `[tui.model_availability_nux]` and broke codex's schema validation. (a0b114e3 already moved root keys into a dedicated block inserted above the first table header, and fixed `command = "python"` → `"node"`; the live config had been written by the older installer.)

**Fix (this date, `cli/lib/codex/install.js`):**

- `neutralizeManualDashclawTables()` — any hand-written `[mcp_servers.dashclaw]` (or subtable, or quoted-key spelling) outside the managed markers is commented out with a notice, matching how the live file was repaired by hand.
- `neutralizeManualRootKeys()` — a hand-written root-level `approval_policy` (and `notify`, when the installer writes one) outside the markers is commented out so the managed root-keys block never creates a duplicate key.
- `assertParseableToml()` round-trip gate (smol-toml): the merged config must parse BEFORE the write (a bad merge leaves the user's file untouched) and again on read-back after the write (restore + throw on failure). The installer can no longer leave an unparseable config behind.
- Regression tests in `__tests__/unit/cli-codex-install.test.js` ("mergeConfigToml corruption regressions (2026-08-14)") replay the incident file shape — manual dashclaw table + file ending on `[tui.model_availability_nux]` — and were confirmed to FAIL against the pre-fix installer.

**Lesson:** a text-templating merge into a structured format needs a real parser as an exit gate. The markers-only merge was "safe" for content inside the markers and blind to every conflict outside them.

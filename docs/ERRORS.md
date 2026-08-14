# ERRORS.md — repeated failures and their fixes

Newest first. Full entries for multi-attempt debugging or reusable lessons; one-liners for immediate breaks/corrections.

---

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

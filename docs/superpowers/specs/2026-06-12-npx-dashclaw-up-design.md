# `npx dashclaw up` — one-command local install design

**Date:** 2026-06-12
**Status:** Approved design, pre-implementation
**Owner:** Wes
**Relation:** Workstream feeding the HN launch sprint (the README and Show HN post lead with this command). Ships as `@dashclaw/cli` 0.5.0, folding in the already-owed 0.4.0 publish.

## Goal

A stranger with nothing but Node 20+ runs **one command** and ends with:
1. DashClaw running at `http://localhost:3000` against a real local Postgres,
2. secrets and an admin API key generated for them,
3. their next Claude Code session governed (hooks wired with the minted key),
4. the dashboard open in their browser.

Every decision the installer cannot make alone is asked interactively in the terminal (no GUI popups — the audience lives in the terminal; every prompt has a sane default so Enter-Enter-Enter works).

## The command

```bash
npx dashclaw up
```

- `dashclaw` (the Node SDK package, already ours, version-synced with the platform) gains a `bin` shim that forwards `npx dashclaw <args>` to `@dashclaw/cli`. The SDK's library surface is unchanged.
- `npx @dashclaw/cli up` and globally-installed `dashclaw up` work identically.
- Re-running `up` on a machine that already has an install **starts it** (idempotent boot command), not a re-install. `dashclaw up --update` upgrades in place. `dashclaw down` stops the server and (if we started it) the embedded DB.

## UX contract (the transcript is the spec)

```
$ npx dashclaw up

DashClaw — local install
✓ Node 22.1.0
✓ Free disk: 4.2 GB
→ Installing to ~/.dashclaw/app/4.21.0 (override: --dir)

Database — pick one:
  1. Docker Postgres (detected Docker 27.0)   [default]
  2. Embedded Postgres (no Docker needed, ~40 MB download)
  3. I have a postgresql:// URL
Choice [1]:

✓ Postgres ready (postgresql://localhost:5433/dashclaw)
✓ Secrets generated (NEXTAUTH_SECRET, ENCRYPTION_KEY, CRON_SECRET)
✓ Admin API key minted: oc_live_..7f3a   (saved to ~/.dashclaw/config.json)
✓ Local admin password: <generated>      (printed ONCE — written only to .env.local)
✓ Migrations applied (38 files)
✓ Build complete (Turbopack, 9s)
✓ Server running at http://localhost:3000   (Ctrl+C stops it; `dashclaw up` restarts it)

Connect Claude Code now? [Y/n]
✓ Hooks installed (observe mode) — your next Claude Code session is governed.

Opening http://localhost:3000/setup ...
Done. First steps: http://localhost:3000/connect
```

## Architecture

All new code lives in `@dashclaw/cli` as an `up` command group (`cli/lib/up/`), reusing existing machinery rather than duplicating it:

| Step | Mechanism | Reuses |
|------|-----------|--------|
| Fetch app | HTTPS download of the release tarball (`codeload.github.com/ucsandman/DashClaw/tar.gz/v<X.Y.Z>`), extracted to `~/.dashclaw/app/<version>` | nothing new to maintain; no git required |
| Version pin | CLI asks `https://registry.npmjs.org/dashclaw/latest` for the platform version (unified version model) | version-sync invariant |
| Deps + build | `npm ci` (fallback `npm install`) + `npm run build`, then `next start -p <port>` | repo build pipeline |
| DB ladder | (1) Docker detected → reuse `scripts/setup.mjs` Docker-PG path; (2) no Docker → `embedded-postgres` npm package, binaries + data under `~/.dashclaw/pg/`; (3) paste URL | `scripts/setup.mjs` choice logic, ported into the CLI |
| Secrets/key/migrations | Port of `scripts/setup.mjs` (generate secrets, write `.env.local`, mint `oc_live_` key into `org_default`, apply `drizzle/*.sql`) | setup.mjs + auto-migrate logic |
| Connect agent | Chains into the existing `dashclaw install claude` with `baseUrl=http://localhost:3000` and the minted key pre-filled (no copy-paste) | install-claude flow, untouched |
| State | `~/.dashclaw/instance.json`: app version, install dir, port, DB mode, pid. Read by `up` (boot vs install), `down`, `--update` | CLI config conventions |

**Process model:** the server runs as a child of `up` in the foreground (Ctrl+C stops everything cleanly, including embedded PG). No daemon/service manager in v1 — `dashclaw up` after reboot is the restart story.

**Port collisions:** if 3000 is busy, prompt with next free port as default; persist the choice.

## Error handling

- **Fail loudly, resume cleanly.** Every step is checkpointed in `instance.json`; a failed run says exactly which step died and `npx dashclaw up` resumes from there, not from scratch.
- Node <20 → clear version error with nvm/installer link. No Docker AND embedded-PG download fails → offer choice 3 (paste URL) instead of dying.
- Windows specifics: embedded-postgres publishes win32-x64 binaries; paths quoted; no POSIX-isms (the CLI already runs on Windows).
- The local admin password prints once and is recoverable from `.env.local` — stated in the output.
- Nothing is ever sent off-machine except the npm/GitHub downloads; say so in the transcript (HN will ask).

## Testing

- Unit: the `up` step functions (version resolve, tarball URL, env writer, instance.json state machine) in the existing CLI vitest setup, network mocked.
- Integration (CI): a GitHub Actions job per OS (ubuntu, windows, macos) that runs `dashclaw up --no-browser --db=embedded --yes` against a built CLI and asserts: HTTP 200 on `/api/health`, one governed action recordable via the minted key, `dashclaw down` exits clean. This doubles as the launch-week proof the README command works on all three OSes.
- The existing `npm run setup` keeps its own tests; ported logic is extracted to a shared module, not forked.

## Out of scope (v1)

- Daemonization/auto-start on boot; multi-instance; TLS on localhost.
- Installing Node or Docker for the user.
- Codex/Hermes hook chaining (the prompt offers Claude Code only; others stay documented).
- Replacing `npx dashclaw-demo` (stays as the zero-install simulated demo).

## Launch integration

- README top fold and Show HN post lead with `npx dashclaw up`.
- QUICK-START Option A collapses to the one command; `npm run setup` remains documented for contributors working from a clone.
- Ships as CLI 0.5.0 + SDK patch (bin shim) — one publish event, folded into the launch-sprint release tail.

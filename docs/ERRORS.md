# ERRORS.md — repeated failures and their fixes

Newest first. Full entries for multi-attempt debugging or reusable lessons; one-liners for immediate breaks/corrections.

---

## 2026-08-16 — 1,759 interruptions in 7 days; operator disabled every policy in the org

The incident the whole interruption-budget change exists for. Spec:
`docs/superpowers/specs/2026-08-16-interruption-budget-design.md`.

**Symptom.** Wes turned off every guard policy, saying routine actions demanded
approval too often. Live ledger: **1,759 `require_approval` in 7 days** (~251/day),
~zero resolved. All 30 sampled were read-only `git log` scored at the 100 clamp.

**Root cause 1 — a narrow fix taken for a general one.** The 2026-07-01 session fixed
"risk 100 on `git show --format=""`" with `(?<!-)\bformat\b`, which rejects `--format=`
and nothing else. `--date=format:` has `=` before `format`, so the lookbehind passes and
+20 destructive still applied — to every git-log command Wes runs, and to `npm run format`.
The 2026-07-01 memory records that case as *closed*. It was closed for one spelling.
**Lesson: when a false positive comes from a token appearing in a flag, fix the CLASS
(require the destructive object) — a lookbehind on one punctuation character is a patch
for the sample you happened to have.**

**Root cause 2 — an ownership seam between two engines.** `{threshold:100,
action:require_approval, ungrantable:true}` was unreachable by all five relief paths at
once: `ungrantable` blocked grants, precedent and the approval pause; loosening skipped
all `risk_threshold` ("tuning owns it"); and tuning's only move computes
`next = min(100+10, thresholdCap 95) = 95`, then requires `next > current`, so it never
proposed. **Lesson: "engine B owns this type" is a division of labour, not a guarantee of
coverage. Assert reachability, don't infer it — the table of five excluded mechanisms
should have been a failing test, not a discovery made after the user quit.**

**Root cause 3 — the feedback loop ran backwards.** Every relaxation rule gates on
`resolved >= 5` plus an override rate, but volume is exactly what stops a human resolving
anything. 1,759 interruptions produced ~zero resolutions, so every engine read "no
evidence" when the truth was "maximum evidence". **Lesson: if a system's corrective signal
is collected through the same channel as its pain, the correction dies precisely when it
is needed. At least one relief path must key on something observable without the user
doing anything.**

**Fix.** Device-object `format` regex + 3 golden vectors (revert-to-red verified);
`tuningCanMove()` so loosening claims what tuning cannot move; an interruption budget at
policy and command-shape grain that fires on volume alone and downgrades to `warn` (never
`allow`, never `block`, never an `ungrantable` rule).

**Also caught in the same ledger, not fixed here:** two junk grants in the org
(`[Grant] other → =`, `[Grant] other → Date.now()\``) minted from unparsed targets, and
`[Grant] security → C:/Users/` — the exact over-broad prefix grant `policy-shapes.ts`
already warns about in a comment.

---

- 2026-08-16 — Golden-vector additions silently broke `calibration-controller.test.ts` ("expected 122 to be greater than 200") / root cause: that test draws seeds by INDEX from the corpus, so any added vector reshuffles its whole stream, and my new benign-at-80 vector pushed θ up so fewer events got labeled. First fix attempt (doubling stream length) made it WORSE — 122 → 103 — because `labeled` does not scale with length; θ converges upward as benign events are labeled / prevention: the real fault was my vector modeling a read-only `git log` as `irreversible` on `shell` (80) instead of `review`/reversible/`execution` (10) like its sibling `git-show-format-flag`. An honest vector fixed the test as a side effect. When a corpus addition breaks a statistical test, suspect the vector's realism before the test's bounds.

- 2026-08-16 — Repo-wide dead-code audit: `repowise get_dead_code` is not ground truth here / root cause: it reports aliased imports as unreferenced (`app/lib/doctor/checks/*.mjs` `runChecks` is imported by `engine.mjs` as `import { runChecks as databaseChecks }` and was still listed "no importers", confidence 1.0), and its index lagged HEAD by 6 days so it named `app/api/_archive/**` and `app/lib/claude-code/**`, both already deleted / prevention: treat it as a candidate generator only — confirm every finding with a grep against the working tree before deleting anything.

- 2026-08-16 — Removed 10 unused deps; lint, typecheck and the full vitest suite all passed, then `next build` failed on `Module not found: 'react-grid-layout/css/styles.css'` / root cause: the orphan scan resolved JS/TS import specifiers only, and `app/globals.css` pulled the package in through a CSS `@import` / prevention: when dropping a dependency, grep `*.css` for `@import` and bare package refs too. Only the build catches this class — no test imports globals.css.

- 2026-08-16 — Break-on-purpose that did not break: after swapping Discord signature verification to `node:crypto` Ed25519, corrupting the SPKI header's last byte (`...032100` -> `...032101`) left all 11 tests green, which read as "verified" and proved nothing / root cause: that byte is the DER BIT STRING unused-bits count and OpenSSL tolerates it; the key material was unchanged / prevention: break the load-bearing input, not a tolerated framing byte — signing over `rawBody` instead of `timestamp + rawBody` turned 7 of 11 red, which is what actually confirmed the suite covers the accept path.

- 2026-08-14 (amended) — CI-only failure in `policies-inert-banner-reveal.test.jsx`: first diagnosed as a one-shot-read race and "fixed" with `waitFor` — WRONG, it failed again in CI with the retry in place / status: not reproducible locally (0/15 isolated, 0/5 with 120ms-delayed mocks); text renders while the sentences tab reads unselected for >1s, which no single-tree state can produce / action: failure-time DOM diagnostics now ship in the test (tablist count, per-tab aria state, hidden ancestry, text presence) so the next CI failure names the mechanism / lesson: a "flake" fix that only adds retries is a hypothesis, not a fix — it was falsified by the very next run.

- 2026-08-16 (**the diagnostics fired — mechanism now named, still unfixed**) — CI run 31983623709 (commit 146a9917, an unrelated guard change) tripped the flake above and the planted instrumentation printed: `[inert-banner diag] tablists: 1 | tabs: Table=true Sentences=false Groups=false | sentences text still in DOM: true | inert banner present: true`. That kills the "no single-tree state can produce this" framing: there is exactly ONE tablist, Table is selected, Sentences is not, and the sentences text is mounted anyway — so **the sentences content is not gated on the selected tab**, and its presence never proved the lens was active. The `waitFor` on `aria-selected` is therefore waiting on a hash-driven lens switch (the test's own comment: "the click changed the URL hash"), which jsdom delivers unreliably; the text assertion passes regardless, which is why the failure looks contradictory. Two falsifiable candidates for whoever picks this up: (a) the hashchange listener never runs in jsdom, so the lens never switches and only the ungated text makes it look half-switched; (b) it switches, then an async load resolving after the click resets the lens to the Table default — which would be a real product bug (a data refresh discarding the user's lens choice), and is consistent with the v5.17.2 note that `#anchor` cannot reach lens-gated content. Left unfixed deliberately: it sits in the `/policies` component tree, which had uncommitted work from another workstream at the time. Fix (a) vs (b) by asserting on the lens state directly rather than on ungated text.

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

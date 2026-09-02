# ERRORS.md — repeated failures and their fixes

Newest first. Full entries for multi-attempt debugging or reusable lessons; one-liners for immediate breaks/corrections.

---

## 2026-09-01 - `bundles:refresh` on Windows produces a corrupt, incomplete zip that is worse than the committed one (v5.28.0 ship)

**Symptom:** during the v5.28.0 ship, `npm run bundles:refresh` reported every mirrored file "unchanged" but still rewrote all three `public/downloads/*.zip` artifacts with different sizes, so `git status` showed bundle churn that looked like ordinary staleness.

**What it actually was - three defects in the Windows-generated artifact, all of which would have shipped:**

1. **Backslash path separators.** Entries were written as `dashclaw\hooks\dashclaw_pretool.py`. The ZIP spec requires forward slashes; many extractors create a single literal file with backslashes in its name instead of a directory tree, so the downloaded plugin does not unpack correctly.
2. **Build garbage included.** `__pycache__/` directories and roughly 94KB of `.cpython-312.pyc` files were packed in, despite `hooks/` sources being filtered for `__pycache__` elsewhere in the same script (`SOURCE_PATH_RE` excludes it for the *staging* predicate, but the packer did not for the *contents*).
3. **Missing files.** 37 entries versus the committed bundle's 41 - the regenerated plugin zip dropped `.claude-plugin/plugin.json`, `assets/`, `.hermes-plugin/`, `.codex-plugin/`, `.mcp.json`, `PLUGIN_PARITY.md`, and `README.md`.

**Not nondeterminism.** Two consecutive refreshes produced byte-identical output (md5 `13d34d60879bb92ec368005cc08d129b`), which is what ruled out "flaky zip timestamps" and turned this into a real finding. The committed bundles (generated 2026-08-28: forward slashes, 41 files, no `.pyc`) are the *correct* ones.

**Resolution this ship:** the regenerated bundles were discarded (`git checkout -- public/downloads/`) and the good committed artifacts kept. This was safe because the pre-commit hook runs `refresh-bundles.mjs --if-staged`, which only refreshes when a bundle *source* (`hooks/`, `plugins/dashclaw/{.claude-plugin,.codex-plugin,.hermes-plugin,assets,.mcp.json,.mcp-claude.json,PLUGIN_PARITY.md}`, `public/downloads/dashclaw-governance/`) is staged. v5.28.0 staged none of those, so the hook correctly skipped the refresh and did not reintroduce the bad zip.

**Lesson / open item:** `scripts/refresh-bundles.mjs` is not safe to run on Windows and no gate catches it - `bundles:refresh` is trusted to be correct, and its own per-file "unchanged" log actively hides the fact that the *archive* changed. Anyone shipping from Windows must diff `unzip -l` against `git show HEAD:<zip>` before committing a bundle refresh, or run the refresh on Linux/CI. The packer needs forward-slash normalization and a `__pycache__`/`.pyc` exclusion; until then a Windows refresh should be treated as a corrupting operation, not a self-healing one. NOT FIXED in v5.28.0 - the ship carried no bundle-source change, so fixing the packer was out of scope.

## 2026-08-17 — a real domain purchase executed unguarded; four independent gates all missed

A Namecheap `purchase_domain` through the offlocal MCP returned `decision: allow`,
`executed: true`, and only failed on `INSUFFICIENTFUNDS`. A funded balance would have spent
real money with no prompt. Four things had to fail together, and each alone was sufficient.

**Root cause 1 — the rule was a deny-list of spellings.** The org's one active policy,
"Real-money spend requires human approval of the exact amount", enumerated eleven
`action_types` (`payment`, `purchase`, `domain_purchase`, …). offlocal names the act
`provider_purchase` (`src/dashclaw/guard.ts`), which is not among them, so `matchActionType`
returned null and `matched_policies` came back empty. An exact-string miss, not a threshold
or scoping problem. **Lesson: enumerating action-type spellings protects against the strings
someone remembered and nothing else. Match on the capability the caller declares.**

**Root cause 2 — `metadata` was stripped before the engine ever saw it.** offlocal *does*
send `metadata.capability: "purchase"`, but `metadata` was absent from `GUARD_INPUT_SCHEMA`
(`app/lib/validate.js`), so `validate()` dropped it. This is the third time that schema has
silently no-op'd a governance signal — the `intel`/`tool` entries carry a comment about the
same failure. **Lesson: in this codebase, a field not in GUARD_INPUT_SCHEMA does not exist.
Adding a policy that reads a new context field is a two-file change, always.**

**Root cause 3 — the local backstop was structurally unreachable.** offlocal's own policy
resolved to `approval_required` (`src/policy.ts` even clamps purchase: "can never resolve
below approval_required"). It never gated. In `runGuarded`, `if (risky) { … }` returns on
every path, and the local `block` / `approval_required` checks sat *below* it — with
`isRiskyAction` being `live || capability !== "read"`, the local policy governed reads only.
Its effect travelled to DashClaw as metadata, i.e. telemetry. **Lesson: an invariant asserted
in one function and enforced in another is only as real as the control flow between them.
The clamp was correct and unreachable, which reads exactly like working code.**

**Root cause 4 — both risk-100 backstops were paused.** The action scored 100 and two
`risk_threshold` policies sit at exactly 100 (`riskScore >= threshold`, so either would have
fired). Both had `active: 0`. **Lesson: a paused backstop is not a backstop. The only thing
between the agent and the charge was a toggle.**

Fixes: `contextActionTypes` now folds `metadata.capability` into the match set for
restrictive policies only (additive, so a spoofed capability can add a gate but never remove
one); `metadata` added to `GUARD_INPUT_SCHEMA`; offlocal gives local policy a veto over a
DashClaw `allow` for `purchase` specifically, matching the clamp already in `policy.ts` and
adding no approval traffic to any other capability; both live policies re-armed. Verified by
replaying the original payload against my-dashclaw: `require_approval`, both policies matched.

---

## 2026-08-16 (later) — the same incident had two MORE root causes, both in command parsing

Follow-up to the entry below. That session fixed the server-side `format` regex and the
engine ownership seam, then recorded a next-move: "fix the hook's action-type mapping so
read-only `git log` classifies as `review` (base 10) rather than `apply` (base 60)". The
mapping was already correct (`readonly -> review`). Two parsing bugs upstream of it were
producing the wrong intent in the first place.

**Root cause 3 — a git global flag before the subcommand blanks the subcommand.**
`_parse_segment` read the subcommand as "the first token after the tool that does not
start with `-`". `git -C "C:/Projects/x" log` therefore parsed with `subcommand=None`, and
`_classify_git`'s last line is `return "write"` — the safe default for an *unknown*
subcommand. So a read-only log graded `write` -> action_type `apply` -> **server base 60**.
Every command in the incident ledger has that exact `git -C <path> log` shape. The
"apply, base 60" in the previous session's notes was this, not the action-type map.
**Lesson: a safe default is only safe where it fires on genuinely unknown input. Reached
by a parse gap, "unknown -> treat as write" silently mislabels the most common command in
the repo, and the miscalibration is invisible because the fallback looks conservative.**

**Root cause 4 — an unlisted wrapper shadows everything it wraps.** `rtk` (a
token-compression proxy installed as a PreToolUse hook that rewrites EVERY Bash command
to `rtk <cmd>`) was not in `WRAPPERS`, so the parser reported `rtk` as the base command,
the classifier graded `unknown`, and the hook floors `unknown` at the Bash tool's blunt
base risk of **70**. On a machine running rtk that applied to all Bash traffic at once.
Both directions were wrong: `rtk git log` graded 70 instead of 5, and `rtk rm -rf /`
graded 70 instead of destructive 100 — a prefix that defeats the destructive classifier.
`app/lib/policy-shapes.ts` already listed `rtk` as a wrapper word for shape keys, so half
the runtime knew and the half that grades risk did not.
**Lesson: when one layer learns a fact about the world (this token is a wrapper), grep for
the other layers that encode the same fact. Here there were four independent wrapper lists
— command_parser WRAPPERS, evidence.ts TRANSPARENT_PREFIX_RE, policy-shapes
SHAPE_WRAPPER_WORDS, and the classifier's PowerShell verb map — and they disagreed.**

**Root cause 5 (process) — a golden vector was committed RED and stayed red.**
`git-log-date-format-flag` was added as part of the previous fix asserting
`intent: readonly`; the classifier returned `write` from the moment it landed. A second
vector, `npm-run-format-script`, asserted a client-side `max_risk` of 25 on the premise
that the word `format` inflated the client score. It never did: `npm run format`,
`npm run build` and `npm run lint` all score 30 identically, because 30 is
package_management's ordinary base. That vector asserted a mechanism that does not exist
on the side it was pinned to, and was also red from day one.
**Lesson (L1, again): a check is not verified until it has been observed both passing AND
failing. A vector added in the same commit as the fix it describes must be RUN before the
commit — otherwise it documents an intention rather than testing a behaviour.**

**Fixes.** Wrapper + subcommand parsing in `hooks/dashclaw_agent_intel/command_parser.py`
(mirrored to `.claude/hooks/` and, via `bundles:refresh`, to `plugins/dashclaw/`); `rtk`
added to `TRANSPARENT_PREFIX_RE` in `app/lib/guard/evidence.ts`, closing the same
quoted-command-word bypass server-side; `npm-run-format-script`'s client expectation
corrected to 30 with the evidence recorded in its `source`. `git -C <path> log` now grades
readonly/5 -> `review`/10 end to end, down from 70.

**Still open (not fixed here):** whether `npm run <script>` deserves a lower base than
`npm install` — both are 30 today. That is a live calibration question, not part of this
incident, and it moves risk for every npm command in every org, so it is Wes's call.

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

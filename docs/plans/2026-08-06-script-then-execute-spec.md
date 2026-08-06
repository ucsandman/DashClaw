# Spec — Script-then-execute composition detection

**Status:** IMPLEMENTED — shipped 2026-08-06 (v5.9.0). Module
`hooks/dashclaw_agent_intel/written_paths_ledger.py`; tests
`hooks/tests/test_written_paths_ledger.py` + `hooks/tests/test_script_then_execute.py`;
E2E canary verified live (the §1 repro blocks at 100; the canary survives).
Implementation deviations from this spec, all deliberate:
- **No Stop-hook ledger deletion (§3.1 hygiene line):** the Stop event fires per
  *turn*, not per session, and no SessionEnd hook exists — deleting per turn would
  break cross-turn write→execute detection. TTL + the 500-entry LRU cap bound the
  state instead (same posture as the containment session file).
- **Lookup gained a separator-stripped alias (§4):** the bash tokenizer treats `\`
  as an escape, so a Windows path in a command reaches the parser with separators
  stripped (`C:\tmp\x.sh` → `C:tmpx.sh`). The ledger matches that alias and
  returns the real recorded path for grading.
- **`_INTERPRETER_DESTRUCTIVE_RE` (§3.3) exists as `_INLINE_ESCAPE_HATCH_RE`** in
  the classifier; same shape family, used as specified.
- **Shell device-write content inherits the inline grade (85, block band)** rather
  than the §3.3 "100" figure — inheritance is the spec's own core principle; the
  100 applies to the interpreter-content path (`_RAW_DEVICE_WRITE_RE`).
- **Classifier signals got a small render block** in `/decisions/[actionId]`
  (PoliciesTab) — §3.4 assumed validations were already visible there; they were
  persisted but never rendered, for all validations, so the "visible in its
  signals" acceptance required it.
**Provenance:** the single remaining item of the 2026-08-05 governance gap audit
(`docs/plans/2026-08-05-governance-gap-audit.md`, F2 composition case). Every pattern
finding F0–F6 closed v5.7.0–v5.8.2; this is the one shape that is architecture, not regex.
**Layer:** Claude Code hooks (`hooks/dashclaw_pretool.py`, `hooks/dashclaw_posttool.py`,
`hooks/dashclaw_agent_intel/`). No server change required (see §6).

---

## 1. The hole

Two individually-benign tool calls compose into a destructive one:

```
Turn 1  Write  C:\tmp\x.sh          content: "rm -rf /c/Users/sandm"   → apply, low risk, allow
Turn 2  Bash   bash C:\tmp\x.sh                                        → execution base, allow band
```

The guard graded the *write* (a file write to a non-sensitive path) and the *execute*
(an interpreter invoking a script path), but never the *payload as a command*. Every
shape closed in v5.8.2 (`find -delete`, interpreter one-liners, device writes, pipe-to-shell)
is visible in a single command string; this one is split across tool calls, so no
per-call classifier can see it. Server-side detection is impossible by construction:
the guard API is stateless per request; only the harness-side hook observes both calls.

## 2. The design constraint that shapes everything (F5 lesson)

**Write-then-execute is normal, high-frequency agent behavior.** Scratch scripts,
`git commit -F msg.txt`-style file-mediated payloads, generated test runners, build
helpers — the maintainer's own workflow does this many times per session. The audit's
F5 finding (and the F3 posture amendment) proved what happens to a gate that blocks
routine legitimate work: it gets switched off.

Therefore the composition signal (this session wrote the file it is now executing)
must **never itself escalate risk**. It is a *routing* signal: it tells PreToolUse
which executes deserve a content grade they otherwise never get. The escalation, if
any, comes from grading the script's **content** with the same classifiers that
already grade inline commands — so `bash cleanup-build.sh` (contents: `rm -rf .next dist`)
stays in the cleanup/allow band exactly as the inline command would, and
`bash x.sh` (contents: `rm -rf /c/Users/sandm`) grades block/100 exactly as the
inline command does post-v5.7.1.

One mechanism, two properties: no new false-positive class, and the grade inherits
all existing calibration (F5 path-awareness, bounded-rm, regenerable-artifact,
device-write hard-block) for free.

## 3. Mechanism overview

```
PostToolUse (write side)                       PreToolUse (execute side)
────────────────────────                       ─────────────────────────
successful Write/Edit/NotebookEdit             _enrich_bash() parses command
  → record file_path                           → extract executed-path candidates
successful Bash/PowerShell with                → normalize, look up session ledger
  redirect / tee / heredoc target              → hit (TTL-fresh)?
  → record redirect target                        → read file from disk (capped)
    ↓                                             → grade content via existing
  written-paths ledger                              classifiers
  (per-session temp file,                         → risk = max(risk, content grade)
   instance-suffixed)                             → validation: script_then_execute
                                                  → target = script path
```

### 3.1 Session ledger (state)

A per-session JSON temp file, following the exact precedent of
`_containment_session_state_path()` in `dashclaw_pretool.py`:

- **Path:** `<tempdir>/dashclaw_written_paths_<INSTANCE_STATE_SUFFIX>_<safe_session_id>.json`
  — instance-suffixed so co-installed hook instances never read each other's state,
  session id sanitized via the existing `_safe_session_id()`.
- **Shape:** `{"entries": [{"path": "<normalized>", "at": <epoch_s>}, ...]}`.
  Path only + timestamp — **no content is stored** (content is read from disk at
  execute time, see §3.3; a write-time snapshot would be stale after Edits and is
  the TOCTOU-shaped mistake).
- **Bounds:** max 500 entries, LRU eviction; entries older than the TTL are dropped
  on every read and write. TTL default **60 minutes**, env-tunable
  `DASHCLAW_SCRIPT_EXEC_TTL_MINUTES` (goes in `.env.example`).
- **Hygiene:** `dashclaw_stop.py` deletes the ledger at session end (best-effort).
  All ledger I/O is fail-soft (`_log_hook_error` pattern) — a corrupt or unwritable
  ledger degrades to pre-spec behavior, never breaks the harness.

### 3.2 Recording (PostToolUse)

Record in `dashclaw_posttool.py::main()` after the outcome PATCH (the hook firing is
proof the write executed; in enforce mode a blocked write never reaches PostToolUse,
so blocked writes are naturally excluded):

| Tool | Recorded path |
|---|---|
| `Write`, `Edit`, `NotebookEdit` | `tool_input.file_path` (or `path`) |
| `Bash`, `PowerShell` | every redirection target from `parse_command()` (`>`, `>>`), plus `tee` targets |

Notes:
- `tool_input` is present on PostToolUse stdin alongside `tool_response`.
- Heredoc writes (`cat > x.sh <<EOF`) are covered by the redirect target; the heredoc
  body itself is irrelevant because content is read from disk at execute time.
- `curl -o x.sh` / `wget -O x.sh` download-writes: record `-o`/`-O` flag values for
  these two known downloaders. This closes `curl -o x.sh && bash x.sh` (the split-form
  sibling of pipe-to-shell, which v5.8.2 already blocks). Other flag-value writers are
  residual (§7).

### 3.3 Detection + escalation (PreToolUse, `_enrich_bash`)

After `classify_bash()` and before the final score clamp:

1. **Extract executed-path candidates** from `parse_command()` output, per chained
   segment:
   - the program token itself when it is a path (`./x.sh`, `/tmp/x.sh`, `C:\tmp\x.ps1`);
   - the first target when the program is an interpreter: `bash`, `sh`, `zsh`, `dash`,
     `python`/`python3`, `node`, `ruby`, `perl`, `pwsh`/`powershell` (`-File` value),
     `cmd` (`/c` value when it is a path);
   - the target of `source` / `.`.
2. **Normalize** (§4) and **look up** the ledger. Miss or TTL-expired → done, zero
   behavior change.
3. **On hit:** read the file from disk, capped at **256 KB** (beyond the cap, treat as
   unreadable). Grade the content:
   - `.sh`/`.bash`/no-extension/shebang-shell → run each non-comment line through
     `classify_bash()`; take the max risk and its validations. This inherits every
     existing calibration: F5 path-aware `rm`, bounded/regenerable cleanup downgrade,
     `find -delete`, device-write always-block, interpreter one-liners.
   - `.py`/`.js`/`.mjs`/`.ts`/`.rb`/`.pl` → apply `_INTERPRETER_DESTRUCTIVE_RE` /
     `_RAW_DEVICE_WRITE_RE` shape checks against the content (same grades as the
     v5.8.2 one-liner path: security/80 for unparsed-target deletes, 100 for raw
     device writes). No attempt to interpret the program (§7).
   - `.ps1` → `classify_bash()` line-wise (the classifier already understands
     Verb-Noun cmdlets).
4. **Escalate:** `risk_score = max(risk_score, content_grade)`; append validation
   `script_then_execute` (plus the content grade's own validations, prefixed
   `script_content:`); set `target` to the normalized script path so `protected_path`
   policies can match it; forward through the existing `intel.bash.validations` seam
   so the signal lands on the recorded action and is auditable in `/decisions`.
5. **Unreadable / oversized / unparseable content on a ledger hit:** floor the score
   at **60** (review band) with validation `script_then_execute_unreadable`. Rationale:
   a recently-self-written executable whose content cannot be inspected is exactly the
   evasion shape (e.g. self-deleting or oversized payloads), but a hard block would
   false-positive on large legitimate generated scripts — review band surfaces it
   without stopping the world.

### 3.4 What the operator sees

No new UI surface — the signal rides existing ones (explicit decision, HUMAN-EXPERIENCE
§"API-only is a recorded decision"): the escalated action appears in `/approvals` /
`/decisions` like any other graded action, with `script_then_execute` visible in its
signals and the script path as `target`. The docs ship (`hooks/README.md` threat-model
section gains a composition paragraph; classifier-coverage claims updated) in the same
release as the implementation.

## 4. Path normalization

Both sides normalize identically (single shared helper in `dashclaw_agent_intel/`):

1. Strip surrounding quotes.
2. Map Git Bash drive form `/c/Users/...` ↔ `C:\Users\...` (both directions; the
   Write tool records Windows form, Bash may execute the POSIX form).
3. Resolve relative paths against the hook stdin `cwd` (both hooks receive it).
4. `os.path.normpath` + best-effort `os.path.realpath` (symlink/8.3-name resolution;
   failure falls back to normpath).
5. `str.casefold()` on `win32` (case-insensitive filesystem).

Ledger keys and lookup keys are the post-normalization strings.

## 5. Explicit non-goals (decisions, not oversights)

- **No blanket escalation of write-then-execute.** §2. The composition routes a
  content grade; it never adds risk by itself.
- **No `chmod +x` tracking.** The write is the recording trigger; execute-bit changes
  add no information the ledger doesn't already have.
- **No write-time content snapshotting.** Disk-read at execute time grades the bytes
  that will actually run, surviving Edit-accumulation and rewrites.
- **No cross-session correlation.** Write in session A, execute in session B evades
  the ledger. Accepted: session-scoped state is the entire mechanism; cross-session
  state is a different (server-side, privacy-heavy) architecture. TTL bounds the
  window inside a session.
- **Hook-side only.** SDK/MCP-governed agents calling the guard API directly get no
  composition detection — the server is stateless and those agents self-declare.
  Recorded limitation, same class as the F3 privilege boundary.
- **No program interpretation.** Content grading is shape-matching (regex/classifier),
  not execution or AST analysis. `python x.py` where x.py builds `"rm -rf " + path`
  at runtime is out of scope — permanent ceiling, seatbelt-not-cage framing per F3.

## 6. Server-side: deliberately untouched

`app/lib/guard/evidence.ts` takes `max(server base, client score)` for shell acts, so
a hook-side escalation to 80/100 propagates into the guard decision with **zero server
changes**. Validations ride the existing `intel` passthrough and are recorded on the
action. If a later pass wants the server to *independently* recognize the signal
(e.g. a dedicated `composition` modifier for analytics), that is an additive follow-up,
not part of this spec.

## 7. Residual evasions (documented, per the honesty-pass rule)

- Writer tools not recorded: arbitrary programs that write files via flags the parser
  doesn't model (`dd of=x.sh` is device-write-graded anyway; obscure `--output` flags
  are not). §3.2 covers the two ubiquitous downloaders only.
- Indirection: `bash $(cat pointer.txt)`, `eval "$(< x.sh)"` — the executed path never
  appears as a parseable token. (`eval`/command-substitution already carry their own
  grading in the classifier.)
- Encoded/self-decoding payloads, or content swapped by a *different* uncorrelated
  process between grade and execute (TOCTOU is narrowed to the exec-time disk read,
  not eliminated).
- Sub-agent splits: agent A writes, agent B executes in a different harness session.

None of these weaken the seatbelt claim; all are inside the documented privilege
boundary (the agent that wants to evade its governor can, by design, until the
operator adds the container/OS-user isolation rung from `hooks/README.md`).

## 8. Test plan

- **Unit — ledger** (`hooks/tests/test_written_paths_ledger.py`): record/lookup
  round-trip; normalization equivalences (`/c/Users/X` ≡ `C:\Users\X` ≡ relative-from-cwd,
  case-insensitive on win32); TTL expiry; LRU cap at 500; corrupt-file fail-soft;
  instance-suffix isolation.
- **Unit — detection** (`hooks/tests/test_script_then_execute.py`), table-driven like
  `TestF2CoverageBacklog`:
  - `Write x.sh` (destructive content) → `bash x.sh` escalates to the inline grade
    (block band) with `script_then_execute` validation.
  - Same via `./x.sh`, `source x.sh`, `python x.py`, `pwsh -File x.ps1`, heredoc-written
    script, `curl -o`-written script.
  - **False-positive pins:** `bash cleanup.sh` (contents `rm -rf .next dist`) stays
    cleanup/allow; a script the session did *not* write gets zero escalation; a
    ledger-hit script with benign content gets zero escalation.
  - TTL-expired entry → no escalation. Unreadable hit → floor 60 + `_unreadable`
    validation.
- **E2E canary** (manual, like the F2 verification): with the hook armed in enforce,
  write a script that would delete a canary directory outside a regenerable root,
  execute it, and confirm the block fires and the canary **survives** — the
  audit-established standard: a logged verdict is not proof of enforcement.
- **Perf guard:** the ledger lookup adds one temp-file read per Bash call; the
  disk-read + content grade runs **only on a ledger hit**. Assert the miss path adds
  <5 ms (the v4.73.0 hot-path budget).

## 9. Acceptance criteria

1. The §1 repro (write destructive script → execute) grades ≥ the inline-command grade
   for the same payload, in both the local hook score and the recorded guard decision.
2. All §8 false-positive pins pass — no new warn/block on routine script workflows.
3. `script_then_execute` is visible in the recorded action's signals in `/decisions`.
4. Full gates green (`hooks/tests` via pytest, `npm run lint`, `npx vitest run`);
   no server diff.
5. Docs updated in the same ship: `hooks/README.md` threat model, audit doc F2 note
   flipped to resolved-by-implementation, coverage claims wherever the v5.8.2 shapes
   are enumerated.

## 10. Estimate

Small-medium hook release (~1 day): one new module (`written_paths_ledger.py`,
~150 lines), ~40 lines in PostToolUse, ~80 lines in PreToolUse `_enrich_bash`,
two test files. No schema, no server, no UI. The risk concentrates in path
normalization edge cases on Windows — which is why §4 mandates one shared helper
and equivalence tests rather than two inline implementations.

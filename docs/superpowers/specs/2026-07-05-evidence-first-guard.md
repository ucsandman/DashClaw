# Evidence-first guard (v4.63.0)

**Status:** approved by owner 2026-07-05 ("yes I want it built").
**Problem:** on the SDK/MCP path every guard input (`action_type`, `risk_score`,
`declared_goal`) is self-declared. A prompt-injected or misaligned model authors its
own declaration, so guard evaluates fiction. The hook path doesn't have this hole
because developer-controlled code classifies the *actual tool call* — but that
classification is client-side too (`hooks/dashclaw_agent_intel/`), so even hook
decisions are trust-the-client.

**Fix shipped here:** let callers attach the actual act (`shell` command, `http`
request, `sql` statement, `file` write) to `guard`; the **server** classifies it and
folds the derived risk in. Decisions record whether they were graded from evidence
or from declaration, policies can demand evidence, and posture reflects the mix.

**Threat model honesty (goes in docs):** evidence mode defeats a lying *model*
(the wrapper, not the LLM, authors the payload). It does not defeat a lying
*developer* — only credential custody (capability registry) does. Do not claim
otherwise anywhere.

## Non-goals

- No LLM in the classifier. Deterministic, synchronous, in-process (guard deadline
  is 3.5s; the classifier budget is microseconds).
- No universal proxy. The enforcement-boundary ADR's rejection stands.
- No parity with the full Python bash classifier in v1. Honest subset, documented.
- Act-hash grant binding is a separate release (already on the follow-up list).

## 1. Wire contract

New optional `act` field on `POST /api/guard` (add to `GUARD_INPUT_SCHEMA`,
`app/lib/validate.js:278`):

```jsonc
"act": {
  "kind": "shell" | "http" | "sql" | "file",
  // exactly one payload family per kind:
  "command": "string ≤8192",                   // shell
  "request": {                                  // http
    "method": "GET|POST|PUT|PATCH|DELETE|...",
    "url": "string ≤2048",
    "body_excerpt": "string ≤4096"              // optional
  },
  "statement": "string ≤8192",                  // sql
  "file": { "path": "string ≤1024", "content_excerpt": "string ≤4096", "bytes": int }
}
```

Total serialized `act` capped at 16KB — reject larger with 400 `ACT_TOO_LARGE`.
Kind/payload mismatch is a 400. **Verify** whether `validateGuardInput` rejects
unknown keys; if it does, older-server compatibility requires SDKs to tolerate a
validation error by retrying once without `act` (log a warning). If unknown keys
are ignored (expected), no fallback needed — confirm and note in the SDK docs.

## 2. Server classifier — `app/lib/guard/evidence.ts` (new)

`classifyAct(act): EvidenceClassification | null`

```ts
type EvidenceClassification = {
  derived_action_type: string;   // existing action_type vocabulary
  base_risk: number;             // 0-100
  modifiers: { reason: string; delta: number }[];
  reversible_hint: boolean | null;
  flags: string[];               // e.g. 'destructive', 'whereless_update', 'sensitive_path'
};
```

Intent→action_type mapping mirrors the hook's `_INTENT_TO_ACTION`
(`hooks/dashclaw_pretool.py:152-162`) so policies behave consistently across
surfaces: destructive→security, write→apply, network→api, deploy→deploy, etc.

Per-kind rules (port selectively from `hooks/dashclaw_agent_intel/bash_classifier.py`
— it is the reference, keep names recognizable):

- **shell**: chain-split on `&&`, `;`, `|`; classify the *highest-risk* segment.
  Families: destructive (`rm -rf`, `dd`, `mkfs`, `truncate`), vcs-dangerous
  (`push --force`, `reset --hard`, `clean -fd`), deploy (`vercel --prod`,
  `kubectl apply`, `terraform apply`), package (`npm i`, `pip install`),
  network-exec (`curl … | sh`, `wget … | bash`), secret-exposure (`env`,
  `printenv`, `cat .env`), privilege (`sudo`). Unrecognized → `execute`, base 30.
- **http**: method base (GET/HEAD 10, POST/PUT/PATCH 45, DELETE 65) + host bumps
  (payment/cloud-admin/registry hosts +20; localhost/127.x −10). Copy the url into
  `context.target` when the caller didn't set one, so `protected_path`/binding
  policies see it.
- **sql**: SELECT 10, INSERT 35, UPDATE 45, DELETE 60, DDL (DROP/TRUNCATE/ALTER) 75.
  UPDATE/DELETE without WHERE → +20 and flag `whereless`.
- **file**: sensitive-path patterns (reuse the server's existing protected-path and
  `scanSensitiveData` machinery from `app/lib/security.js` for the excerpt);
  writes to `.env`/keys/CI config bump; append `path` to `context.write_paths` if absent.

Pure function, no I/O, unit-testable in isolation.

## 3. Risk fold + mismatch (in `app/lib/guard/risk.ts` / `evaluate.ts`)

- New term in the assessment: `evidence_derived = base_risk + Σ modifiers`.
- Fold: `effective = max(existing_effective, evidence_derived)` — **evidence only
  raises, never lowers** (trust-model D1; a benign-looking payload must not launder
  a high declared risk).
- **Mismatch:** if `derived_action_type !== declared action_type` and the derived
  base risk is higher, evaluation proceeds with the *derived* action_type for
  policy matching, sets `evidence_mismatch: true`, adds a `+10 declared/derived
  mismatch` modifier, and the reason string names both types.
- Breakdown: add `evidence_derived` terms to `RiskBreakdown` (`risk.ts:96-127`).
  **Breakdown stays a sibling — nothing new enters any hashed or signed vector**
  (score-provenance invariant).
- `intent_source: 'evidence' | 'declared'` computed once, persisted inside the
  decision `context` JSON (no migration), and returned in the guard response
  along with `derived_action_type` and `evidence_mismatch` when present.
  **Grading rule (hardened during security review):** `'evidence'` only when
  the derived action_type IS the type the evaluation ran under — equal to the
  declared type, or swapped in on mismatch. A trivial unrelated act (declared
  `deploy` + `echo hi`) must not satisfy `require_evidence`. Callers align by
  declaring the type the classifier derives; the response's
  `derived_action_type` tells them what that is.
- Act payload is redacted via `redactAny` before persistence; store only the
  capped excerpts, never headers.

## 4. `require_evidence` policy type (17th)

- `POLICY_TYPES` + `POLICY_TYPE_VALIDATORS` (`app/lib/validate.js`), evaluator in
  `POLICY_EVALUATORS` (`app/lib/guard/policy.ts:440`), modeled on
  `non_fabrication`'s fail-closed template.
- Rules: `{ "action_types": string[] /* empty = all */, "enforcement":
  "warn" | "require_approval" | "block" }`.
- Semantics: if the incoming call's action_type (declared, or derived when
  mismatched) matches and `intent_source !== 'evidence'`, raise the decision to
  `enforcement` via `raiseDecision` (never downgrade).
- Policy builder gets it as the **10th pre-built safety switch** ("Evidence
  Required") — every "nine pre-built safety switches" citation updates (README,
  wherever check-doc-counts and grep find it), and any "16 policy types" count → 17.

## 5. SDK surface

**Node (`sdk/dashclaw.js`), +2 methods (147 → 149):**
- `guard(context)` unchanged; `context.act` passes through (it already spreads).
- `runGoverned(act, params, fn)` — one call that does guard (with `act`) →
  `createAction` (via `?record=true` semantics or explicit create; follow the
  existing loop) → on allow/warn runs `fn()` → one-shot outcome (success/failure).
  Throws `GuardBlockedError` on block; waits on `require_approval` if
  `params.wait !== false`.
- `guardedFetch(url, init, params?)` — derives `act: {kind:'http', request:{method,url,body_excerpt}}`,
  runs the loop around a real `fetch`.
- **Client-side scrub before send:** strip `Authorization`/`Cookie`/`x-api-key`
  headers, mask `oc_live_*`/`sk-*`/bearer-token/`password=`-style substrings in
  command/body excerpts. Small pure helper + unit test; server still re-redacts.

**Python (`sdk-python/dashclaw/client.py`), +1 method (233 → 234):**
- `guard` passes `act` through (already spreads).
- `run_governed(act, params, fn)` — parity with Node semantics, snake_case.
- Same scrub helper.

**MCP (`mcp-server/src/tools.ts`):** add `act` to `dashclaw_guard`'s inputSchema
and to the explicit field-by-field forwarder (`tools.ts:674-706`). Tool count
unchanged.

**Hook (`hooks/dashclaw_pretool.py`):** attach `act` in `_build_guard_context` —
Bash → `{kind:'shell', command}` (capped), Write/Edit → `{kind:'file', ...}` — so
hook-path decisions become evidence-graded server-side too (defense against a
tampered hook environment; the server re-derives).

## 6. Posture

`enforcement` dimension: decisions whose persisted context carries
`intent_source: 'evidence'` grade fully; declared-only decisions grade at 0.5 of
their current value (`gradeCoverage`, `app/lib/posture/model.ts:43`). Posture reads
the same decision rows it already replays — no new query shape. The posture page
shows the evidence/declared mix on the enforcement dimension detail.

## 7. HUMAN-EXPERIENCE answers (contract, four questions)

1. **Where does a human SEE it?** (a) Decision Replay (`app/replay/[actionId]`):
   new "Intent source" row — Evidence (with kind + redacted excerpt + derived vs
   declared type when mismatched) or Declared. (b) `/posture`: enforcement
   dimension shows the evidence/declared mix. (c) `/policies` builder: the
   "Evidence Required" switch.
2. **Is it discoverable?** Replay is reached from the decisions ledger humans
   already use; posture and the policy builder are existing nav surfaces. The
   marketing landing's enforcement-boundary section gains one sentence covering the
   evidence tier (ships same release, `.impeccable.md` bar, CSS tokens only).
3. **Is every human step a CLICK?** Yes: enabling enforcement = toggling the
   "Evidence Required" switch in the builder; reviewing = reading Replay; no
   terminal steps in any human role.
4. **Verified rendered?** frontend-verify against Replay (a seeded evidence
   decision), /posture, and /policies before ship.

## 8. Verification gates

- Unit: classifier per-kind vectors (incl. adversarial: benign-looking declared +
  destructive act; destructive declared + benign act must NOT lower); schema
  validation caps; mismatch fold; `require_evidence` evaluator matrix
  (match/no-match × evidence/declared × warn/approval/block); SDK scrub helper;
  MCP forwarder passthrough.
- `__tests__/unit/guard-risk-breakdown.test.js` extended for the new terms;
  characterization tests must show **zero behavior change when `act` is absent**.
- Policy smoke (`scripts/policy-smoke.mjs`): new block — declared `read` +
  `act: {kind:'shell', command:'rm -rf /prod-data'}` must classify high, flag
  mismatch; with the Evidence Required switch on, a declared-only `deploy` call
  must escalate.
- Full gates: lint, FULL vitest, `next build`, `npm run typecheck`,
  `check-doc-counts --strict`, contract checks.
- Adversarial security review before push (guard path = risk-bearing).

## 9. Docs (same release)

README (integration section + safety model item + counts), sdk/README +
sdk-python/README (new methods + counts), `docs/architecture/enforcement-boundary.md`
(new "evidence-graded" row between mechanical and cooperative — with the threat-model
honesty paragraph), QUICK-START loop step, CHANGELOG, marketing landing sentence.

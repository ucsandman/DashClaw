# External Verdict Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the DashClaw side of the external policy verdict provider seam — provider call in the guard, monotonic stricter-wins join, failure posture, `_external_verdict` evidence, `/policies` config form, posture badges — against the frozen v1 wire contract.

**Architecture:** A new `app/lib/guard/external-verdict.ts` module owns config, the provider call (safeFetch + hard timeout), verdict mapping, and evidence assembly. `evaluate.ts` calls it inside `runEvaluation` after `runWebhookPolicies` and before the grant post-passes (mirroring the calibration controller slot), applies the join via the existing `raiseDecision` tighten-only primitive, and threads evidence into `buildGuardDecisionRow` as a `_external_verdict` sibling. Config rides the existing org-settings key/value path and its hot-path cache.

**Tech Stack:** Node/TypeScript, Next.js 16 App Router, vitest, existing guard internals (`sevOf`, `raiseDecision`, `digestJson`, `safeFetch`).

**Spec:** `docs/rfcs/2026-08-13-external-policy-verdict-input.md` (ACCEPTED, contract FROZEN). Test matrix: the ten adversarial cases from issue #220 (reproduced in Task 3).

## Global Constraints

- Verdict lattice: `allow < warn < require_approval < block` (`DECISION_SEVERITY` in `app/lib/guard/internal.ts`; `allow_contained` sits at 2 and is never produced by mapping).
- Provider verdict map: `allow→allow`, `warn→warn`, `escalate→require_approval`, `deny→block`. Anything else (e.g. `transform`) = unsupported → failure posture (RFC §3, #220 case 8).
- E1 monotonicity: join only ever raises, via `raiseDecision` — no code path may lower `acc.highestDecision`.
- E2: external `deny` → `block` is absolute; no grant/approval/calibration downgrade (pinned by test).
- E3: response `input_identity` must equal the value DashClaw computed and sent; mismatch discards the verdict → failure posture.
- Failure posture: `fail_closed` (default) → `require_approval` with reason `external_unavailable`; `fail_open` → local-only. Either way evidence says `external_unavailable`, never a fake success.
- No provider configured → behavior and output byte-identical to today (#220 case 10): no `_external_verdict` key, no fetch.
- Hot-path budget: call budget = `min(configured timeoutMs, remaining deadline − 600ms margin)`; skip (posture failure kind `budget`) if < 100ms. Never hang a decision.
- Outbound fetch ONLY via `safeFetch` from `app/lib/url-safety.ts` (https-only, private-IP + DNS-rebind rejection, manual redirect).
- Surface budget: zero new API routes, SDK methods, MCP tools, policy types. Config = org-settings keys.
- `_external_verdict` is a `context` sibling in `guard_decisions` — NEVER folded into `riskBreakdown` / `risk_score`.
- No hex values in UI; use existing `Badge` variants and CSS tokens. Read `.impeccable.md` before UI tasks.
- Skip the provider call under `options.simulate` (same as webhook policies).
- SHARED-TREE HAZARD: `app/lib/repositories/settings.repository.ts` carries someone else's unstaged `DASHCLAW_APPROVAL_PAUSE` hunk (~line 101-105) and `__tests__/unit/approval-pause.route.test.js` is untracked foreign work. Place new keys AWAY from that hunk (end of `VALID_SETTING_KEYS`), stage with `git add -p`, never `git add -A`.

## Settings keys (Task 1 defines, later tasks consume)

All category `general` so they ride the existing single cached `loadGeneralSettings` read:

| Key | Value | Encryption (via `shouldAutoEncrypt` suffix rules) |
|---|---|---|
| `EXTERNAL_VERDICT_ENABLED` | `'true'`/`'false'` | plaintext |
| `EXTERNAL_VERDICT_PROVIDER` | display/provenance id, e.g. `agent-memory-pama` | plaintext (deliberately NOT `_ID` suffix — that auto-encrypts) |
| `EXTERNAL_VERDICT_PROVIDER_URL` | https endpoint | auto-encrypted (`_URL` suffix), AAD `${orgId}:EXTERNAL_VERDICT_PROVIDER_URL` |
| `EXTERNAL_VERDICT_AUTH_TOKEN` | bearer token, optional | auto-encrypted (`_TOKEN`) |
| `EXTERNAL_VERDICT_TIMEOUT_MS` | integer string, default `'1200'`, clamp 100–5000 | plaintext |
| `EXTERNAL_VERDICT_POSTURE` | `'fail_closed'` (default) / `'fail_open'` | plaintext |

Decrypt-on-read pattern (from `app/lib/actionAlerts.ts:76-79`): `row.encrypted ? decrypt(row.value, \`${orgId}:${KEY}\`) : row.value`.

## Wire contract (frozen — document verbatim in Task 6)

Request (POST, `content-type: application/json`, optional `authorization: Bearer <token>`):

```json
{
  "request_id": "evr_<uuid>",
  "org_id": "org_x",
  "agent_id": "agt_x",
  "action_type": "http_request",
  "declared_goal": "...",
  "act": { "kind": "http", "...": "the same redacted act/context the guard audit row stores" },
  "input_identity": "sha256:<base64url>"
}
```

`input_identity = digestJson({ org_id, agent_id, action_type, declared_goal, act })` using `app/lib/integrity/canonicalize.ts` (`'sha256:' + base64url(sha256(canonicalJson))` — matches the RFC §3 example format). **The provider echoes `input_identity` verbatim in the response**; DashClaw verifies the echo equals what it sent. This satisfies E3 without requiring providers to reimplement house canonicalization.

Response (RFC §3):

```json
{
  "decision": "allow | warn | escalate | deny",
  "reason": "stable_reason_code",
  "policy_source": "configured-provider-id",
  "policy_version": "opaque-version",
  "input_identity": "sha256:...",
  "evidence": {}
}
```

Validation: `decision` must be one of the four strings (else `unsupported_verdict`); `input_identity` must match (else `identity_mismatch`); JSON parse failure / missing decision → `malformed`; non-2xx → `http_error`; abort → `timeout`; `UNSAFE_URL` code from safeFetch → `unsafe_url`. Provider `evidence` stored only if `JSON.stringify(evidence).length <= 4096`, else dropped with `evidence_truncated: true`.

---

### Task 1: Config keys + hot-path config cache

**Files:**
- Modify: `app/lib/repositories/settings.repository.ts` (append 6 keys at END of `VALID_SETTING_KEYS`, away from the foreign approval-pause hunk)
- Modify: `app/lib/guard/caches.ts` (config cache fan-out, invalidator, reset)
- Test: `__tests__/unit/guard-external-verdict.test.js` (new file, config-loading describe block)

**Interfaces:**
- Consumes: `getSettings(sql, orgId, { category: 'general' })`, `decrypt(value, aad)` from `app/lib/encryption`, existing `loadGeneralSettings` fan-out in caches.ts.
- Produces: `getExternalVerdictConfig(sql: GuardSql, orgId: string): Promise<ExternalVerdictConfig>` and `invalidateGuardExternalVerdictCache(orgId: string): void`, exported from `app/lib/guard/caches.ts`. Type:

```ts
export interface ExternalVerdictConfig {
  enabled: boolean;
  url: string | null;
  authToken: string | null;
  timeoutMs: number;               // parsed, clamped 100..5000, default 1200
  posture: 'fail_closed' | 'fail_open'; // default 'fail_closed'
  providerId: string;              // EXTERNAL_VERDICT_PROVIDER, else URL host, else 'external'
}
```

- [ ] **Step 1: Write failing tests** in `__tests__/unit/guard-external-verdict.test.js` following the `guard-engine.test.js` mock preamble (vi.hoisted mocks for webhooks/llm/security/predictive-risk, `vi.mock('@/lib/repositories/settings.repository.js', ...)` returning config rows, `createSqlMock` from `../helpers.js`, `__resetGuardCaches()` in `beforeEach`). Tests: (a) all-defaults config when no rows (disabled, fail_closed, 1200ms); (b) enabled config parsed from rows including clamping `TIMEOUT_MS='99999'`→5000; (c) invalid posture string falls back to `fail_closed`; (d) `invalidateGuardExternalVerdictCache` forces a re-read (settings mock call count rises).
- [ ] **Step 2: Run** `npm test -- __tests__/unit/guard-external-verdict.test.js` — expect FAIL (exports missing).
- [ ] **Step 3: Implement.** Append to `VALID_SETTING_KEYS` (with a comment block naming the RFC): the 6 keys above. In `caches.ts`: add `externalVerdictCache: Map<string, { cfg: ExternalVerdictConfig; at: number }>` with `GUARD_CACHE_TTL_MS` (30s), filled inside the existing `loadGeneralSettings` fan-out (ONE settings read fills it, same as predictive/halt/calibration); decrypt `_URL`/`_TOKEN` rows there via the actionAlerts pattern; add `invalidateGuardExternalVerdictCache` and clear the map in `__resetGuardCaches`.
- [ ] **Step 4: Run the test file** — expect PASS. Also run `npm run typecheck`.
- [ ] **Step 5: Commit** (stage ONLY your hunks: `git add -p app/lib/repositories/settings.repository.ts`, verify with `git diff --cached` that the approval-pause hunk is NOT staged): `feat(guard): external-verdict provider config keys + hot-path cache (RFC 2026-08-13)`

### Task 2: external-verdict module (mapping, identity, provider call)

**Files:**
- Create: `app/lib/guard/external-verdict.ts`
- Test: `__tests__/unit/guard-external-verdict.test.js` (module-level describe block)

**Interfaces:**
- Consumes: `ExternalVerdictConfig` (Task 1), `safeFetch` from `app/lib/url-safety`, `digestJson` from `app/lib/integrity/canonicalize`.
- Produces:

```ts
export interface ExternalVerdictEvidence {
  provider_id: string;
  status: 'ok' | 'unavailable';
  regime: 'external+local' | 'external_unavailable';
  posture: 'fail_closed' | 'fail_open';
  latency_ms: number;
  raw_verdict?: string;
  mapped_verdict?: 'allow' | 'warn' | 'require_approval' | 'block';
  reason_code?: string | null;
  policy_source?: string | null;
  policy_version?: string | null;
  input_identity?: string;
  failure?: 'timeout' | 'budget' | 'http_error' | 'malformed' | 'identity_mismatch' | 'unsupported_verdict' | 'unsafe_url' | 'error';
  evidence?: unknown;
  evidence_truncated?: true;
}

export const EXTERNAL_VERDICT_MAP = {
  allow: 'allow', warn: 'warn', escalate: 'require_approval', deny: 'block',
} as const;

export function computeInputIdentity(payload: {
  org_id: string; agent_id: string | null; action_type: string | null;
  declared_goal: string | null; act: unknown;
}): string;                        // digestJson wrapper

export async function fetchExternalVerdict(
  cfg: ExternalVerdictConfig,
  request: Record<string, unknown>, // full wire request incl. input_identity
  budgetMs: number,
): Promise<ExternalVerdictEvidence>;
```

- [ ] **Step 1: Write failing tests.** Mock `@/lib/url-safety` (`vi.mock('@/lib/url-safety', () => ({ safeFetch: mockSafeFetch }))`). Cases: happy-path deny (200, echoed identity → `status:'ok'`, `mapped_verdict:'block'`); escalate → `require_approval`; identity mismatch → `failure:'identity_mismatch'`, no `mapped_verdict`; `decision:'transform'` → `unsupported_verdict`; non-2xx → `http_error`; safeFetch throws `{code:'UNSAFE_URL'}` → `unsafe_url`; abort → `timeout`; `budgetMs=50` → `budget` without calling safeFetch; oversized evidence (>4096 chars) → dropped + `evidence_truncated:true`; auth token present → `authorization: Bearer` header asserted on the mock call.
- [ ] **Step 2: Run — expect FAIL** (module missing).
- [ ] **Step 3: Implement** `fetchExternalVerdict`:

```ts
export async function fetchExternalVerdict(cfg, request, budgetMs) {
  const base: ExternalVerdictEvidence = {
    provider_id: cfg.providerId, posture: cfg.posture,
    status: 'unavailable', regime: 'external_unavailable', latency_ms: 0,
  };
  if (budgetMs < 100) return { ...base, failure: 'budget' };
  const started = Date.now();
  const fail = (failure: ExternalVerdictEvidence['failure']) =>
    ({ ...base, failure, latency_ms: Date.now() - started });
  let res: Response;
  try {
    res = await safeFetch(cfg.url!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.authToken ? { authorization: `Bearer ${cfg.authToken}` } : {}),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(budgetMs),
    });
  } catch (err) {
    const e = err as Error & { code?: string; name?: string };
    if (e.code === 'UNSAFE_URL') return fail('unsafe_url');
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return fail('timeout');
    return fail('error');
  }
  if (!res.ok) return fail('http_error');
  let body: Record<string, unknown>;
  try { body = await res.json() as Record<string, unknown>; } catch { return fail('malformed'); }
  const raw = typeof body.decision === 'string' ? body.decision : null;
  if (!raw) return fail('malformed');
  const mapped = EXTERNAL_VERDICT_MAP[raw as keyof typeof EXTERNAL_VERDICT_MAP];
  if (!mapped) return fail('unsupported_verdict');       // transform et al. — never an implicit allow
  if (body.input_identity !== request.input_identity) return fail('identity_mismatch'); // E3
  const evStr = body.evidence !== undefined ? JSON.stringify(body.evidence) : null;
  return {
    ...base, status: 'ok', regime: 'external+local', latency_ms: Date.now() - started,
    raw_verdict: raw, mapped_verdict: mapped,
    reason_code: typeof body.reason === 'string' ? body.reason : null,
    policy_source: typeof body.policy_source === 'string' ? body.policy_source : null,
    policy_version: typeof body.policy_version === 'string' ? body.policy_version : null,
    input_identity: request.input_identity as string,
    ...(evStr && evStr.length <= 4096 ? { evidence: body.evidence }
       : evStr ? { evidence_truncated: true as const } : {}),
  };
}
```

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck` clean.
- [ ] **Step 5: Commit:** `feat(guard): external-verdict wire client — mapping, identity echo check, bounded evidence`

### Task 3: Guard seam integration + ten-case adversarial matrix

**Files:**
- Modify: `app/lib/guard/evaluate.ts`
- Test: `__tests__/unit/guard-external-verdict.test.js` (integration describe block via `evaluateGuard` from `@/lib/guard.js`)

**Interfaces:**
- Consumes: `getExternalVerdictConfig` (Task 1), `fetchExternalVerdict`/`computeInputIdentity` (Task 2), `raiseDecision`, `timed`, `GuardFinalizeInput`, `buildGuardDecisionRow`, `safeContextForLog`.
- Produces: `_external_verdict` sibling in `guard_decisions.context`; reasons strings `external verdict <raw> from <provider> (<reason_code>)` and `external_unavailable (<failure>; fail_closed)`.

- [ ] **Step 0: Pre-modification risk check.** Run repowise `get_risk(targets: ["app/lib/guard/evaluate.ts"])`; report blast radius before editing (repo rule).
- [ ] **Step 1: Write failing integration tests** — the ten #220 cases, plus three extras. Use the `guard-engine.test.js` preamble; drive local decisions with policy rows via `createSqlMock`; drive external verdicts by mocking `@/lib/url-safety` responses; enable the provider via mocked settings rows. The matrix:
  1. local allow + external `deny` → `block`
  2. local block (policy `action:'block'`) + external `allow` → `block` (provider allow never loosens)
  3. local allow + external `escalate` → `require_approval`
  4. local require_approval + external `allow` → `require_approval` (local never loosened)
  5. identity mismatch → verdict discarded, `_external_verdict.failure==='identity_mismatch'`, fail_closed → `require_approval` — never the mismatched verdict's mapping
  6. provider 500 + `fail_closed` → `require_approval`, reason contains `external_unavailable`
  7. timeout (safeFetch mock rejects with `TimeoutError` / never resolves within `AbortSignal`) → decision evidence `status:'unavailable'`, `failure:'timeout'`, reasons/warnings say `external_unavailable` — visibly unavailable, not a fake allow
  8. `decision:'transform'` + `fail_open` + local allow → final `allow` BUT `_external_verdict.failure==='unsupported_verdict'`, `regime:'external_unavailable'` — never recorded as external allow
  9. `_external_verdict` exists ONLY under `context` sibling keys; assert `risk_breakdown` and result `risk_score` are unchanged vs. baseline, and no witness/containment fields touched (evidence ≠ execution witness)
  10. no provider configured → deep-equal result vs. baseline run AND `safeFetch` mock never called AND persisted context has no `_external_verdict` key
  - Extra A (E2): external `deny` + a matching operator-approval grant → still `block`
  - Extra B: `fail_open` + provider down + local allow → `allow`, evidence `external_unavailable` recorded
  - Extra C: `options.simulate` → provider not called
- [ ] **Step 2: Run — expect FAIL** (no seam yet; cases 1,3,5-8 fail).
- [ ] **Step 3: Implement the seam.** In `runEvaluation` (evaluate.ts ~1241-1245), between `runWebhookPolicies` and `runCalibrationController` — same slot rationale as calibration's docblock ("after the last phase where policies can raise, BEFORE the grant post-passes", so an operator approval can still cover an external escalate on retry — otherwise external `escalate` would loop forever through re-approval):

```ts
// External policy verdict (RFC 2026-08-13, frozen v1 contract). Tighten-only
// join: raiseDecision can only move up the lattice (E1); external deny maps
// to block, which no later grant pass downgrades (E2, pinned by test).
// Sits BEFORE the grant post-passes so an operator approval covers an
// external escalate on retry. Fail-soft + budgeted like predictive risk.
if (!options.simulate) {
  externalVerdict = await timed('external_verdict', () =>
    runExternalVerdict(sql, orgId, context, acc, deadlineMs - (Date.now() - evalStart)),
  );
}
```

  `runExternalVerdict` (new function in evaluate.ts, ~40 lines, modeled on `computePredictiveRisk`'s try/catch-warn-continue): load config (return `null` if `!enabled || !url`); build the wire request from the SAME redacted context the audit row stores (`safeContextForLog`) with `computeInputIdentity`; `budget = Math.min(cfg.timeoutMs, remainingBudgetMs - EXTERNAL_SAFETY_MARGIN_MS)` where `EXTERNAL_SAFETY_MARGIN_MS = 600`; call `fetchExternalVerdict`; apply the join:

```ts
if (ev.status === 'ok' && ev.mapped_verdict) {
  raiseDecision(acc, ev.mapped_verdict);
  if (sevOf(ev.mapped_verdict) > sevOf('allow')) {
    acc.reasons.push(`external verdict ${ev.raw_verdict} from ${ev.provider_id}${ev.reason_code ? ` (${ev.reason_code})` : ''}`);
  }
} else if (ev.posture === 'fail_closed') {
  raiseDecision(acc, 'require_approval');
  acc.reasons.push(`external_unavailable (${ev.failure}; fail_closed)`);
} else {
  acc.warnings.push(`external_unavailable (${ev.failure}; fail_open)`);
}
return ev;
```

  Thread `externalVerdict` through `GuardFinalizeInput` (add optional field) → `buildGuardDecisionRow` context spread: `...(input.externalVerdict ? { _external_verdict: input.externalVerdict } : {})` — sibling only, never into `riskBreakdown`.
- [ ] **Step 4: Run the full test file — expect PASS.** Then `npx vitest run __tests__/unit/guard-engine.test.js __tests__/unit/guard-degradation.test.js __tests__/unit/guard-hotpath.test.js __tests__/unit/guard-severity-ladder.test.ts` to catch regressions in neighbors. `npm run typecheck`.
- [ ] **Step 5: Commit:** `feat(guard): external-verdict seam — provider call, stricter-wins join, failure posture, _external_verdict evidence (#219)`

### Task 4: Settings-route invalidation + /policies config panel

**Files:**
- Modify: `app/api/settings/route.ts` (invalidate guard cache on `EXTERNAL_VERDICT_*` writes)
- Create: `app/policies/components/ExternalVerdictPanel.tsx`
- Modify: `app/policies/components/PolicyWorkbench.tsx` (mount as `CollapsibleSection id="policies.external"`)
- Test: `__tests__/unit/external-verdict-panel.test.jsx` (render + save flow) — note repo rule: testable pages/components are `.jsx`/`.tsx`

**Interfaces:**
- Consumes: existing generic `GET/POST /api/settings` (admin-gated POST at route line 91, auto-encrypt + masked-value skip already handled), `invalidateGuardExternalVerdictCache` + `invalidateGuardSettingsCache` (Task 1), `CollapsibleSection`, `Badge`, save-handler idiom from `ApprovalPausePanel.tsx`.
- Produces: human-operable config form — enable toggle, provider id, URL, auth token (masked), timeout, posture radio (`fail_closed` default). Zero new routes.

- [ ] **Step 0:** Read `.impeccable.md`. Tokens only; evidence-over-decoration; calm.
- [ ] **Step 1: Write failing component test** (React Testing Library per existing panel tests): renders disabled state; enabling reveals fields; save POSTs one `/api/settings` call per changed key with `{key, value, category:'general'}`; masked URL (`••••••••`) untouched on save is still posted but server-side skip keeps it (assert we do NOT clear it client-side); posture defaults to `fail_closed`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** In `app/api/settings/route.ts` POST (after `upsertSetting`, line ~118) and DELETE:

```ts
if (typeof key === 'string' && key.startsWith('EXTERNAL_VERDICT_')) {
  invalidateGuardSettingsCache(orgId);
  invalidateGuardExternalVerdictCache(orgId);
}
```

  Panel: `'use client'`, loads via `GET /api/settings?category=general` filtered to the 6 keys, `mutate` handler copied from `ApprovalPausePanel.tsx` idiom (busy/error state, `res.ok` check). Mount in `PolicyWorkbench.tsx` after `PresetsShields`:

```tsx
<CollapsibleSection
  id="policies.external"
  title={<>External decision provider<span className={styles.secHelp}>an outside engine can tighten decisions — never loosen them</span></>}
>
  <ExternalVerdictPanel />
</CollapsibleSection>
```

- [ ] **Step 4: Run tests — PASS.** `npm run typecheck`.
- [ ] **Step 5: Commit:** `feat(policies): external verdict provider configuration panel (RFC §6 — no env-var-only config)`

### Task 5: Posture badges — decision detail + /approvals

**Files:**
- Modify: `app/decisions/[actionId]/_components/PoliciesTab.tsx` (badge from `guardDecision.context._external_verdict`)
- Modify: `app/api/actions/route.ts` (`enrichWithPlainLanguage` — surface compact regime onto pending rows; it ALREADY fetches guard contexts via `getGuardContextsByIds`, read-time best-effort)
- Modify: `app/approvals/page.tsx` (regime badge on pending cards)
- Test: extend `__tests__/unit/` tests for `enrichWithPlainLanguage` (it is exported for unit tests) + existing approvals/decision-detail component tests if present

**Interfaces:**
- Consumes: `_external_verdict` evidence shape (Task 2), `Badge` component, existing `_plan_grant`/`_plan_deviation` badge idiom in `PoliciesTab.tsx:130-143`, `Act-bound` badge idiom in `approvals/page.tsx:563-568`.
- Produces: row field `external_verdict: { regime, raw_verdict, provider_id } | undefined` on `/api/actions` pending rows; visible regime on both surfaces: `external+local`, `external unavailable` (absence = local-only, unlabeled — the quiet default).

- [ ] **Step 1: Write failing test** for `enrichWithPlainLanguage`: a row whose guard context has `_external_verdict` gains the compact field; a row without stays undefined; context-read failure degrades silently (existing contract).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** In `enrichWithPlainLanguage`'s return map:

```ts
const xv = context?._external_verdict as { regime?: string; raw_verdict?: string; provider_id?: string } | undefined;
return {
  ...row,
  ...(xv ? { external_verdict: { regime: xv.regime, raw_verdict: xv.raw_verdict, provider_id: xv.provider_id } } : {}),
  plain: describeAction({ ... }),
};
```

  `PoliciesTab.tsx`, next to the `_plan_grant` badge:

```tsx
{guardDecision.context?._external_verdict && (
  <span title={`Provider: ${guardDecision.context._external_verdict.provider_id} · posture ${guardDecision.context._external_verdict.posture}`}>
    <Badge variant={guardDecision.context._external_verdict.status === 'ok' ? 'info' : 'warning'} size="xs">
      {guardDecision.context._external_verdict.status === 'ok'
        ? `External: ${guardDecision.context._external_verdict.raw_verdict}`
        : 'External unavailable'}
    </Badge>
  </span>
)}
```

  `approvals/page.tsx`, next to `Act-bound` — this is the RFC §6 requirement that an operator approving a require_approval that came from an external escalate SEES why they were asked:

```tsx
{action.external_verdict && (
  <span title={`External provider ${action.external_verdict.provider_id}`}>
    <Badge variant={action.external_verdict.regime === 'external+local' ? 'info' : 'warning'} size="xs">
      {action.external_verdict.regime === 'external+local'
        ? `External: ${action.external_verdict.raw_verdict}`
        : 'External unavailable'}
    </Badge>
  </span>
)}
```

- [ ] **Step 4: Tests PASS; then rendered proof** — `frontend-verify` against local dev: seed a decision with `_external_verdict` (mock provider or direct insert), open `/decisions/<id>` and `/approvals`, confirm badges render. HUMAN-EXPERIENCE.md question 4 answered in the ship summary.
- [ ] **Step 5: Commit:** `feat(ui): external-verdict regime badges on decision detail and /approvals (RFC §6 posture visibility)`

### Task 6: Provider implementer doc + changelog

**Files:**
- Create: `docs/external-verdict-provider.md` (the doc Kevin builds against — full request/response JSON with the echo rule, failure/posture semantics, the four-verdict map, the ten conformance cases, curl example)
- Modify: `docs/architecture/runtime-api.md` (one paragraph + link in the Decide step), `CHANGELOG.md`, `docs/maintainer-log.md`
- Modify: `docs/rfcs/2026-08-13-external-policy-verdict-input.md` — add one "Implementation" line linking the provider doc (status stays ACCEPTED)

**Interfaces:** Consumes the wire contract section of this plan verbatim. New file justification: external implementers need a stable doc URL that is not an RFC and not source code.

- [ ] **Step 1:** Write `docs/external-verdict-provider.md`: contract tables, the identity-echo rule stated as MUST, posture table, "conformance = the ten cases" section pointing at `__tests__/unit/guard-external-verdict.test.js` as the executable spec.
- [ ] **Step 2:** Cross-link from runtime-api.md; CHANGELOG entry under Unreleased; maintainer-log entry (what shipped, division of labor, what's on Kevin).
- [ ] **Step 3:** Commit: `docs: external-verdict provider implementer guide + runtime-api cross-link (#219)`

### Task 7: Gates, surgical staging audit, ship

- [ ] **Step 1:** Full gates, read output: `npm run lint`, `npm run typecheck`, `npx vitest run` (full suite, `--maxWorkers=2` per repo memory), `npx next build` (app/** changed). Use the dashclaw-gate-runner subagent to keep logs out of context; read only failures.
- [ ] **Step 2:** L1 rule — make a check fail on purpose: temporarily flip the join to use the WEAKER verdict (`sevOf` comparison inverted) and confirm cases 1/3 fail; restore. The matrix has now been observed failing.
- [ ] **Step 3:** Staging audit: `git status` + `git diff --cached` — confirm the foreign approval-pause hunk in `settings.repository.ts` and `__tests__/unit/approval-pause.route.test.js` are NOT included. Confirm `.gitattributes` state per repo gotcha.
- [ ] **Step 4:** Ship via the `dashclaw-ship` skill (version bump, doc counts, bundles, marketing-in-same-ship, push, READ remote CI after push).
- [ ] **Step 5:** Comment on #219: seam is live, link the provider doc, note the identity-echo rule as the one contract clarification (raise objections there if it reads as a change).

## Self-Review (done at plan time)

- Spec coverage: RFC §2 join → Task 3; §3 wire → Tasks 2/6; §4 posture → Tasks 2/3; §5 evidence → Task 3; §6 surfaces → Tasks 4/5; §7 budget → settings keys only, zero routes (Task 4 modifies an existing route without adding one); §8 test matrix → Task 3. Non-goals respected: no transforms (unsupported → posture), no provider grants, no new policy language.
- Type consistency: `ExternalVerdictConfig` (T1) consumed by T2/T3; `ExternalVerdictEvidence` (T2) is the `_external_verdict` shape read by T5 badges; `external_verdict` row field (T5) matches the compact `{regime, raw_verdict, provider_id}`.
- Known open verification points for executors: exact `GuardFinalizeInput` threading (interface at evaluate.ts:889-910 at recon time — re-anchor by text, lines will drift); confirm grant passes cannot downgrade `block` (Extra A pins it); confirm `timed()` helper signature before use.

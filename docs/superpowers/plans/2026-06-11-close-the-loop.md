# Close the Loop Implementation Plan (Track 1 distribution + W1 OpenClaw attribution)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get DashClaw listed on the quiet distribution channels (#146 Phases 1–3) and fix the OpenClaw 0-token cost-attribution gap (#147 gap 1) with a permanent attribution-coverage signal so the failure class can't silently recur.

**Architecture:** Track 1 is operational (registry publishes, directory submissions, awesome-list PRs) — no code. W1 is diagnose-first: four hypotheses with discriminating probes, then a root-cause fix in `packages/openclaw-plugin/`, then an additive `attribution` metric threaded through `getCostAggregation` → `/api/finops/spend` → `/spend` page (it flows automatically because `getFleetSpend` composes `getCostAggregation`).

**Tech Stack:** Next.js 16 App Router, Neon Postgres via repositories, vitest (repo-root `__tests__/unit`), OpenClaw plugin (TypeScript, loaded from repo source by the gateway), `gh` CLI, official `mcp-publisher` Go binary.

**Spec:** `docs/superpowers/specs/2026-06-11-close-the-loop-design.md`

**Ground rules for the executor:**
- Tests live in repo-root `__tests__/unit/`; `@/` maps to `app/`; no jest-dom — assert via container queries.
- `sql` mock tests must route by **query text**, not call index — conditional `sql\`\`` fragments consume `vi.fn()` calls (see the gotcha memory; pattern below).
- Neon returns `bigint`/`numeric` as strings — coerce with `Number()`.
- Never print `DASHCLAW_API_KEY` values into logs or transcripts; reference env vars.
- Full-suite verification before any push: `npm run lint && npx vitest run && npx next build`.

---

## Part A — W1 diagnosis (Tasks 1–3)

No fix until a hypothesis makes a correct prediction. Keep a ledger: `{hypothesis, prediction, observed, hit/miss}` in the task notes.

### Task 1: Probe the live instance (tests H1 — historical artifact)

**Files:** none (read-only probes)

- [ ] **Step 1: Read the diagnose script's interface**

Read `scripts/diagnose-cost-attribution.mjs` (162 lines) — note its Usage block and which env vars it reads. ⚠️ It imports `scripts/_load-env.mjs`, which **force-overrides** exported env with `.env.local` values. If `.env.local` points at the local dev DB and you need the live instance, use the curl probe in Step 2 instead, or temporarily pass the live values the way the Usage block documents.

- [ ] **Step 2: Pull the newest OpenClaw actions from the live instance**

The OpenClaw swarm reports to Wes's production instance. With the live base URL and API key from the machine environment (`$env:DASHCLAW_URL`, `$env:DASHCLAW_API_KEY` — verify with `Test-Path env:DASHCLAW_URL`, never echo the key):

```powershell
curl.exe -s -H "x-api-key: $env:DASHCLAW_API_KEY" "$env:DASHCLAW_URL/api/actions?limit=25" |
  python -c "import json,sys; rows=json.load(sys.stdin).get('actions',[]); [print(r.get('agent_id'), r.get('created_at'), r.get('tokens_in'), r.get('tokens_out'), r.get('cost_estimate')) for r in rows]"
```

If the response shape differs (e.g. top-level array), adapt the field access — do not guess; print the raw first 500 chars once to see the shape.

- [ ] **Step 3: Record the H1 verdict**

- Recent actions (last 24h) **have non-zero tokens** → H1 confirmed: the 2,265 zero-token rows are historical, predating the attribution code. Skip to Task 4 Step 1 (H1 branch).
- Recent actions **still 0 tokens** → H1 refuted; continue to Task 2.

### Task 2: Verify what the gateway actually loads (tests H2 — stale plugin)

**Files:** none (read-only)

- [ ] **Step 1: Locate the gateway's plugin path**

Per the install-truth memory, the OpenClaw gateway loads the plugin from repo source. Find the gateway config and confirm:

```powershell
Get-ChildItem ~/.openclaw -Filter "*.json" -ErrorAction SilentlyContinue | Select-Object FullName
# then read the config that lists plugins/extensions and note the dashclaw plugin path
```

- [ ] **Step 2: Confirm the loaded source has the attribution code**

```powershell
Select-String -Path "<the path the gateway loads>" -Pattern "registerTokenAttribution" -List
```

Found → H2 refuted (source is current; but ALSO check: has the gateway **restarted** since that code landed? `git log -1 --format=%ci 9579ce57` vs gateway process start time). Not found / path points at an old copy (e.g. `dist/` built before the feature, or the 1.2.5 tgz) → **H2 confirmed**.

### Task 3: Trace a live run (tests H3 `llm_output` never fires / H4 silent PATCH failure)

**Files:** possibly Modify (temporary): `packages/openclaw-plugin/src/index.ts` (instrumentation only, reverted after)

- [ ] **Step 1: Run one governed OpenClaw agent turn and capture gateway stdout/logs**

The plugin warns on missing-model `llm_output` already. If logs are silent on token activity, add two temporary breadcrumbs (and remove them in the fix commit): one in the `llm_output` handler (`registerTokenAttribution`, `packages/openclaw-plugin/src/index.ts:850`) logging that usage was stashed, one where `updateOutcome` PATCHes are issued, logging status code only.

- [ ] **Step 2: Interpret**

- No `llm_output` breadcrumb at all → **H3 confirmed** (event not firing in this OpenClaw version — check the gateway's OpenClaw version and its event names against what `api.on('llm_output', …)` expects).
- Stash logged but PATCH absent/failing (401/404/field rejection) → **H4 confirmed**.

- [ ] **Step 3: Write the confirmed root cause into the ledger** — exactly one of H1–H4 should now have a hit. If none, stop and re-plan (new hypothesis; do not poke the same spots).

## Part B — W1 fix (Task 4)

### Task 4: Fix the confirmed root cause (branch by hypothesis)

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts` (H2/H3/H4) and/or gateway config (H2)
- Test: `__tests__/unit/packages/openclaw-plugin/src/index.test.js` (existing suite — extend it)

Each branch is TDD where code changes are involved: failing test → run (`npx vitest run __tests__/unit/packages/openclaw-plugin/src/index.test.js`) → minimal fix → pass → commit.

- [ ] **H1 branch (historical artifact):** no plugin bug. Decide backfill: tokens are only recoverable if gateway logs/session JSONL still hold per-run usage — check; if not recoverable, **skip backfill (YAGNI)** and document on #147 that pre-attribution rows stay at 0. The coverage signal (Part C) becomes the user-visible explanation. Commit: docs note only.
- [ ] **H2 branch (stale load):** repoint the gateway config at the current source (or rebuild `dist/`: `cd packages/openclaw-plugin && npm run build`), restart the gateway, re-run Task 1 Step 2 to verify tokens now land. If the root cause was "gateway loads `dist/` but README says source," fix the README/install doc in the same commit so it can't recur.
- [ ] **H3 branch (event drift):** add the renamed/current event alongside the old one in `registerTokenAttribution` (`api.on('<new-event>', …)` with the same handler), with a unit test feeding the new event shape through the test harness in `index.test.js` and asserting `updateOutcome` distribution fires. Keep the old registration for older gateways.
- [ ] **H4 branch (silent PATCH failure):** make the failure loud first — test asserting a non-2xx `updateOutcome` response increments a logged error counter (no silent catch; follow the error-handling memory: background path = `console.warn` with context). Then fix the actual cause (auth header, field names, endpoint path) shown by the captured status/body.
- [ ] **All branches: live verification** — one fresh OpenClaw run, then re-run the Task 1 Step 2 probe: newest actions show non-zero `tokens_in/tokens_out` and non-zero `cost_estimate` (if cost is 0 with tokens present, that's the unpriced-model path — check `defaultModel` config per `packages/openclaw-plugin/src/index.ts:48-52`).
- [ ] **Commit** with the root cause named in the message.

## Part C — Attribution-coverage signal (Tasks 5–6)

### Task 5: `attribution` metric in `getCostAggregation` (TDD)

**Files:**
- Modify: `app/lib/repositories/actions.repository.ts:1506-1586`
- Test: `__tests__/unit/finops-cost-aggregation.test.js` (extend)

- [ ] **Step 1: Write the failing tests** (append to the existing describe block; note the query-text-routed mock — required because the `agentFilter` conditional fragment consumes mock calls):

```js
describe('getCostAggregation — attribution coverage', () => {
  it('adds a tokens FILTER count to totals and by_agent queries', async () => {
    await getCostAggregation(sql, 'org_1', { period: '30d' });
    const allSql = sql.mock.calls.map((c) => c[0].join(' ')).join(' || ');
    const matches = allSql.match(/FILTER \(WHERE COALESCE\(tokens_in, 0\) > 0 OR COALESCE\(tokens_out, 0\) > 0\)/g) || [];
    expect(matches.length).toBe(2); // totals + by_agent
  });

  it('returns attribution totals and per-agent coverage_pct', async () => {
    sql = vi.fn((strings = ['']) => {
      const text = Array.isArray(strings) ? strings.join(' ') : '';
      if (text.includes('GROUP BY agent_id')) {
        return Promise.resolve([
          { agent_id: 'a1', cost_usd: 1, action_count: 2, attributed_count: 1 },
          { agent_id: 'a2', cost_usd: 0, action_count: 2, attributed_count: 0 },
        ]);
      }
      if (text.includes('GROUP BY DATE')) return Promise.resolve([]);
      if (text.includes('SUM(cost_estimate)')) {
        return Promise.resolve([{ total_cost_usd: 1, total_tokens_in: '10', total_tokens_out: '5', total_count: 4, attributed_count: 1 }]);
      }
      return Promise.resolve([]);
    });
    const res = await getCostAggregation(sql, 'org_1', {});
    expect(res.attribution).toEqual({ attributed_count: 1, total_count: 4, coverage_pct: 25 });
    expect(res.by_agent[0].coverage_pct).toBe(50);
    expect(res.by_agent[1].coverage_pct).toBe(0);
  });

  it('coverage_pct is null when there are no actions', async () => {
    sql = vi.fn((strings = ['']) => {
      const text = Array.isArray(strings) ? strings.join(' ') : '';
      if (text.includes('SUM(cost_estimate)')) {
        return Promise.resolve([{ total_cost_usd: 0, total_tokens_in: 0, total_tokens_out: 0, total_count: 0, attributed_count: 0 }]);
      }
      return Promise.resolve([]);
    });
    const res = await getCostAggregation(sql, 'org_1', {});
    expect(res.attribution.coverage_pct).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run __tests__/unit/finops-cost-aggregation.test.js` → the two new behavior tests FAIL (no `attribution` in result).

- [ ] **Step 3: Implement.** In `actions.repository.ts`:

Totals query — add inside the SELECT (after `total_tokens_out`):
```sql
      COUNT(*)::integer as total_count,
      COUNT(*) FILTER (WHERE COALESCE(tokens_in, 0) > 0 OR COALESCE(tokens_out, 0) > 0)::integer as attributed_count
```

`byAgent` query — add after `action_count`:
```sql
      COUNT(*) FILTER (WHERE COALESCE(tokens_in, 0) > 0 OR COALESCE(tokens_out, 0) > 0)::integer as attributed_count
```

Return block — replace `by_agent: byAgent,` and add `attribution`:
```ts
  const totalCount = Number(totals?.total_count ?? 0);
  const attributedCount = Number(totals?.attributed_count ?? 0);

  return {
    total_cost_usd: Number(totals?.total_cost_usd ?? 0),
    total_tokens_in: Number(totals?.total_tokens_in ?? 0),
    total_tokens_out: Number(totals?.total_tokens_out ?? 0),
    period,
    attribution: {
      attributed_count: attributedCount,
      total_count: totalCount,
      coverage_pct: totalCount > 0 ? Math.round((attributedCount / totalCount) * 100) : null,
    },
    by_agent: byAgent.map((r: Row) => ({
      ...r,
      coverage_pct:
        Number(r.action_count) > 0
          ? Math.round((Number(r.attributed_count) / Number(r.action_count)) * 100)
          : null,
    })),
    by_day: byDay,
  };
```

Add to `CostAggregationResult` (line 1511): `attribution: { attributed_count: number; total_count: number; coverage_pct: number | null };`

- [ ] **Step 4: Run the test file** → all PASS. Then `npm run typecheck` (changed `.ts` — vitest won't catch type errors).

- [ ] **Step 5: Commit** — `git add app/lib/repositories/actions.repository.ts __tests__/unit/finops-cost-aggregation.test.js && git commit -m "feat(finops): per-agent token attribution coverage in cost aggregation"`

### Task 6: Surface coverage on `/spend` (TDD)

**Files:**
- Modify: `app/spend/page.tsx` (after the unpriced-models box, `:119-132`)
- Test: Create `__tests__/unit/spend-attribution-coverage.test.tsx`

- [ ] **Step 1: Write the failing render test.** Copy the mock setup (next/navigation, fetch) from `__tests__/unit/spend-agent-filter.test.jsx` — same page, same harness. The fetch mock must match the `/api/finops/spend` prefix and return:

```js
// low-coverage payload → warning renders
{
  fleet_total_usd: 1, x402: { total_spend_usd: 0 }, unpriced: { action_count: 0, models: [] },
  agent: {
    total_cost_usd: 1,
    attribution: { attributed_count: 10, total_count: 100, coverage_pct: 10 },
    by_agent: [
      { agent_id: 'openclaw-main', cost_usd: 0, action_count: 80, attributed_count: 0, coverage_pct: 0 },
      { agent_id: 'cc-1', cost_usd: 1, action_count: 20, attributed_count: 10, coverage_pct: 50 },
    ],
    by_day: [],
  },
}
```

Assertions (container text queries, no jest-dom):
1. Low coverage → container text includes `Token attribution coverage is 10%` and the worst agent id `openclaw-main`.
2. Second test with `attribution: { attributed_count: 5, total_count: 5, coverage_pct: 100 }` → that warning text is absent.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run __tests__/unit/spend-attribution-coverage.test.tsx` → FAIL (warning not rendered).

- [ ] **Step 3: Implement.** In `app/spend/page.tsx`, insert after the unpriced-models box (follows the same warning pattern; CSS tokens only, no hex):

```tsx
          {data.agent?.attribution &&
            data.agent.attribution.total_count > 0 &&
            Number(data.agent.attribution.coverage_pct) < 90 && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm" role="status">
              <div className="font-medium text-warning mb-1">
                Token attribution coverage is {data.agent.attribution.coverage_pct}% —{' '}
                {data.agent.attribution.total_count - data.agent.attribution.attributed_count} of{' '}
                {data.agent.attribution.total_count} actions in this period carry no token data
              </div>
              <div className="text-secondary text-xs">
                Actions without tokens produce $0 cost rows. Lowest-coverage agents:{' '}
                <span className="font-mono">
                  {(data.agent.by_agent || [])
                    .filter((a: any) => a.coverage_pct !== null && a.coverage_pct < 100)
                    .sort((a: any, b: any) => a.coverage_pct - b.coverage_pct)
                    .slice(0, 3)
                    .map((a: any) => `${a.agent_id} (${a.coverage_pct}%)`)
                    .join(', ')}
                </span>
                {' — '}check that agent's runtime plugin/hook wiring, then re-run npm run diagnose:cost.
              </div>
            </div>
          )}
```

- [ ] **Step 4: Run the new test file → PASS**, then the **full suite** (`npx vitest run`) — a new fetch/navigation surface on a shared page can break sibling render tests (the resolves-`.tsx` gotcha).

- [ ] **Step 5: Commit** — `git add app/spend/page.tsx __tests__/unit/spend-attribution-coverage.test.tsx && git commit -m "feat(spend): attribution-coverage warning with lowest-coverage agents"`

## Part D — Wrap-up (Task 7)

### Task 7: Close the loop on #147 and ship

**Files:** none new (ship machinery)

- [ ] **Step 1:** Comment on issue #147 (`gh issue comment 147 --repo ucsandman/DashClaw`): the confirmed root cause (ledger summary), the fix commit(s), and that the coverage signal now exposes this class live. If H1 was the verdict, state the historical rows intentionally stay at 0.
- [ ] **Step 2:** Live smoke: one OpenClaw run → `/spend` shows the coverage box (or coverage ≥90% post-fix) and the newest actions carry tokens.
- [ ] **Step 3:** Ship via the **dashclaw-ship** skill (gates, version bump — additive platform feature, **minor**, no SDK source change → no SDK republish — docs/counts sweep, push to main). The CHANGELOG entry covers the root-cause fix + the coverage signal.

## Part E — Track 1: quiet distribution (Tasks 8–11; independent of Parts A–D, run anytime)

No code. Record every outcome (submitted / live / rejected+reason) as a single checklist comment on issue #146 (Task 11).

### Task 8: MCP Registry publish (auto-feeds PulseMCP)

- [ ] **Step 1:** Verify the Go binary: `Get-Command mcp-publisher` (⚠️ never `npm i -g mcp-publisher` — squatted name). If missing, reinstall per the official MCP registry docs (`modelcontextprotocol/registry` releases).
- [ ] **Step 2:** From `mcp-server/`: confirm `package.json` has `"mcpName": "io.github.ucsandman/dashclaw"` (it does) and `server.json` is present/valid.
- [ ] **Step 3 (WES — interactive):** `mcp-publisher login github` (device-code OAuth).
- [ ] **Step 4:** `mcp-publisher publish` from `mcp-server/`.
- [ ] **Step 5:** Verify: `curl.exe -s "https://registry.modelcontextprotocol.io/v0/servers?search=dashclaw"` → entry present.

### Task 9: Glama + Phase-2 directories

- [ ] **Step 1 (WES or agent-with-browser):** Glama — submit `https://github.com/ucsandman/DashClaw` at glama.ai's MCP server submission page (account may be required). This gates the punkpeye PR in Task 10.
- [ ] **Step 2:** PulseMCP — confirm auto-ingest from the registry (Task 8) after ~24h; if absent, use their direct submit form.
- [ ] **Step 3:** mcp.so — submission form with repo URL + one-paragraph description.
- [ ] **Step 4:** Smithery — `smithery mcp publish` per their current CLI docs (verify the command first; if it requires an account, hand to Wes click-by-click).
- [ ] **Step 5:** mcp.directory — `/submit` (server) and `/submit-skill` (the governance SKILL.md).

### Task 10: Awesome-list PRs (from the `ucsandman` account via `gh`)

For each list: read its `CONTRIBUTING.md` first and match the entry format exactly; one PR per list; no AI-sounding fluff in the entry. Suggested entry text (adapt per list format):

> **DashClaw** — Self-hosted governance control plane for AI agents: guard/approve/record every risky action via MCP server, Claude Code hooks, or Node/Python SDKs.

- [ ] **Step 1:** `punkpeye/awesome-mcp-servers` — **only after Glama (Task 9 Step 1) is live**; fork → branch → add entry in the matching category → PR.
- [ ] **Step 2:** `hesreallyhim/awesome-claude-code` — entry for the plugin + hooks under the appropriate section.
- [ ] **Step 3:** `rohitg00/awesome-claude-code-toolkit` — same pattern.
- [ ] **Step 4:** `anthropics` community marketplace (`claude-plugins-community`) — follow its plugin-submission schema (plugin manifest already at 2.15.0).

### Task 11: Record everything on #146

- [ ] **Step 1:** One comment with a checkbox status line per channel (live / pending review / blocked+reason). Done = every Phase 1–3 channel either live or has an open submission/PR.

---

## Self-review notes

- Spec coverage: Track 1 (Tasks 8–11), W1 diagnosis (1–3), fix (4), coverage signal (5–6), #147 closure + ship (7). Deferred items (Phase 4–6, W2–W4) intentionally absent per spec.
- Task 4 cannot pre-write the fix code (diagnosis-dependent by design); each branch names exact files, the test harness to extend, and a concrete recipe — that is the honest maximum for a diagnose-first plan.
- Type/name consistency: `attribution.{attributed_count,total_count,coverage_pct}` and per-agent `coverage_pct` are used identically in Tasks 5, 6, and the test payloads.

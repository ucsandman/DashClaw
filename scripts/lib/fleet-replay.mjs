// Pure core of scripts/fleet-replay.mjs: time buckets, the outcome join, the day-by-day
// "what if every proposal had been accepted" replay, the integrity checks and the report.
// No network and no clock in here; the script hands in what it fetched.
//
// The replay calls the product's own engines, so a proposal appears here exactly when the
// /policies page would have shown it.
import { deriveLooseningProposals, deriveBudgetProposals } from '../../app/lib/posture/loosening.ts';
import { buildTuningStats, deriveProposals } from '../../app/lib/policy-tuning/engine.ts';

export const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Goal prefix written by scripts/catastrophe-floor-probe.mjs. A probe is a scheduled
 *  self-test of the catastrophe floor: nobody is asked, so it is not an approval ask. */
const PROBE_GOAL_PREFIX = 'Automated probe:';

const toMs = (value) => {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
};

/** weeks+1 ascending boundaries; the last one is the end of the window. */
export function weekBounds(endMs, weeks) {
  return Array.from({ length: weeks + 1 }, (_, i) => endMs - (weeks - i) * WEEK_MS);
}

/** cum[i] is "decisions since boundary i"; the difference of neighbours is one week. */
export function weeklyFromCumulative(cum) {
  return cum.slice(0, -1).map((n, i) => n - cum[i + 1]);
}

export function isProbe(row) {
  return !row.agent_id && String(row.declared_goal || '').startsWith(PROBE_GOAL_PREFIX);
}

/**
 * Join approval asks to their action records, the way the product's own evidence queries do
 * (action_records.guard_decision_id; approved_by set means approved; a HITL DENY marker in
 * the reasoning means denied). An ask with no record stays unresolved.
 */
export function attachOutcomes(asks, actions) {
  const byDecision = new Map();
  for (const a of actions) {
    if (a.guard_decision_id) byDecision.set(String(a.guard_decision_id), a);
  }
  return asks.map((ask) => {
    const a = byDecision.get(String(ask.id));
    if (!a) return { ...ask, hasRecord: false, approvedMs: null, deniedMs: null, openUntilMs: null };
    const approved = a.approved_by != null && a.approved_by !== '';
    const denied = !approved && String(a.reasoning || '').includes('[HITL Decision: DENY');
    const approvedMs = approved ? (toMs(a.approved_at) ?? toMs(a.created_at)) : null;
    const deniedMs = denied ? (toMs(a.outcome_at) ?? toMs(a.timestamp_end) ?? toMs(a.created_at)) : null;
    // The request stayed open until it was answered, or else until it expired.
    return { ...ask, hasRecord: true, approvedMs, deniedMs, openUntilMs: approvedMs ?? deniedMs ?? toMs(a.approval_expires_at) };
  });
}

/** How far a bare guard call may lead the call that records the same ask. */
const TWIN_LEAD_MS = 120_000;

/**
 * One ask can write more than one require_approval decision. POST /api/actions evaluates
 * the guard again, so a client that calls the guard and then records the action writes
 * two; and an ask repeated while its request is open is answered with that request. Mark
 * the extra rows with `repeatOf` (the id of the row that holds the request) so the ask is
 * counted once. Rows are matched on agent, action type and goal; `asks` come from
 * attachOutcomes.
 */
export function markRepeats(asks) {
  const groups = new Map();
  asks.forEach((a, i) => {
    const ms = toMs(a.created_at);
    if (ms == null || isProbe(a)) return;
    const key = `${a.agent_id ?? ''}\n${a.action_type ?? ''}\n${a.declared_goal ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push({ i, ms, a });
    groups.set(key, group);
  });
  const repeatOf = new Map();
  for (const group of groups.values()) {
    group.sort((x, y) => x.ms - y.ms);
    const recorded = group.filter((r) => r.a.hasRecord);
    const bare = group.filter((r) => !r.a.hasRecord);
    // Asked again while the request was open.
    for (const b of bare) {
      const open = recorded.find((r) => r.ms <= b.ms && r.a.openUntilMs != null && b.ms < r.a.openUntilMs);
      if (open) repeatOf.set(b.i, open.a.id);
    }
    // Guard call first, record call moments later: one bare row per recorded ask, the earliest.
    for (const r of recorded) {
      const twin = bare.find((b) => !repeatOf.has(b.i) && r.ms >= b.ms && r.ms - b.ms <= TWIN_LEAD_MS);
      if (twin) repeatOf.set(twin.i, r.a.id);
    }
  }
  return asks.map((a, i) => (repeatOf.has(i) ? { ...a, repeatOf: repeatOf.get(i) } : a));
}

/** What one fetched require_approval row is. Every row is exactly one kind. */
function kindOf(row, testAgents) {
  if (isProbe(row)) return 'probe';
  if (row.agent_id && testAgents.includes(row.agent_id)) return 'test';
  return row.repeatOf ? 'repeat' : 'ask';
}

/**
 * Where the asks ended up. An ask with an action record reached the approvals inbox; one
 * without never opened a request, so nobody was prompted.
 */
export function summarizeOutcomes(rows, testAgents = []) {
  const out = { asks: 0, approved: 0, denied: 0, unanswered: 0, neverOpened: 0, repeats: 0, tests: 0 };
  for (const row of rows) {
    const kind = kindOf(row, testAgents);
    if (kind === 'repeat') out.repeats += 1;
    if (kind === 'test') out.tests += 1;
    if (kind !== 'ask') continue;
    out.asks += 1;
    if (row.approvedMs != null) out.approved += 1;
    else if (row.deniedMs != null) out.denied += 1;
    else if (row.hasRecord) out.unanswered += 1;
    else out.neverOpened += 1;
  }
  return out;
}

function parseRules(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Replay the window one day at a time. At each midnight the loosening, tuning and
 * interruption-budget engines see the evidence that existed by then; every actionable
 * proposal is accepted on the spot; and a later ask is removed only when every policy that
 * matched it had been relaxed for it (so the count errs toward keeping asks).
 *
 * `asks` are require_approval decisions carrying approvedMs / deniedMs from attachOutcomes.
 * `policies` is today's policy list; the instance's past edits are not replayed.
 */
export function replayWhatIf({ asks, policies, startMs, endMs, windowDays = 30 }) {
  const state = new Map(
    policies
      .filter((p) => typeof p.id === 'string')
      .map((p) => [p.id, {
        row: p,
        rules: parseRules(p.rules),
        active: Number(p.active) === 1 || p.active === true,
        editedMs: toMs(p.updated_at),
        resetMs: null, // last accepted proposal; evidence restarts there, as it does in the product
        offMs: null,
        carved: new Map(),
        raises: [],
      }]),
  );
  const rows = asks
    .map((a) => ({
      ...a,
      ms: toMs(a.created_at),
      policyIds: Array.isArray(a.matched_policies) ? a.matched_policies.map(String) : [],
    }))
    .filter((a) => a.ms != null)
    .sort((x, y) => x.ms - y.ms);

  const removed = new Set();
  const accepted = [];

  const relaxedFor = (s, a) => {
    if (!s) return false;
    if (s.offMs != null && s.offMs < a.ms) return true;
    const carvedMs = s.carved.get(a.action_type);
    if (carvedMs != null && carvedMs < a.ms) return true;
    const line = s.raises.filter((r) => r.ms < a.ms).at(-1);
    return line != null && Number(a.risk_score) < line.to;
  };
  const settle = (a) => {
    if (a.policyIds.length > 0 && a.policyIds.every((id) => relaxedFor(state.get(id), a))) removed.add(a.id);
  };

  let cursor = 0;
  for (let day = startMs + DAY_MS; day <= endMs; day += DAY_MS) {
    while (cursor < rows.length && rows[cursor].ms <= day) settle(rows[cursor++]);

    const windowStart = day - windowDays * DAY_MS;
    const grains = new Map();
    const perPolicy = new Map();
    for (const a of rows) {
      if (a.ms > day) break;
      if (a.ms <= windowStart || removed.has(a.id)) continue;
      const approved = a.approvedMs != null && a.approvedMs <= day;
      const denied = a.deniedMs != null && a.deniedMs <= day;
      for (const id of a.policyIds) {
        const s = state.get(id);
        if (!s) continue;
        const edited = s.editedMs != null && s.editedMs <= day ? s.editedMs : -Infinity;
        if (a.ms <= Math.max(windowStart, edited, s.resetMs ?? -Infinity)) continue;

        const grainKey = `${id}\n${a.action_type ?? ''}`;
        const g = grains.get(grainKey)
          ?? { policy_id: id, action_type: a.action_type ?? '', fired: 0, approved: 0, denied: 0, pending: 0 };
        g.fired += 1;
        if (approved) g.approved += 1;
        if (denied) g.denied += 1;
        grains.set(grainKey, g);

        const p = perPolicy.get(id) ?? { fired: 0, fired24h: 0, approved: 0, denied: 0, scores: [], lastMs: a.ms };
        p.fired += 1;
        if (a.ms > day - DAY_MS) p.fired24h += 1;
        if (approved) {
          p.approved += 1;
          p.scores.push(Number(a.risk_score) || 0);
        }
        if (denied) p.denied += 1;
        p.lastMs = a.ms;
        perPolicy.set(id, p);
      }
    }

    const now = new Date(day);
    const all = [...state.values()].map((s) => ({ ...s.row, rules: s.rules, active: s.active ? 1 : 0 }));
    const active = all.filter((p) => p.active === 1);

    const loosening = deriveLooseningProposals([...grains.values()], active, { windowDays, now });
    const mix = [...perPolicy].map(([policy_id, p]) => ({
      policy_id, decision: 'require_approval', cnt: p.fired, last_fired: new Date(p.lastMs).toISOString(),
    }));
    const outcomes = [...perPolicy].map(([policy_id, p]) => {
      const scores = [...p.scores].sort((x, y) => x - y);
      return {
        policy_id,
        approved: p.approved,
        denied: p.denied,
        pending: 0,
        approved_min: scores[0] ?? null,
        approved_p50: scores.length ? scores[Math.floor(scores.length / 2)] : null,
        approved_max: scores.at(-1) ?? null,
      };
    });
    const tuning = deriveProposals(buildTuningStats(all, mix, outcomes, {}, windowDays, now), { now })
      .filter((p) => p.severity === 'actionable' && p.patch);
    const overBudget = deriveBudgetProposals(
      [...perPolicy].map(([policy_id, p]) => ({ policy_id, fired: p.fired24h })),
      active,
    );

    const accept = (p, detail) => accepted.push({
      dayMs: day, rule: p.rule, policy_id: p.policy_id, policy_type: p.policy_type, action_type: p.action_type ?? null, detail,
    });
    for (const p of loosening) {
      const s = state.get(p.policy_id);
      if (!s || !s.active) continue;
      if (p.rule === 'relax_policy_scope') {
        // Remove the type from the rules as they stand now: two carve-outs on one day must both land.
        const types = Array.isArray(s.rules.action_types) ? s.rules.action_types : [];
        s.rules = { ...s.rules, action_types: types.filter((t) => t !== p.action_type) };
        s.carved.set(p.action_type, day);
        s.resetMs = day;
        accept(p, `stop asking for "${p.action_type}"`);
      } else {
        s.active = false;
        s.offMs = day;
        accept(p, 'deactivate');
      }
    }
    for (const p of tuning) {
      const s = state.get(p.policy_id);
      if (!s || !s.active) continue;
      const from = Number(s.rules.threshold ?? 80);
      const to = Number(p.patch.rules.threshold);
      s.rules = p.patch.rules;
      s.raises.push({ ms: day, to });
      s.resetMs = day;
      accept(p, `${from} to ${to}`);
    }
    for (const p of overBudget) {
      const s = state.get(p.policy_id);
      if (!s || !s.active) continue;
      s.active = false;
      s.offMs = day;
      accept(p, 'deactivate, over the interruption budget');
    }
  }
  while (cursor < rows.length) settle(rows[cursor++]);

  return { removed, accepted };
}

const per1000 = (n, total) => (total > 0 ? Math.round((n / total) * 100_000) / 100 : 0);

/** One row per week: approval asks, the rows kept out of that count, and the what-if count. */
export function buildWeeks({ bounds, weeklyDecisions, askRows, removed, agentsPerWeek, testAgents = [] }) {
  return weeklyDecisions.map((decisions, i) => {
    const inWeek = askRows.filter((a) => {
      const t = toMs(a.created_at);
      return t != null && t >= bounds[i] && t < bounds[i + 1];
    });
    const kinds = inWeek.map((a) => kindOf(a, testAgents));
    const count = (kind) => kinds.filter((k) => k === kind).length;
    const asks = inWeek.filter((_, j) => kinds[j] === 'ask');
    const whatIfAsks = asks.filter((a) => !removed.has(a.id)).length;
    return {
      startMs: bounds[i],
      endMs: bounds[i + 1],
      decisions,
      asks: asks.length,
      probes: count('probe'),
      repeats: count('repeat'),
      tests: count('test'),
      per1000: per1000(asks.length, decisions),
      agents: agentsPerWeek[i] ?? null,
      whatIfAsks,
      whatIfPer1000: per1000(whatIfAsks, decisions),
    };
  });
}

/** Every check carries the counts it compared, so a pass on zero rows is visible. */
export function runChecks(d) {
  const ids = d.askRows.map((a) => a.id);
  const unique = new Set(ids).size;
  const weekSum = d.weeklyDecisions.reduce((s, n) => s + n, 0);
  const typeSum = Object.values(d.typeTotals).reduce((s, n) => s + n, 0);
  const placed = d.weeks.reduce((s, w) => s + w.asks + w.probes + w.repeats + w.tests, 0);
  const above = d.weeks.filter((w) => w.whatIfAsks > w.asks).length;
  const check = (name, ok, detail) => ({ name, ok, detail });
  return [
    check('rows_match_api', ids.length === d.apiAskTotal, `${ids.length} rows fetched, API counts ${d.apiAskTotal}`),
    check('unique_ids', unique === ids.length, `${unique} unique ids in ${ids.length} rows`),
    check('types_sum_to_weeks', typeSum === weekSum, `decision types sum to ${typeSum}, weeks sum to ${weekSum}`),
    check('weekly_asks_sum', placed === ids.length, `${placed} rows placed in weeks as asks, repeats, test traffic or probes, ${ids.length} rows fetched`),
    check('what_if_not_above_actual', above === 0, `${above} of ${d.weeks.length} weeks have a what-if count above the real one`),
    check('agents_within_total', d.agentDecisionSum <= weekSum, `per-agent counts sum to ${d.agentDecisionSum} of ${weekSum} decisions`),
  ];
}

/** Break the data on purpose (--sabotage): lose a third of the rows, repeat one, inflate a week. */
export function sabotage(d) {
  const kept = d.askRows.slice(Math.ceil(d.askRows.length / 3));
  return {
    ...d,
    askRows: kept.length ? [...kept, kept[0]] : kept,
    weeklyDecisions: d.weeklyDecisions.map((n, i) => (i === d.weeklyDecisions.length - 1 ? n + 1000 : n)),
  };
}

const num = (n) => Number(n).toLocaleString('en-US');
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function renderMarkdown(r) {
  const sum = (key) => r.weeks.reduce((s, w) => s + w[key], 0);
  const decisions = sum('decisions');
  const asks = sum('asks');
  const whatIf = sum('whatIfAsks');
  const passed = r.checks.filter((c) => c.ok).length;
  // A few very busy weeks can carry the overall rate, so the typical week is printed beside it.
  const rates = r.weeks.map((w) => w.per1000).sort((a, b) => a - b);
  const mid = rates.length >> 1;
  const median = rates.length % 2 ? rates[mid] : Math.round(((rates[mid - 1] + rates[mid]) / 2) * 100) / 100;
  const answered = r.outcomes.approved + r.outcomes.denied;
  const testAgents = r.testAgents ?? [];
  const lines = [
    '# Fleet replay: how often DashClaw asked a human',
    '',
    `Generated ${r.generatedAt.slice(0, 10)} by \`scripts/fleet-replay.mjs\` from one live DashClaw instance, read-only through its API.`,
    '',
    `**${per1000(asks, decisions)} approval asks per 1,000 governed actions** over ${r.weeks.length} weeks: ${num(asks)} asks in ${num(decisions)} guard decisions. Median week: ${median} per 1,000.`,
    '',
    r.accepted.length
      ? `With every loosening and tuning proposal accepted on the day it appeared: **${per1000(whatIf, decisions)} per 1,000** (${num(whatIf)} asks).`
      : `Accepting every loosening and tuning proposal on the day it appeared would have changed nothing: no actionable proposal appeared in this window.`,
    '',
    '| Week of | Governed actions | Approval asks | Per 1,000 | Floor probes | Distinct agents | Asks if accepted | Per 1,000 if accepted |',
    '|---|---|---|---|---|---|---|---|',
    ...r.weeks.map((w) =>
      `| ${dayOf(w.startMs)} | ${num(w.decisions)} | ${num(w.asks)} | ${w.per1000} | ${num(w.probes)} | ${w.agents ?? ''} | ${num(w.whatIfAsks)} | ${w.whatIfPer1000} |`),
    `| Total | ${num(decisions)} | ${num(asks)} | ${per1000(asks, decisions)} | ${num(sum('probes'))} | ${r.agentsInWindow ?? ''} | ${num(whatIf)} | ${per1000(whatIf, decisions)} |`,
    '',
    '## Proposals the replay accepted',
    '',
    ...(r.accepted.length
      ? r.accepted.map((a) => `- ${dayOf(a.dayMs)}: \`${a.rule}\` on a \`${a.policy_type}\` policy, ${a.detail}`)
      : [`None. The engines need at least 10 asks and 5 human answers on one policy inside ${r.windowDays} days before they propose anything.`]),
    '',
    '## What happened to the asks',
    '',
    `Of ${num(r.outcomes.asks)} approval asks, ${num(answered)} were answered: ${num(r.outcomes.approved)} approved by a human and ${num(r.outcomes.denied)} denied. ${num(r.outcomes.unanswered)} reached the approvals inbox and got no answer. ${num(r.outcomes.neverOpened)} never opened a request: the agent asked the guard and did not follow up, so nobody was prompted.`,
    '',
    `Guard decisions that repeat an ask above and are counted once: ${num(r.outcomes.repeats)}.`,
    ...(testAgents.length
      ? ['', `Asks left out as test traffic (${testAgents.join(', ')}): ${num(r.outcomes.tests)}.`]
      : []),
    ...(r.outcomes.incompletePairs
      ? ['', `Outcome search stopped early for ${r.outcomes.incompletePairs} agent and action-type pairs with too many records to page through, so approvals may be undercounted.`]
      : []),
    '',
    '## How to read this',
    '',
    '- A governed action is one guard decision of any kind: allow, warn, ask or block.',
    '- An approval ask is one question an agent put to the guard that came back `require_approval`. One ask can write two such decisions: the guard call and then the call that records the action, or the same ask repeated while its request is still open. Those are counted once.',
    '- An ask never opened a request when no action record followed the guard decision. Older servers left opening the request to a second call from the agent. Current ones open it in the guard call, unless the caller sends `?record=false` or `self_test: true`.',
    '- Agents named with `--test-agents` are left out of the ask counts. Their guard decisions stay in the governed-action totals.',
    '- A floor probe is the scheduled self-test in `scripts/catastrophe-floor-probe.mjs`. It tries five destructive commands and expects to be stopped. Nobody is asked, so probes are counted apart and kept out of the rate.',
    `- Blocks in the window: ${num(r.blocks)}.`,
    `- "If accepted" replays the window one day at a time with the product's own loosening, tuning and interruption-budget engines over a ${r.windowDays}-day evidence window, accepts every actionable proposal on the day it appears, and removes a later ask only when every policy that matched it had been relaxed.`,
    '',
    '## Limits',
    '',
    `- The replay uses today's ${num(r.policyCount)} policies. Edits made to them during the window are not replayed.`,
    `- The first ${r.windowDays} days of the window see less evidence than the product had, because asks from before the window are not read.`,
    '- Precedent proposals are not replayed: they need evidence flags the API does not return.',
    '- Decisions with no agent id are counted as governed actions but not as an agent.',
    '- A repeat is matched on agent, action type and goal. The payload of the action is not compared.',
    '',
    '## Checks',
    '',
    `${passed} of ${r.checks.length} checks passed.`,
    '',
    ...r.checks.map((c) => `- ${c.ok ? 'ok' : 'FAILED'} \`${c.name}\`: ${c.detail}`),
    '',
    'Run it against your own instance: `node --import tsx scripts/fleet-replay.mjs --weeks 13`, with `DASHCLAW_URL` and `DASHCLAW_API_KEY` set. Add `--sabotage` to watch the checks fail on corrupted data.',
    '',
  ];
  return lines.join('\n');
}

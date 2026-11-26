#!/usr/bin/env node
// Fleet replay: how often did this DashClaw instance stop an agent and ask a human, week by
// week, and what would that number have been if every loosening and tuning proposal had been
// accepted on the day it appeared?
//
//   node --import tsx scripts/fleet-replay.mjs [--weeks 13] [--out docs/proof/<file>.md]
//     [--test-agents id,id] [--sabotage]
//
// --test-agents names agents whose asks are test traffic; they are left out of the ask counts.
// Read-only: GET requests against the instance's own API, with DASHCLAW_URL (or
// DASHCLAW_BASE_URL) and DASHCLAW_API_KEY from the environment. Nothing is written to the
// instance. It sends one request a second, so 13 weeks of a busy fleet takes about 15 minutes.
// --sabotage corrupts the fetched data on purpose; the checks must then fail.
// Exit codes: 0 report written, 1 a check failed, 2 usage or environment, 3 sabotage went unnoticed.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DAY_MS,
  attachOutcomes,
  buildWeeks,
  isProbe,
  markRepeats,
  renderMarkdown,
  replayWhatIf,
  runChecks,
  sabotage,
  summarizeOutcomes,
  weekBounds,
  weeklyFromCumulative,
} from './lib/fleet-replay.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const WEEKS = Number(flag('--weeks') ?? 13);
const OUT = flag('--out');
const SABOTAGE = argv.includes('--sabotage');
const TEST_AGENTS = (flag('--test-agents') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const BASE = (process.env.DASHCLAW_BASE_URL || process.env.DASHCLAW_URL || '').replace(/\/$/, '');
const KEY = process.env.DASHCLAW_API_KEY;

if (!BASE || !KEY || !Number.isInteger(WEEKS) || WEEKS < 1 || WEEKS > 52) {
  console.error('usage: node --import tsx scripts/fleet-replay.mjs [--weeks 1..52] [--out file.md] [--test-agents id,id] [--sabotage]');
  console.error('needs DASHCLAW_URL (or DASHCLAW_BASE_URL) and DASHCLAW_API_KEY in the environment');
  process.exit(2);
}

const WINDOW_DAYS = 30; // the /policies page default for both engines
const PAGE = 200; // the API's largest page
const DECISION_TYPES = ['allow', 'allow_contained', 'warn', 'require_approval', 'block'];
const MAX_ACTION_PAGES = 20; // per agent and action-type pair; a pair that hits it is reported
// The API allows 100 requests a minute per client address by default (middleware.shared.js),
// and the fleet's own guard calls from the same machine share that allowance. Stay well under.
const REQUEST_GAP_MS = 1000;
const LIMIT_WINDOW_MS = 61_000;

let requests = 0;
let nextSlot = 0;
const log = (m) => console.error(`[fleet-replay] ${m}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(pathAndQuery) {
  for (let attempt = 1; ; attempt++) {
    const now = Date.now();
    const startAt = Math.max(now, nextSlot);
    nextSlot = startAt + REQUEST_GAP_MS;
    if (startAt > now) await sleep(startAt - now);
    requests++;
    let res;
    try {
      res = await fetch(BASE + pathAndQuery, { headers: { 'x-api-key': KEY }, signal: AbortSignal.timeout(90_000) });
    } catch (err) {
      if (attempt === 4) throw err;
      continue;
    }
    if (res.ok) return res.json();
    if (attempt === 4 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`HTTP ${res.status} on ${pathAndQuery.split('?')[0]}`);
    }
    // A 429 clears when the limiter's minute turns over; hold every request until then.
    if (res.status === 429) nextSlot = Math.max(nextSlot, Date.now() + LIMIT_WINDOW_MS);
  }
}

/** Run fn over items, at most `size` at a time, keeping order. */
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

const since = (ms) => `since=${encodeURIComponent(new Date(ms).toISOString())}`;
const decisionCount = async (query) => (await get(`/api/guard/decisions?limit=1&${query}`)).total;

async function main() {
  const endMs = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const bounds = weekBounds(endMs, WEEKS);
  const startMs = bounds[0];
  log(`window ${new Date(startMs).toISOString().slice(0, 10)} to ${new Date(endMs).toISOString().slice(0, 10)} (${WEEKS} weeks)`);

  // 1. Counts. The API filters by "since" only, so every count also includes decisions made
  //    after the window ends, and more arrive while we count. Each count is taken between two
  //    reads of that tail and kept only when the tail did not move.
  const windowCount = async (filter, ms) => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const tail = await decisionCount(`${filter}${since(endMs)}`);
      const n = await decisionCount(`${filter}${since(ms)}`);
      if ((await decisionCount(`${filter}${since(endMs)}`)) === tail) return n - tail;
    }
    throw new Error('decisions kept arriving while counting; run it again when the fleet is quieter');
  };
  const cumulative = [];
  for (const b of bounds.slice(0, -1)) cumulative.push(await windowCount('', b));
  cumulative.push(0);
  const typeTotals = {};
  for (const t of DECISION_TYPES) typeTotals[t] = await windowCount(`decision=${t}&`, startMs);
  let weeklyDecisions = weeklyFromCumulative(cumulative);
  log(`governed actions in window: ${cumulative[0]}`);

  // 2. Every approval ask in the window.
  let askRows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = (await get(`/api/guard/decisions?decision=require_approval&${since(startMs)}&limit=${PAGE}&offset=${offset}`)).decisions || [];
    askRows.push(...page);
    if (page.length < PAGE) break;
  }
  askRows = askRows.filter((r) => Date.parse(r.created_at) < endMs);
  log(`approval asks fetched: ${askRows.length} (API counts ${typeTotals.require_approval})`);

  if (SABOTAGE) {
    ({ askRows, weeklyDecisions } = sabotage({ askRows, weeklyDecisions }));
    log('SABOTAGE: dropped a third of the rows, repeated one, added 1,000 decisions to the last week');
  }

  // Refuse to compute a rate from counts that do not agree with each other.
  const base = { bounds, weeklyDecisions, typeTotals, askRows, apiAskTotal: typeTotals.require_approval };
  const early = runChecks({
    ...base,
    agentDecisionSum: 0,
    weeks: buildWeeks({ ...base, removed: new Set(), agentsPerWeek: [] }),
  });
  const earlyFailed = early.filter((c) => !c.ok);
  if (earlyFailed.length) {
    for (const c of earlyFailed) console.error(`FAILED ${c.name}: ${c.detail}`);
    console.error(`${earlyFailed.length} of ${early.length} checks failed; no report written (${requests} requests).`);
    return 1;
  }
  if (SABOTAGE) {
    console.error(`SABOTAGE WENT UNNOTICED: ${early.length} of ${early.length} checks passed on corrupted data.`);
    return 3;
  }

  // 3. Policies as they stand today.
  const policies = (await get('/api/policies')).policies || [];

  // 4. What a human answered: the action record behind each real ask. There is no lookup by
  //    decision id, so search each agent and action-type pair, newest first. An action record
  //    carries its decision's risk score, which narrows the search.
  const pairs = new Map();
  for (const a of askRows.filter((r) => !isProbe(r))) {
    if (!a.agent_id && !a.action_type) continue;
    const pairKey = `${a.agent_id ?? ''}\n${a.action_type ?? ''}`;
    const pair = pairs.get(pairKey)
      ?? { agent_id: a.agent_id, action_type: a.action_type, ids: new Set(), minRisk: Infinity, oldestMs: Infinity };
    pair.ids.add(String(a.id));
    pair.minRisk = Math.min(pair.minRisk, Number(a.risk_score) || 0);
    pair.oldestMs = Math.min(pair.oldestMs, Date.parse(a.created_at));
    pairs.set(pairKey, pair);
  }
  let incompletePairs = 0;
  const found = await pool([...pairs.values()], 2, async (pair) => {
    const filter = [
      pair.agent_id ? `agent_id=${encodeURIComponent(pair.agent_id)}` : '',
      pair.action_type ? `action_type=${encodeURIComponent(pair.action_type)}` : '',
      `risk_min=${pair.minRisk}`,
    ].filter(Boolean).join('&');
    const matched = [];
    for (let page = 0; page < MAX_ACTION_PAGES; page++) {
      const rows = (await get(`/api/actions?days=${WEEKS * 7 + 2}&${filter}&limit=${PAGE}&offset=${page * PAGE}`)).actions || [];
      matched.push(...rows.filter((r) => r.guard_decision_id && pair.ids.has(String(r.guard_decision_id))));
      if (rows.length < PAGE || matched.length >= pair.ids.size) return matched;
      // Newest first: once a page is older than the oldest ask, nothing further can match.
      if (Date.parse(rows.at(-1).created_at) < pair.oldestMs - DAY_MS) return matched;
    }
    incompletePairs++;
    return matched;
  });
  const asksWithOutcomes = markRepeats(attachOutcomes(askRows, found.flat()));
  const outcomes = { ...summarizeOutcomes(asksWithOutcomes, TEST_AGENTS), incompletePairs };
  log(`outcomes: ${outcomes.asks} asks (${outcomes.approved} approved, ${outcomes.denied} denied, ${outcomes.unanswered} unanswered in the inbox, ${outcomes.neverOpened} never opened a request); ${outcomes.repeats} repeats and ${outcomes.tests} test asks left out; ${pairs.size} pairs searched, ${incompletePairs} stopped at the page cap`);

  // 5. Which agents were governed each week. Counts since a boundary never rise as the
  //    boundary moves later, so equal counts at two boundaries settle every week between them.
  const roster = ((await get('/api/agents?include_synthetic=true')).agents || []).map((a) => a.agent_id).filter(Boolean);
  const perAgent = await pool(roster, 3, async (id) => {
    const count = (ms) => decisionCount(`agent_id=${encodeURIComponent(id)}&${since(ms)}`);
    const cum = new Array(bounds.length);
    cum[0] = await count(startMs);
    if (cum[0] === 0) return null;
    cum[WEEKS] = await count(endMs);
    const fill = async (lo, hi) => {
      if (hi - lo < 2) return;
      if (cum[lo] === cum[hi]) {
        cum.fill(cum[lo], lo + 1, hi);
        return;
      }
      const mid = (lo + hi) >> 1;
      cum[mid] = await count(bounds[mid]);
      await fill(lo, mid);
      await fill(mid, hi);
    };
    await fill(0, WEEKS);
    // An agent working right now adds decisions while it is being counted; a week counts as
    // active only when it holds more decisions than arrived during the count.
    const arrived = Math.max(0, (await count(endMs)) - cum[WEEKS]);
    return { weekly: weeklyFromCumulative(cum), arrived, total: cum[0] - cum[WEEKS] };
  });
  const counted = perAgent.filter(Boolean);
  const agentsPerWeek = weeklyDecisions.map((_, i) => counted.filter((a) => a.weekly[i] > a.arrived).length);
  const agentDecisionSum = counted.reduce((s, a) => s + Math.max(0, a.total - a.arrived), 0);
  const agentsInWindow = counted.filter((a) => a.weekly.some((n) => n > a.arrived)).length;
  log(`agents: ${agentsInWindow} of ${roster.length} on the roster were governed in the window`);

  // 6. Replay and report.
  const { removed, accepted } = replayWhatIf({ asks: asksWithOutcomes, policies, startMs, endMs, windowDays: WINDOW_DAYS });
  const weeks = buildWeeks({ ...base, askRows: asksWithOutcomes, removed, agentsPerWeek, testAgents: TEST_AGENTS });
  const checks = runChecks({ ...base, removed, agentDecisionSum, weeks });
  const markdown = renderMarkdown({
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    weeks,
    accepted,
    checks,
    outcomes,
    testAgents: TEST_AGENTS,
    blocks: typeTotals.block,
    policyCount: policies.length,
    agentsInWindow,
  });
  console.log(markdown);

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`${failed.length} of ${checks.length} checks failed; no report written (${requests} requests).`);
    return 1;
  }
  if (OUT) {
    mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    writeFileSync(OUT, markdown);
    log(`wrote ${OUT}`);
  }
  log(`${checks.length} of ${checks.length} checks passed, ${accepted.length} proposals accepted, ${removed.size} asks removed (${requests} requests)`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[fleet-replay] failed after ${requests} requests: ${err.message}`);
    process.exit(1);
  },
);

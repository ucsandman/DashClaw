'use client';

import { useRef, useState } from 'react';

type Decision = 'allow' | 'warn' | 'block' | 'require_approval';

const DECISION_META: Record<Decision, { label: string; cls: string }> = {
  allow: { label: 'allow', cls: 'text-status-success bg-status-success-subtle' },
  warn: { label: 'warn', cls: 'text-status-warning bg-status-warning-subtle' },
  block: { label: 'block', cls: 'text-status-error bg-status-error-subtle' },
  require_approval: { label: 'require_approval', cls: 'text-status-info bg-status-info-subtle' },
};

function DecisionChip({ decision }: { decision: Decision }) {
  const meta = DECISION_META[decision];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-0.5 font-mono text-xs ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

const metaLabel = 'font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary';
const card = 'rounded-xl border border-border bg-surface-secondary';
const btn = 'cursor-pointer rounded-lg border border-border bg-surface-tertiary px-3.5 py-2 text-sm text-text-primary transition-colors hover:border-hover';
const input = 'rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary';

/* ---- The problem: an agent's afternoon, twice ---- */

const FEED_EVENTS: { time: string; type: string; goal: string; decision: Decision }[] = [
  { time: '02:02', type: 'review', goal: 'Read the failing test and the module it covers', decision: 'allow' },
  { time: '02:09', type: 'apply', goal: 'Patch the null check and update the test', decision: 'allow' },
  { time: '02:21', type: 'build', goal: 'npm install a new transitive dependency', decision: 'warn' },
  { time: '02:34', type: 'shell', goal: 'git push --force origin main, to clean up history', decision: 'require_approval' },
  { time: '02:48', type: 'security', goal: 'cat .env.local to debug the failing request', decision: 'block' },
  { time: '03:03', type: 'sql', goal: 'DROP TABLE sessions to reset the schema', decision: 'block' },
];

export function GovernanceFeed() {
  const [governed, setGoverned] = useState(false);
  const intercepted = FEED_EVENTS.filter((ev) => ev.decision !== 'allow').length;

  const modeBtn = (active: boolean) =>
    active
      ? 'cursor-pointer rounded-lg border border-brand bg-brand px-3.5 py-2 text-sm font-semibold text-surface-primary'
      : btn;

  return (
    <div>
      <div role="group" aria-label="Governance mode" className="my-4 flex gap-2">
        <button type="button" className={modeBtn(!governed)} aria-pressed={!governed} onClick={() => setGoverned(false)}>
          Ungoverned
        </button>
        <button type="button" className={modeBtn(governed)} aria-pressed={governed} onClick={() => setGoverned(true)}>
          Governed
        </button>
      </div>
      <ol className="grid gap-2">
        {FEED_EVENTS.map((ev) => (
          <li key={ev.time} className={`${card} flex items-center gap-3 px-3.5 py-2.5`}>
            <span className="font-mono text-xs tabular-nums text-text-tertiary">{ev.time}</span>
            <code className="font-mono text-xs text-text-tertiary">{ev.type}</code>
            <span className="flex-1 text-sm text-text-secondary">{ev.goal}</span>
            {governed ? (
              <DecisionChip decision={ev.decision} />
            ) : (
              <span className="font-mono text-xs text-text-tertiary">executed silently</span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-4 font-mono text-[13px] text-text-tertiary" aria-live="polite">
        {governed
          ? `${intercepted} of ${FEED_EVENTS.length} actions intercepted before execution. Every one of the ${FEED_EVENTS.length} is now in the decision ledger.`
          : `${FEED_EVENTS.length} actions executed. No record, no policy check, no approval. You find out in the morning, when main is gone.`}
      </p>
    </div>
  );
}

/* ---- The governance loop: step-through walkthrough ---- */

const LOOP_STEPS = [
  {
    n: 1,
    name: 'Guard',
    q: '"Can I do this?"',
    method: 'POST',
    path: '/api/guard',
    explain:
      'Before acting, the agent declares what it intends to do, and attaches the real act (the command, the SQL, the request). The server classifies risk from that evidence, and evidence can only raise the risk, never lower it. The runtime evaluates active policies, then answers: allow, warn, block, or require_approval. Nothing has happened yet; this is interception before execution.',
    payload: `{
  "action_type": "shell",
  "declared_goal": "Force-push the rebased branch",
  "act": { "kind": "shell",
           "command": "git push --force origin main" }
}
// -> { "decision": "require_approval", "risk_score": 85,
//      "signals": ["vcs_dangerous", "High risk score"], ... }`,
  },
  {
    n: 2,
    name: 'Record',
    q: '"I am doing this."',
    method: 'POST',
    path: '/api/actions',
    explain:
      'The agent records the action in the ledger before executing. Recording runs guard evaluation internally too: a blocked action is stored as blocked and refused. An idempotency key makes retries safe: the same key returns the existing record instead of a duplicate.',
    payload: `{
  "agent_id": "deploy-agent-1",
  "action_type": "deploy",
  "declared_goal": "Deploy build #402 to production",
  "idempotency_key": "sha256:..."
}
// -> { "action_id": "act_...", "status": "running" }`,
  },
  {
    n: 3,
    name: 'Approve',
    q: '"A human decides, from anywhere."',
    method: 'POST',
    path: '/api/approvals/:actionId',
    explain:
      'require_approval freezes the action and pages a human, who resolves it with one click from the Approvals inbox, the CLI, a phone, Telegram, or Discord. The SDK’s waitForApproval() unblocks near-instantly over SSE, falling back to polling. Grants are single-use and bound to the exact action; a block has no approval path at all.',
    payload: `// The agent, frozen mid-run:
if (g.decision === 'require_approval') {
  await claw.waitForApproval(action.action_id);
}
// You, from bed: one tap on Approve or Deny.
// approved -> the wait resolves, the run continues
// denied   -> the action never executes`,
  },
  {
    n: 4,
    name: 'Outcome',
    q: '"This actually completed, or failed."',
    method: 'POST',
    path: '/api/actions/:actionId/outcome',
    explain:
      'The agent reports the terminal result: completed, partial, or failed. First terminal outcome wins; a later report is rejected. failed requires an error message; partial requires a progress object. The ledger now holds the full story: intent, decision, beliefs, result.',
    payload: `{
  "status": "completed",
  "summary": "Success: build #402 is live."
}
// A later POST -> 409 { "error": "outcome already set" }`,
  },
];

export function LoopWalkthrough() {
  const [index, setIndex] = useState(0);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const step = LOOP_STEPS[index] ?? LOOP_STEPS[0]!;

  const move = (next: number) => {
    setIndex(next);
    tabsRef.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Governance loop steps"
        className="my-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') move((index + 1) % 4);
          if (e.key === 'ArrowLeft') move((index + 3) % 4);
        }}
      >
        {LOOP_STEPS.map((s, i) => (
          <button
            key={s.n}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-controls="loop-detail"
            ref={(node) => {
              tabsRef.current[i] = node;
            }}
            onClick={() => setIndex(i)}
            className={`cursor-pointer rounded-lg border p-3.5 text-left transition-colors ${
              i === index ? 'border-active bg-brand-subtle' : 'border-border bg-surface-secondary hover:border-hover'
            }`}
          >
            <div className={metaLabel}>Step {s.n}</div>
            <div className="mt-1 font-semibold text-text-primary">{s.name}</div>
          </button>
        ))}
      </div>
      <div id="loop-detail" role="tabpanel" aria-live="polite" className={`${card} p-5`}>
        <div className={metaLabel}>
          Step {step.n} of 4, {step.q}
        </div>
        <div className="my-2.5 font-mono text-sm text-text-primary">
          {step.method} {step.path}
        </div>
        <p className="mb-3.5 max-w-[70ch] text-text-secondary">{step.explain}</p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface-primary p-3.5 font-mono text-[12.5px] leading-relaxed text-text-secondary">
          {step.payload}
        </pre>
      </div>
    </div>
  );
}

/* ---- Guard decision simulator (illustrative) ---- */

const BAND_WARN = 40; // real band: >= 40 is elevated
const BAND_HIGH = 70; // real band: >= 70 is high risk

const SIM_ACTION_TYPES: Record<string, { base: number; label: string }> = {
  'data.read': { base: 10, label: 'Read data' },
  'message.send': { base: 25, label: 'Send a message' },
  'file.write': { base: 30, label: 'Write a file' },
  'file.delete': { base: 55, label: 'Delete files' },
  'payment.create': { base: 60, label: 'Create a payment' },
  deploy: { base: 65, label: 'Deploy' },
};

function assessRisk({
  actionType,
  spendUsd,
  irreversible,
  production,
  trust,
}: {
  actionType: string;
  spendUsd: number;
  irreversible: boolean;
  production: boolean;
  trust: number;
}) {
  const signals: { delta: number; label: string }[] = [];
  let score = SIM_ACTION_TYPES[actionType]?.base ?? 0;
  signals.push({ delta: score, label: `base risk for ${actionType}` });
  if (spendUsd > 0) {
    const d = Math.min(30, Math.round(Math.sqrt(spendUsd) / 2));
    if (d > 0) {
      score += d;
      signals.push({ delta: d, label: `$${spendUsd} spend` });
    }
  }
  if (irreversible) {
    score += 15;
    signals.push({ delta: 15, label: 'irreversible' });
  }
  if (production) {
    score += 15;
    signals.push({ delta: 15, label: 'touches production' });
  }
  const trustAdj = Math.round((50 - trust) / 5);
  if (trustAdj !== 0) signals.push({ delta: trustAdj, label: trust < 50 ? 'weak agent track record' : 'strong agent track record' });
  score = Math.max(0, Math.min(100, score + trustAdj));
  return { score, signals };
}

function decideFromScore(score: number, requireApprovalHighRisk: boolean): Decision {
  if (score >= BAND_HIGH) return requireApprovalHighRisk ? 'require_approval' : 'block';
  if (score >= BAND_WARN) return 'warn';
  return 'allow';
}

const DECISION_EXPLAIN: Record<Decision, string> = {
  allow: 'Below the elevated band. The action proceeds and is recorded.',
  warn: 'Elevated. The action proceeds, but the decision and its signals go to the ledger and the risk feed.',
  block: 'High risk with no approval path configured. The action is refused and recorded as blocked. Blocks are absolute.',
  require_approval:
    'High risk. Execution pauses until a human approves: dashboard, CLI, or chat. An approval covers the identical action for 15 minutes.',
};

const fieldLabel = 'grid gap-1 text-[13px] text-text-tertiary';

export function GuardSimulator() {
  const [actionType, setActionType] = useState('deploy');
  const [spend, setSpend] = useState('0');
  const [irreversible, setIrreversible] = useState(false);
  const [production, setProduction] = useState(false);
  const [trust, setTrust] = useState(50);
  const [approvalPolicy, setApprovalPolicy] = useState(true);

  const { score, signals } = assessRisk({
    actionType,
    spendUsd: Number(spend) || 0,
    irreversible,
    production,
    trust,
  });
  const decision = decideFromScore(score, approvalPolicy);
  const trustLabel = trust < 34 ? 'new / erratic' : trust < 67 ? 'established' : 'long, clean history';
  const fillClass = score >= BAND_HIGH ? 'bg-status-error' : score >= BAND_WARN ? 'bg-status-warning' : 'bg-status-success';

  return (
    <div className="mt-5 grid gap-5 md:grid-cols-[340px_1fr]">
      <form className={`${card} grid gap-3.5 p-5`}>
        <label className={fieldLabel}>
          Action type
          <select className={input} value={actionType} onChange={(e) => setActionType(e.target.value)}>
            {Object.entries(SIM_ACTION_TYPES).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label} ({value})
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          Spend (USD)
          <input className={input} type="number" min={0} max={100000} value={spend} onChange={(e) => setSpend(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-text-tertiary">
          <input type="checkbox" checked={irreversible} onChange={(e) => setIrreversible(e.target.checked)} /> Irreversible
        </label>
        <label className="flex items-center gap-2 text-[13px] text-text-tertiary">
          <input type="checkbox" checked={production} onChange={(e) => setProduction(e.target.checked)} /> Touches production
        </label>
        <label className={fieldLabel}>
          Agent track record
          <input type="range" min={0} max={100} value={trust} onChange={(e) => setTrust(Number(e.target.value))} />
          <span className="font-mono text-xs">{trustLabel}</span>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-text-tertiary">
          <input type="checkbox" checked={approvalPolicy} onChange={(e) => setApprovalPolicy(e.target.checked)} /> Policy: high risk
          requires human approval
        </label>
      </form>
      <div className={`${card} p-5`} aria-live="polite">
        <div className={metaLabel}>Decision</div>
        <div className="my-2.5">
          <DecisionChip decision={decision} />
          <p className="mt-2 text-sm text-text-secondary">{DECISION_EXPLAIN[decision]}</p>
        </div>
        <div className={`${metaLabel} mt-3.5`}>Risk score</div>
        <div className="my-2.5">
          <div
            role="img"
            aria-label={`Risk score ${score} of 100`}
            className="relative h-2.5 overflow-hidden rounded-[5px] bg-surface-elevated"
          >
            <div
              className={`h-full ${fillClass} transition-[width] duration-200 motion-reduce:transition-none`}
              style={{ width: `${score}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-text-tertiary">
            <span>0</span>
            <span>40 &middot; warn</span>
            <span>70 &middot; high</span>
            <span className="tabular-nums">{score} / 100</span>
          </div>
        </div>
        <div className={`${metaLabel} mt-3.5`}>Why</div>
        <ul className="mt-2 list-disc pl-[18px] font-mono text-[12.5px] text-text-secondary">
          {signals.map((s) => (
            <li key={s.label}>
              {s.delta >= 0 ? '+' : ''}
              {s.delta}&ensp;{s.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---- Policy playground (illustrative) ---- */

const SAMPLE_ACTIONS = [
  { goal: 'Read the failing test file', type: 'review', path: '__tests__/auth.test.ts', risk: 8 },
  { goal: 'Patch the null check', type: 'apply', path: 'src/auth.ts', risk: 22 },
  { goal: 'Update the deploy workflow', type: 'apply', path: '.github/workflows/deploy.yml', risk: 34 },
  { goal: 'npm install a new dependency', type: 'build', path: 'package.json', risk: 48 },
  { goal: 'Read .env.local to debug a request', type: 'security', path: '.env.local', risk: 66 },
  { goal: 'git push --force origin main', type: 'shell', path: '', risk: 74 },
  { goal: 'Delete stale build artifacts', type: 'file.delete', path: 'dist/', risk: 58 },
  { goal: 'Deploy the hotfix to production', type: 'deploy', path: '', risk: 82 },
];

function evaluatePolicy(
  action: (typeof SAMPLE_ACTIONS)[number],
  policy: { protectedPaths: string[]; approveAt: number; blockedTypes: string[] },
): { decision: Decision; because: string } {
  if (policy.blockedTypes.includes(action.type)) {
    return { decision: 'block', because: `action type ${action.type} is blocked by policy` };
  }
  const hit = policy.protectedPaths.find((p) => p && action.path && action.path.startsWith(p));
  if (hit) {
    return { decision: 'require_approval', because: `touches protected path ${hit}` };
  }
  if (action.risk >= policy.approveAt) {
    return { decision: 'require_approval', because: `risk ${action.risk} >= approval threshold ${policy.approveAt}` };
  }
  if (action.risk >= BAND_WARN) {
    return { decision: 'warn', because: `risk ${action.risk} is in the elevated band (>= ${BAND_WARN})` };
  }
  return { decision: 'allow', because: `risk ${action.risk} is below the elevated band` };
}

const BLOCKABLE_TYPES = ['file.delete', 'security', 'deploy'];

export function PolicyPlayground() {
  const [paths, setPaths] = useState('.env, .github/workflows');
  const [approveAt, setApproveAt] = useState('70');
  const [blockedTypes, setBlockedTypes] = useState<string[]>(['file.delete']);

  const approveNum = Number(approveAt);
  const policy = {
    protectedPaths: paths.split(',').map((p) => p.trim()).filter(Boolean),
    approveAt: approveAt.trim() === '' || !Number.isFinite(approveNum) ? 100 : Math.max(0, Math.min(100, approveNum)),
    blockedTypes,
  };

  const toggleBlocked = (type: string, checked: boolean) =>
    setBlockedTypes((prev) => (checked ? [...prev, type] : prev.filter((t) => t !== type)));

  return (
    <div>
      <div className={`${card} my-5 flex flex-wrap items-center gap-5 px-5 py-4`}>
        <label className={fieldLabel}>
          Protected paths (comma-separated)
          <input className={`${input} w-[240px]`} type="text" value={paths} onChange={(e) => setPaths(e.target.value)} />
        </label>
        <fieldset className="flex gap-3 border-0 text-[13px] text-text-tertiary">
          <legend className={`${metaLabel} mb-1`}>Blocked action types</legend>
          {BLOCKABLE_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={blockedTypes.includes(type)}
                onChange={(e) => toggleBlocked(type, e.target.checked)}
              />{' '}
              {type}
            </label>
          ))}
        </fieldset>
        <label className={fieldLabel}>
          Require approval at risk &gt;=
          <input
            className={`${input} w-[90px]`}
            type="number"
            min={0}
            max={100}
            value={approveAt}
            onChange={(e) => setApproveAt(e.target.value)}
          />
        </label>
      </div>
      <p className="mb-4 text-[13px] text-text-tertiary">
        These mirror real policy types: the path rule is protected_path, which pauses any action touching a path you name (the
        production evaluator also reads the attached act evidence). Blocked types and the risk threshold mirror block_action_type and
        risk_threshold, which apply to any action.
      </p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className={`${metaLabel} px-3.5 py-2.5 text-left font-normal`}>Action</th>
              <th className={`${metaLabel} px-3.5 py-2.5 text-left font-normal`}>Type</th>
              <th className={`${metaLabel} px-3.5 py-2.5 text-left font-normal`}>Path</th>
              <th className={`${metaLabel} px-3.5 py-2.5 text-right font-normal`}>Risk</th>
              <th className={`${metaLabel} px-3.5 py-2.5 text-left font-normal`}>Decision</th>
              <th className={`${metaLabel} px-3.5 py-2.5 text-left font-normal`}>Because</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ACTIONS.map((a) => {
              const { decision, because } = evaluatePolicy(a, policy);
              return (
                <tr key={a.goal} className="border-t border-border">
                  <td className="px-3.5 py-2.5 text-text-secondary">{a.goal}</td>
                  <td className="px-3.5 py-2.5">
                    <code className="font-mono text-xs text-text-tertiary">{a.type}</code>
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-xs text-text-tertiary">
                    {a.path || '·'}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-xs tabular-nums text-text-tertiary">{a.risk}</td>
                  <td className="px-3.5 py-2.5">
                    <DecisionChip decision={decision} />
                  </td>
                  <td className="px-3.5 py-2.5 text-[12.5px] text-text-tertiary">{because}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- One action, four integrations ---- */

type Scenario = { id: string; label: string; type: string; goal: string };

const INT_SCENARIOS: Scenario[] = [
  { id: 'email', label: 'Send a customer email', type: 'message.send', goal: 'Send the renewal reminder to acme-corp' },
  { id: 'force-push', label: 'Force-push over main', type: 'shell', goal: 'Force-push the rebased branch over main' },
  { id: 'deploy', label: 'Deploy to production', type: 'deploy', goal: 'Deploy build #402 to production' },
];

const INT_STYLES: { id: string; label: string; render: (s: Scenario) => string }[] = [
  {
    id: 'node',
    label: 'Node SDK',
    render: (s) => `import { DashClaw, GuardBlockedError } from 'dashclaw';

const claw = new DashClaw({ baseUrl, apiKey, agentId: 'my-agent' });

const decision = await claw.guard({
  action_type: '${s.type}',
  declared_goal: '${s.goal}',
});
if (decision.decision === 'block') throw new GuardBlockedError(decision);

const { action, action_id } = await claw.createAction({
  action_type: '${s.type}',
  declared_goal: '${s.goal}',
  idempotency_key: claw.deriveIdempotencyKey({
    agent_id: 'my-agent', action_type: '${s.type}', declared_goal: '${s.goal}',
  }),
});
if (action?.status === 'pending_approval') await claw.waitForApproval(action_id);

try {
  await doTheWork();
  await claw.reportActionSuccess(action_id, 'Done.');
} catch (err) {
  await claw.reportActionFailure(action_id, err.message);
  throw err;
}`,
  },
  {
    id: 'python',
    label: 'Python SDK',
    render: (s) => `from dashclaw import DashClaw, GuardBlockedError

claw = DashClaw(base_url=base_url, api_key=api_key, agent_id="my-agent")

decision = claw.guard({
    "action_type": "${s.type}",
    "declared_goal": "${s.goal}",
})
if decision["decision"] == "block":
    raise GuardBlockedError(decision)

result = claw.create_action(
    action_type="${s.type}",
    declared_goal="${s.goal}",
    idempotency_key=claw.derive_idempotency_key({
        "agent_id": "my-agent", "action_type": "${s.type}", "declared_goal": "${s.goal}",
    }),
)
if result["action"]["status"] == "pending_approval":
    claw.wait_for_approval(result["action_id"])

try:
    do_the_work()
    claw.report_action_success(result["action_id"], "Done.")
except Exception as err:
    claw.report_action_failure(result["action_id"], str(err))
    raise`,
  },
  {
    id: 'mcp',
    label: 'MCP',
    render: (s) => `// In an MCP host (Claude Code, Claude Desktop, any MCP client)
// with @dashclaw/mcp-server connected, the agent calls tools:

dashclaw_guard({
  "action_type": "${s.type}",
  "declared_goal": "${s.goal}"
})
// -> decision: allow | warn | block | require_approval

dashclaw_record({
  "action_type": "${s.type}",
  "declared_goal": "${s.goal}",
  "status": "running"
})
// ...do the work, then report the outcome on the returned action_id.
// If approval is required, dashclaw_wait_for_approval(action_id)
// pauses until a human decides.`,
  },
  {
    id: 'http',
    label: 'Raw HTTP',
    render: (s) => `# 1. Guard: "Can I do this?"
curl -X POST "$DASHCLAW_URL/api/guard" \\
  -H "Authorization: Bearer $DASHCLAW_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"action_type":"${s.type}","declared_goal":"${s.goal}"}'

# 2. Record: "I am doing this."
curl -X POST "$DASHCLAW_URL/api/actions" \\
  -H "Authorization: Bearer $DASHCLAW_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_id":"my-agent","action_type":"${s.type}","declared_goal":"${s.goal}"}'

# 3. Do the work, then report the outcome.
curl -X POST "$DASHCLAW_URL/api/actions/$ACTION_ID/outcome" \\
  -H "Authorization: Bearer $DASHCLAW_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"completed","summary":"Done."}'`,
  },
];

export function IntegrationTabs() {
  const [scenarioId, setScenarioId] = useState('email');
  const [styleId, setStyleId] = useState('node');
  const [copyLabel, setCopyLabel] = useState('Copy');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scenario = INT_SCENARIOS.find((s) => s.id === scenarioId) ?? INT_SCENARIOS[0]!;
  const style = INT_STYLES.find((st) => st.id === styleId) ?? INT_STYLES[0]!;
  const code = style.render(scenario);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyLabel('Copied');
    } catch {
      setCopyLabel('Select + copy');
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyLabel('Copy'), 1600);
  };

  return (
    <div>
      <div className="my-4 flex gap-2">
        <select className={input} aria-label="Scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
          {INT_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div role="tablist" aria-label="Integration style" className="flex gap-2">
        {INT_STYLES.map((st) => (
          <button
            key={st.id}
            type="button"
            role="tab"
            aria-selected={st.id === styleId}
            aria-controls="integrate-code"
            onClick={() => setStyleId(st.id)}
            className={`cursor-pointer rounded-t-lg border px-3.5 py-2 text-sm transition-colors ${
              st.id === styleId ? 'border-active bg-brand-subtle text-text-primary' : 'border-border bg-surface-secondary text-text-secondary hover:border-hover'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>
      <div className={`${card} relative rounded-tl-none`}>
        <button type="button" onClick={copy} className={`${btn} absolute right-2.5 top-2.5 px-2.5 py-1 text-xs`}>
          {copyLabel}
        </button>
        <pre
          id="integrate-code"
          role="tabpanel"
          aria-label="Integration code"
          className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-text-secondary"
        >
          {code}
        </pre>
      </div>
    </div>
  );
}

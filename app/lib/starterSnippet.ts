/**
 * Canonical "first governed action" starter snippet for Node and Python.
 *
 * This is the single source of truth for the
 * `guard -> createAction -> recordAssumption -> updateOutcome` loop shown on
 * every "connect your first agent" surface (/connect, Approvals
 * QuickStart, /settings SDK panel).
 *
 * Why this matters: a snippet that calls `claw.guard()` alone does NOT create
 * a row in `action_records`, so Approvals stays empty and the user
 * concludes the product is broken. Every starter snippet MUST run the full
 * 4-step loop so the first action becomes visible evidence.
 *
 * Mirrors the canonical Node template in README.md (Quickstart section).
 */

const DEFAULT_AGENT_ID = 'my-first-agent';

interface StarterSnippetOptions {
  baseUrl?: string | null;
  apiKey?: string | null;
  agentId?: string;
}

/**
 * Render a JavaScript / Python string literal. JSON's double-quoted form is
 * a valid literal in both languages, so we can share the helper.
 */
function stringLiteral(value: string): string {
  return JSON.stringify(String(value));
}

/**
 * Return the canonical Node 4-step governance loop as a string.
 *
 * `baseUrl`/`apiKey`: when provided, baked into the snippet as a literal. When
 * null/undefined, the snippet reads `process.env.DASHCLAW_BASE_URL` /
 * `process.env.DASHCLAW_API_KEY`.
 */
export function getNodeStarterSnippet({
  baseUrl = null,
  apiKey = null,
  agentId = DEFAULT_AGENT_ID,
}: StarterSnippetOptions = {}): string {
  const baseUrlExpr = baseUrl ? stringLiteral(baseUrl) : 'process.env.DASHCLAW_BASE_URL';
  const apiKeyExpr = apiKey ? stringLiteral(apiKey) : 'process.env.DASHCLAW_API_KEY';

  return `// Run: node --env-file=.env demo.js
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: ${baseUrlExpr},
  apiKey: ${apiKeyExpr},
  agentId: ${stringLiteral(agentId)},
});

// 1. Guard -> "Can I do X?"
const decision = await claw.guard({
  action_type: 'database_query',
  risk_score: 50,
});

// 2. Record -> "I am attempting X."
const action = await claw.createAction({
  action_type: 'database_query',
  declared_goal: 'Extract user statistics',
});

// 3. Verify -> "I believe Y is true while doing X."
await claw.recordAssumption({
  action_id: action.action_id,
  assumption: 'The database is read-only for these credentials',
});

try {
  // Execute the real action here...

  // 4. Outcome -> "X finished with result Z."
  await claw.updateOutcome(action.action_id, { status: 'completed' });
} catch (error) {
  await claw.updateOutcome(action.action_id, {
    status: 'failed',
    error_message: error.message,
  });
}
`;
}

/**
 * Return the canonical Python 4-step governance loop as a string.
 *
 * `baseUrl`/`apiKey`: when provided, baked in as a literal. When null/undefined,
 * the snippet reads `os.environ['DASHCLAW_BASE_URL']` /
 * `os.environ['DASHCLAW_API_KEY']`.
 */
export function getPythonStarterSnippet({
  baseUrl = null,
  apiKey = null,
  agentId = DEFAULT_AGENT_ID,
}: StarterSnippetOptions = {}): string {
  const baseUrlExpr = baseUrl ? stringLiteral(baseUrl) : "os.environ['DASHCLAW_BASE_URL']";
  const apiKeyExpr = apiKey ? stringLiteral(apiKey) : "os.environ['DASHCLAW_API_KEY']";
  const needsOs = !baseUrl || !apiKey;
  const osImport = needsOs ? 'import os\n' : '';

  return `# Run: python demo.py
${osImport}from dashclaw import DashClaw

claw = DashClaw(
    base_url=${baseUrlExpr},
    api_key=${apiKeyExpr},
    agent_id=${stringLiteral(agentId)},
)

# 1. Guard -> "Can I do X?"
decision = claw.guard({
    "action_type": "database_query",
    "risk_score": 50,
})

# 2. Record -> "I am attempting X."
action = claw.create_action(
    action_type="database_query",
    declared_goal="Extract user statistics",
)
action_id = action["action_id"]

# 3. Verify -> "I believe Y is true while doing X."
claw.record_assumption({
    "action_id": action_id,
    "assumption": "The database is read-only for these credentials",
})

try:
    # Execute the real action here...

    # 4. Outcome -> "X finished with result Z."
    claw.update_outcome(action_id, status="completed")
except Exception as error:
    claw.update_outcome(
        action_id,
        status="failed",
        error_message=str(error),
    )
`;
}

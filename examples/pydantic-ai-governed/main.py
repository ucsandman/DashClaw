"""
Pydantic AI + DashClaw Governance Example

Demonstrates how to govern a Pydantic AI agent tool with the DashClaw 4-step
loop: guard → create_action → record_assumption → update_outcome.

Handles require_approval (HITL) and block decisions.
No LLM API key required — runs the governance flow directly. The Agent wiring
at the bottom shows how the same tool registers on a real Pydantic AI agent.
"""

import os
import time
from dotenv import load_dotenv
from dashclaw import DashClaw

load_dotenv()

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="pydantic-ai-db-agent",
)

# Each demo run is a distinct logical action. The SDK derives an idempotency
# key from (agent, type, goal, session) so blind retries dedupe — without a
# per-run session_id, re-running this script inside an hour would replay the
# previous (already-completed) action instead of creating a new one.
RUN_ID = f"demo-{int(time.time())}"


def governed_run_migration(migration_name: str, production: bool) -> str:
    """Run a database migration. Governed by DashClaw policies."""

    risk = 75 if production else 25
    goal = f"Run migration {migration_name} on {'production' if production else 'staging'}"

    # 1. GUARD: Check policy before executing
    result = claw.guard({
        "action_type": "database_migration",
        "declared_goal": goal,
        "risk_score": risk,
        "systems_touched": ["postgres"],
        "reversible": not production,
    })

    decision = result.get("decision", "allow")
    print(f"Guard decision: {decision}")

    if decision == "block":
        reasons = result.get("reasons", [])
        return f"BLOCKED: {', '.join(reasons)}"

    # 2. RECORD: Declare intent
    action = claw.create_action(
        "database_migration",
        goal,
        risk_score=risk,
        systems_touched=["postgres"],
        session_id=RUN_ID,
    )
    action_id = action["action_id"]
    print(f"Action recorded: {action_id}")

    # 3. HITL: Wait for approval if required
    if decision == "require_approval":
        print(f"Waiting for human approval of {action_id}...")
        try:
            claw.wait_for_approval(action_id, timeout=120, interval=5)
            print("Approved!")
        except Exception as e:
            claw.update_outcome(action_id, status="cancelled", error_message=str(e))
            return f"DENIED: {e}"

    # 4. ASSUMPTION: Record what we believe to be true
    claw.register_assumption(
        action_id,
        f"Migration {migration_name} is idempotent",
        basis="Migration uses IF NOT EXISTS guards throughout",
    )

    # 5. EXECUTE: Simulated migration (no real database needed)
    migration_result = f"Migration {migration_name} applied successfully."

    # 6. OUTCOME: Report result
    claw.update_outcome(
        action_id,
        status="completed",
        output_summary=migration_result,
    )

    return migration_result


# ── Production wiring: register the governed function as a Pydantic AI tool ──
# The governance calls above run identically when the model invokes the tool.
#
#   from pydantic_ai import Agent
#
#   agent = Agent(
#       'anthropic:claude-sonnet-4-6',
#       tools=[governed_run_migration],
#       instructions='You manage database migrations. Use the tool to run them.',
#   )
#   result = agent.run_sync('Apply the add-indexes migration to staging')
#
# For tests, override the model with TestModel (pydantic_ai.models.test) —
# it exercises the full agent loop, tools included, without an LLM key.

if __name__ == "__main__":
    print("=== Pydantic AI + DashClaw Governance Example ===\n")

    print("--- Staging migration (low risk) ---")
    result1 = governed_run_migration("add-indexes", production=False)
    print(f"Result: {result1}\n")

    print("--- Production migration (high risk, may require approval) ---")
    result2 = governed_run_migration("add-indexes", production=True)
    print(f"Result: {result2}\n")

    base = os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000")
    print(f"View governed decisions: {base}/decisions")

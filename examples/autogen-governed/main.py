"""
AutoGen + DashClaw Governance Example

Demonstrates how to govern an AutoGen tool with the DashClaw 4-step loop:
guard → create_action → record_assumption → update_outcome.

Handles require_approval (HITL) and block decisions.
No OPENAI_API_KEY required — runs the governance flow directly.
"""

import os
import time
from dotenv import load_dotenv
from dashclaw import DashClaw

load_dotenv()

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="autogen-deploy-agent",
)

# Each demo run is a distinct logical action. The SDK derives an idempotency
# key from (agent, type, goal, session) so blind retries dedupe — without a
# per-run session_id, re-running this script inside an hour would replay the
# previous (already-completed) action instead of creating a new one.
RUN_ID = f"demo-{int(time.time())}"


def governed_deploy_tool(environment: str) -> str:
    """Deploy to an environment. Governed by DashClaw policies."""

    # 1. GUARD: Check policy before executing
    result = claw.guard({
        "action_type": "deploy",
        "declared_goal": f"Deploy to {environment}",
        "risk_score": 70 if environment == "production" else 30,
        "systems_touched": [environment],
        "reversible": environment != "production",
    })

    decision = result.get("decision", "allow")
    print(f"Guard decision: {decision}")

    if decision == "block":
        reasons = result.get("reasons", [])
        return f"BLOCKED: {', '.join(reasons)}"

    # 2. RECORD: Declare intent
    action = claw.create_action(
        "deploy",
        f"Deploy to {environment}",
        risk_score=70 if environment == "production" else 30,
        systems_touched=[environment],
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
        f"Tests pass on {environment}",
        basis="CI pipeline green for current branch",
    )

    # 5. EXECUTE: Simulated deploy (no real infra needed)
    deploy_result = f"Successfully deployed to {environment}. Version: v2.9.0"

    # 6. OUTCOME: Report result
    claw.update_outcome(
        action_id,
        status="completed",
        output_summary=deploy_result,
    )

    return deploy_result


if __name__ == "__main__":
    print("=== AutoGen + DashClaw Governance Example ===\n")

    print("--- Deploy to staging (low risk) ---")
    result1 = governed_deploy_tool("staging")
    print(f"Result: {result1}\n")

    print("--- Deploy to production (high risk, may require approval) ---")
    result2 = governed_deploy_tool("production")
    print(f"Result: {result2}\n")

    base = os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000")
    print(f"View governed decisions: {base}/decisions")

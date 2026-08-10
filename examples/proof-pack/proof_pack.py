import os
from datetime import datetime, timezone
from urllib.parse import urljoin

from dashclaw import ApprovalDeniedError, DashClaw, GuardBlockedError


BASE_URL = os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000")
API_KEY = os.environ.get("DASHCLAW_API_KEY")
AGENT_ID = "proof-pack-demo"
DECLARED_GOAL = "Send a governed proof-of-connection action"

if not API_KEY:
    raise RuntimeError("Set DASHCLAW_API_KEY before running this example.")

claw = DashClaw(
    base_url=BASE_URL,
    api_key=API_KEY,
    agent_id=AGENT_ID,
    agent_name="Proof Pack demo",
)


def dashboard_url(action_id):
    return urljoin(f"{BASE_URL.rstrip('/')}/", f"decisions/{action_id}")


def main():
    # 1. Ask whether this action is allowed, then honor a block.
    decision = claw.guard({
        "action_type": "api_call",
        "declared_goal": DECLARED_GOAL,
        "risk_score": 20,
    })
    if decision["decision"] == "block":
        raise GuardBlockedError(decision)

    # 2. Create the durable action record that appears in DashClaw.
    result = claw.create_action(
        action_type="api_call",
        declared_goal=DECLARED_GOAL,
        risk_score=20,
    )
    action_id = result["action_id"]
    action = result.get("action", {})
    action_url = dashboard_url(action_id)
    print(f"Action recorded: {action_url}")

    # 3. Trust the server's action status, not just the guard response.
    if action.get("status") == "pending_approval":
        print(f"Waiting for approval: {urljoin(f'{BASE_URL.rstrip('/')}/', 'approvals')}")
        try:
            claw.wait_for_approval(action_id, timeout=300)
        except ApprovalDeniedError:
            print(f"Approval denied. Review the record: {action_url}")
            return

    # 4. Perform deterministic work and write a terminal outcome.
    try:
        proof = {"connected": True, "completedAt": datetime.now(timezone.utc).isoformat()}
        claw.record_assumption({
            "action_id": action_id,
            "assumption": "The configured API key belongs to the intended DashClaw workspace.",
        })
        claw.update_outcome(
            action_id,
            status="completed",
            output_summary=str(proof),
        )
        print(f"Proof complete: {action_url}")
    except Exception as error:
        claw.update_outcome(action_id, status="failed", error_message=str(error))
        raise


if __name__ == "__main__":
    main()

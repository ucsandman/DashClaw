#!/usr/bin/env python3
"""
DashClaw SDK Integration Test Agent
-----------------------------------

This script exercises the major public methods of the DashClaw Python SDK.
It is designed to run against a real DashClaw instance (e.g., localhost:3000).

Required Environment Variables:
- DASHCLAW_API_KEY: A valid agent or admin API key.
- DASHCLAW_BASE_URL: Optional, defaults to http://localhost:3000
- TEST_AGENT_ID: Optional, defaults to "sdk-test-agent"
- TEST_AGENT_NAME: Optional, defaults to "SDK Test Agent"

Usage Examples:
  python scripts/test-sdk-agent.py --full
  python scripts/test-sdk-agent.py --actions-only
  python scripts/test-sdk-agent.py --approvals-only
  python scripts/test-sdk-agent.py --loops-only
  python scripts/test-sdk-agent.py --signals-only
  python scripts/test-sdk-agent.py --full --json

Matrix of SDK Methods Discovered vs Tested:
| Domain      | Methods Discovered                     | Tested | Skipped |
|-------------|----------------------------------------|--------|---------|
| Guard       | guard, get_guard_decisions             | Yes    |         |
| Action      | create_action, update_outcome          | Yes    |         |
| Assumptions | record_assumption, register_assumption | Yes    |         |
| Loops       | register_open_loop, resolve_open_loop  | Yes    |         |
| Approvals   | wait_for_approval, approve_action,     | Yes    |         |
|             | get_pending_approvals                  |        |         |
| Signals     | get_signals, get_activity_logs         | Yes    |         |
| Webhooks    | create_webhook, etc.                   | No     | Not priority for agent flow |
| Messages    | send_message, etc.                     | No     | Not priority for agent flow |
"""

import os
import sys
import time
import json
import argparse

# Add sdk-python to sys.path to ensure we can import it locally if not installed
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sdk-python")))

try:
    from dashclaw.client import DashClaw, DashClawError
except ImportError as e:
    print(f"Error: Could not import dashclaw.client. ({e})")
    print("Make sure you run this from the repo root.")
    sys.exit(1)

def run_tests():
    parser = argparse.ArgumentParser(description="DashClaw SDK Integration Test Agent")
    parser.add_argument("--full", action="store_true", help="Run all tests")
    parser.add_argument("--actions-only", action="store_true", help="Run only action lifecycle tests")
    parser.add_argument("--approvals-only", action="store_true", help="Run only approval flow tests")
    parser.add_argument("--loops-only", action="store_true", help="Run only open loop / assumption tests")
    parser.add_argument("--signals-only", action="store_true", help="Run only signals and logs tests")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    # Determine which suites to run
    run_all = args.full or not (args.actions_only or args.approvals_only or args.loops_only or args.signals_only)
    run_actions = run_all or args.actions_only
    run_approvals = run_all or args.approvals_only
    run_loops = run_all or args.loops_only
    run_signals = run_all or args.signals_only

    base_url = os.environ.get("DASHCLAW_BASE_URL", "http://localhost:3000")
    api_key = os.environ.get("DASHCLAW_API_KEY")
    agent_id = os.environ.get("TEST_AGENT_ID", "sdk-test-agent")
    agent_name = os.environ.get("TEST_AGENT_NAME", "SDK Test Agent")

    if not api_key:
        print("Error: DASHCLAW_API_KEY environment variable is required.")
        sys.exit(1)

    claw = DashClaw(
        base_url=base_url,
        api_key=api_key,
        agent_id=agent_id,
        agent_name=agent_name
    )

    results = []
    
    def log_result(domain, method, success, message, data=None):
        results.append({
            "domain": domain,
            "method": method,
            "success": success,
            "message": message,
            "data": data
        })
        if not args.json:
            status = "PASS" if success else "FAIL"
            print(f"[{status}] {domain} -> {method}: {message}")
            if data and not success:
                # Truncate data for clean output
                dstr = str(data)
                print(f"       Details: {dstr[:200] + '...' if len(dstr) > 200 else dstr}")

    if not args.json:
        print(f"Initializing Test Agent: {agent_id} against {base_url}")
        print("-" * 50)

    # 1. Actions & Agent Status
    if run_actions:
        try:
            decision = claw.guard({"action_type": "test", "risk_score": 10})
            log_result("Guard", "guard", True, "Successfully evaluated guard")
        except Exception as e:
            log_result("Guard", "guard", False, str(e))

        action_id = None
        try:
            res = claw.create_action("test", "Running a standard test action", risk_score=10)
            action_id = res.get("action_id")
            log_result("Action", "create_action", True, f"Created action {action_id}")
        except Exception as e:
            log_result("Action", "create_action", False, str(e))

        if action_id:
            try:
                claw.update_outcome(action_id, status="completed", metadata={"test": True})
                log_result("Action", "update_outcome", True, "Successfully updated outcome")
            except Exception as e:
                log_result("Action", "update_outcome", False, str(e))

    # 2. Loops & Assumptions
    if run_loops:
        action_id = None
        try:
            res = claw.create_action("other", "Testing loops and assumptions")
            action_id = res.get("action_id")
        except Exception:
            pass

        if action_id:
            if hasattr(claw, "record_assumption"):
                try:
                    claw.record_assumption({
                        "action_id": action_id,
                        "assumption": "The system is functioning normally"
                    })
                    log_result("Assumptions", "record_assumption", True, "Recorded assumption")
                except Exception as e:
                    log_result("Assumptions", "record_assumption", False, str(e))
            elif hasattr(claw, "register_assumption"):
                try:
                    claw.register_assumption(action_id=action_id, assumption="The system is functioning normally")
                    log_result("Assumptions", "register_assumption", True, "Registered assumption")
                except Exception as e:
                    log_result("Assumptions", "register_assumption", False, str(e))

            loop_id = None
            if hasattr(claw, "register_open_loop"):
                try:
                    res = claw.register_open_loop(action_id, "dependency", "Need user input")
                    loop_id = res.get("loop_id") or res.get("id")
                    log_result("Loops", "register_open_loop", True, f"Registered open loop {loop_id}")
                except Exception as e:
                    log_result("Loops", "register_open_loop", False, str(e))
            else:
                log_result("Loops", "register_open_loop", False, "Method not found in SDK")

            if loop_id and hasattr(claw, "resolve_open_loop"):
                try:
                    claw.resolve_open_loop(loop_id, status="resolved", resolution="Got input")
                    log_result("Loops", "resolve_open_loop", True, "Resolved open loop")
                except Exception as e:
                    log_result("Loops", "resolve_open_loop", False, str(e))

            try:
                claw.update_outcome(action_id, status="completed")
            except:
                pass

    # 3. Approvals
    if run_approvals:
        approval_action_id = None
        try:
            # We call the internal _request directly because we want to parse out the 202 Accepted
            # "require_approval" ID if the server governance policy triggers it.
            # We use a moderate risk score (75) to try to trigger a "require_approval" policy instead of a hard block.
            import urllib.request
            import urllib.error
            # Strip trailing slash from base_url to prevent double slash 308 redirects from Vercel
            clean_base = base_url.rstrip('/')
            url = f"{clean_base}/api/actions"
            req = urllib.request.Request(url, data=json.dumps({
                "action_type": "deploy",
                "declared_goal": "Deploying new models to production",
                "risk_score": 75,
                "status": "pending_approval",
                "agent_id": agent_id
            }).encode('utf-8'), headers={
                "Content-Type": "application/json",
                "x-api-key": api_key
            }, method='POST')

            with urllib.request.urlopen(req) as f:
                res = json.loads(f.read().decode('utf-8'))
                # The backend returns 201 Created or 202 Accepted.
                # If it's 202 Accepted, it entered the approval queue!
                if f.getcode() == 202 or (res.get("decision", {}).get("decision") == "require_approval") or res.get("action", {}).get("status") == "pending_approval":
                    approval_action_id = res.get("action_id") or res.get("action", {}).get("action_id")
                    log_result("Approvals", "create_action (pending)", True, f"Action queued for approval! ID: {approval_action_id}")
                else:
                    log_result("Approvals", "create_action (pending)", True, f"Action was allowed immediately by policy (no HITL triggered).")
        except urllib.error.HTTPError as e:
            try:
                err_data = json.loads(e.read().decode('utf-8'))
                if "action" in err_data and "action_id" in err_data["action"]:
                    action_id = err_data["action"]["action_id"]
                    if err_data.get("decision", {}).get("decision") == "block":
                        log_result("Approvals", "create_action (pending)", True, f"Action blocked by policy (hard block). Can't approve. ID: {action_id}")
                    else:
                        log_result("Approvals", "create_action (pending)", True, f"Action governed. Status: {err_data.get('decision', {}).get('decision')}")
                else:
                    log_result("Approvals", "create_action (pending)", False, f"Action blocked but could not extract ID: {err_data}")
            except Exception as ex:
                log_result("Approvals", "create_action (pending)", False, f"Action failed: {str(e)}")
        except Exception as e:
            log_result("Approvals", "create_action (pending)", False, str(e))

        if hasattr(claw, "get_pending_approvals"):
            try:
                pending = claw.get_pending_approvals()
                log_result("Approvals", "get_pending_approvals", True, "Fetched pending approvals")
            except Exception as e:
                log_result("Approvals", "get_pending_approvals", False, str(e))
        else:
            log_result("Approvals", "get_pending_approvals", False, "Method not found in SDK")

        if approval_action_id:
            if not args.json and sys.stdin.isatty():
                print("\n" + "="*60)
                print("🚨 HUMAN-IN-THE-LOOP (HITL) DEMO 🚨")
                print("Agent is attempting a high-risk action. Execution paused.")
                print(f"Action ID: {approval_action_id}")
                print(f"View and approve in your Dashboard: {base_url}/approvals")
                print("-" * 60)
                print("Or simulate operator API approval right here in the terminal:")
                choice = input("  [Y] Approve  |  [N] Deny  |  [Enter] Wait for Dashboard click: ").strip().lower()
                print("="*60 + "\n")
                
                if choice == 'y':
                    try:
                        claw.approve_action(approval_action_id, decision="allow", reasoning="Operator approved via CLI")
                        log_result("Approvals", "approve_action", True, "Operator approved action via API")
                    except Exception as e:
                        log_result("Approvals", "approve_action", False, f"Failed to approve: {e}")
                elif choice == 'n':
                    try:
                        claw.approve_action(approval_action_id, decision="deny", reasoning="Operator denied via CLI")
                        log_result("Approvals", "approve_action", True, "Operator denied action via API")
                    except Exception as e:
                        log_result("Approvals", "approve_action", False, f"Failed to deny: {e}")
                else:
                    print("Waiting for dashboard approval (timeout 60s)...")
            else:
                # Non-interactive fallback
                try:
                    claw.approve_action(approval_action_id, decision="allow", reasoning="Auto-approved in non-interactive mode")
                    log_result("Approvals", "approve_action", True, "Auto-approved action via API")
                except Exception as e:
                    pass

            if hasattr(claw, "wait_for_approval"):
                try:
                    print(f"Waiting for approval resolution on {approval_action_id}...")
                    # Give them 60 seconds to click in the dashboard
                    action_data = claw.wait_for_approval(approval_action_id, timeout=60, interval=2)
                    log_result("Approvals", "wait_for_approval", True, "Action was APPROVED and execution resumed!")
                    
                    # Complete the action since it was approved
                    claw.update_outcome(approval_action_id, status="completed", output_summary="Deploy successful after approval")
                    log_result("Approvals", "update_outcome", True, "Finalized approved action")
                except DashClawError as e:
                    if "denied" in str(e).lower() or e.status in [403]:
                        log_result("Approvals", "wait_for_approval", True, "Action was DENIED. Execution halted safely.")
                    else:
                        log_result("Approvals", "wait_for_approval", False, str(e))
                except TimeoutError:
                    log_result("Approvals", "wait_for_approval", False, "wait_for_approval timed out (operator didn't click in time)")
                except Exception as e:
                    log_result("Approvals", "wait_for_approval", False, str(e))

    # 4. Signals & Logs
    if run_signals:
        if hasattr(claw, "get_signals"):
            try:
                sigs = claw.get_signals()
                log_result("Signals", "get_signals", True, "Fetched signals")
            except Exception as e:
                log_result("Signals", "get_signals", False, str(e))
        else:
            log_result("Signals", "get_signals", False, "Method not found in SDK")

        if hasattr(claw, "get_guard_decisions"):
            try:
                decisions = claw.get_guard_decisions(limit=5)
                log_result("Signals", "get_guard_decisions", True, "Fetched guard decisions")
            except Exception as e:
                log_result("Signals", "get_guard_decisions", False, str(e))
        else:
            log_result("Signals", "get_guard_decisions", False, "Method not found in SDK")

        if hasattr(claw, "get_activity_logs"):
            try:
                logs = claw.get_activity_logs(limit=5)
                log_result("Signals", "get_activity_logs", True, "Fetched activity logs")
            except Exception as e:
                log_result("Signals", "get_activity_logs", False, str(e))
        else:
            log_result("Signals", "get_activity_logs", False, "Method not found in SDK")

    if args.json:
        print(json.dumps({
            "summary": {
                "total": len(results),
                "passed": sum(1 for r in results if r["success"]),
                "failed": sum(1 for r in results if not r["success"])
            },
            "results": results
        }, indent=2))
    else:
        print("-" * 50)
        print("SUMMARY")
        passed = sum(1 for r in results if r["success"])
        failed = len(results) - passed
        print(f"Total: {len(results)} | Passed: {passed} | Failed: {failed}")

if __name__ == "__main__":
    run_tests()

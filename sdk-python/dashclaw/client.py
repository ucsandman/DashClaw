import json
import re
import time
import urllib.parse
import urllib.request
import urllib.error
import base64
import warnings
from datetime import datetime, timezone
from contextlib import contextmanager

# ---------------------------------------------------------------------------
# Evidence-first guard — client-side scrub. Applied to an `act` payload before
# it rides guard()/create_action() to the server, so a captured Authorization
# header or an embedded secret never leaves the machine even as evidence. The
# server still re-redacts (defense in depth, not the only redaction layer).
# Node parity: sdk/dashclaw.js scrubAct. See
# docs/superpowers/specs/2026-07-05-evidence-first-guard.md.
# ---------------------------------------------------------------------------

_SCRUB_HEADER_KEYS = {"authorization", "cookie", "x-api-key"}

_SCRUB_TEXT_PATTERNS = [
    (re.compile(r"oc_live_[A-Za-z0-9_-]+"), "[REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]{10,}"), "[REDACTED]"),
    (re.compile(r"ghp_[A-Za-z0-9]{20,}"), "[REDACTED]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._-]+", re.IGNORECASE), "Bearer [REDACTED]"),
]
_SCRUB_KV_PATTERN = re.compile(r"(password|token|secret)\s*=\s*[^\s&\"']+", re.IGNORECASE)


def _scrub_act_text(text):
    """Mask secret-looking substrings in a command/body/content excerpt."""
    if not isinstance(text, str) or not text:
        return text
    out = text
    for pattern, replacement in _SCRUB_TEXT_PATTERNS:
        out = pattern.sub(replacement, out)
    return _SCRUB_KV_PATTERN.sub(lambda m: f"{m.group(1)}=[REDACTED]", out)


def _scrub_act_headers(headers):
    """Drop Authorization/Cookie/x-api-key entries from a headers map."""
    if not isinstance(headers, dict):
        return headers
    return {k: v for k, v in headers.items() if k.lower() not in _SCRUB_HEADER_KEYS}


def scrub_act(act):
    """Pure helper: return a scrubbed deep copy of an `act` payload ({kind,
    command, request, statement, file}) safe to send as guard/create_action
    evidence. Strips secret-bearing headers and masks common token shapes in
    text excerpts.
    """
    if not isinstance(act, dict):
        return act
    clone = json.loads(json.dumps(act))
    if isinstance(clone.get("command"), str):
        clone["command"] = _scrub_act_text(clone["command"])
    if isinstance(clone.get("statement"), str):
        clone["statement"] = _scrub_act_text(clone["statement"])
    request = clone.get("request")
    if isinstance(request, dict):
        if isinstance(request.get("body_excerpt"), str):
            request["body_excerpt"] = _scrub_act_text(request["body_excerpt"])
        if isinstance(request.get("headers"), dict):
            request["headers"] = _scrub_act_headers(request["headers"])
    file_payload = clone.get("file")
    if isinstance(file_payload, dict) and isinstance(file_payload.get("content_excerpt"), str):
        file_payload["content_excerpt"] = _scrub_act_text(file_payload["content_excerpt"])
    return clone


class DashClawError(Exception):
    """Base error for DashClaw SDK."""
    def __init__(self, message, status=None, details=None):
        super().__init__(message)
        self.status = status
        self.details = details

class GuardBlockedError(DashClawError):
    """Thrown when behavior guard blocks an action."""
    def __init__(self, decision):
        reasons = "; ".join(decision.get("reasons", [])) or "no reason"
        message = f"Guard blocked action: {decision.get('decision')}. Reasons: {reasons}"
        super().__init__(message, status=403, details=decision)
        self.decision = decision.get("decision")
        self.reasons = decision.get("reasons", [])
        self.warnings = decision.get("warnings", [])
        self.matched_policies = decision.get("matched_policies", [])
        self.risk_score = decision.get("risk_score")

class ApprovalDeniedError(DashClawError):
    """Thrown when a human operator denies an action."""
    def __init__(self, message, decision=None):
        super().__init__(message, status=403)
        self.decision = decision

class DashClaw:
    def __init__(
        self,
        base_url,
        api_key,
        agent_id,
        agent_name=None,
        auth_token=None,
        swarm_id=None,
        guard_mode="off",
        guard_callback=None,
        hitl_mode="off",
        private_key=None,
        auto_recommend="off",
        recommendation_confidence_min=70,
        recommendation_callback=None,
    ):
        self.base_url = base_url.rstrip("/")
        if not self.base_url.startswith("https://") and "localhost" not in self.base_url and "127.0.0.1" not in self.base_url:
            import warnings
            warnings.warn(
                "DashClaw: baseUrl does not use HTTPS. API keys will be sent in plaintext. Use HTTPS in production.",
                UserWarning,
                stacklevel=2,
            )
        self.api_key = api_key
        self.agent_id = agent_id
        self.agent_name = agent_name
        # Phase 2 (#104): JWT bearer token for cryptographic agent attribution.
        # When set, every request includes Authorization: Bearer <token>; the
        # server verifies via JWKS and returns verification_status. The JWT sub
        # claim overrides agent_id in the audit record on successful verification.
        # Mirrors Node SDK's authToken constructor option.
        self.auth_token = auth_token
        self.swarm_id = swarm_id
        self.guard_mode = guard_mode
        self.guard_callback = guard_callback
        self.hitl_mode = hitl_mode # "off" | "wait"
        self.private_key = private_key # cryptography.hazmat.primitives.asymmetric.rsa.RSAPrivateKey
        self.auto_recommend = auto_recommend
        try:
            self.recommendation_confidence_min = max(0, min(float(recommendation_confidence_min), 100))
        except Exception:
            self.recommendation_confidence_min = 70
        self.recommendation_callback = recommendation_callback

        if guard_mode not in ["off", "warn", "enforce"]:
            raise ValueError("guard_mode must be one of: off, warn, enforce")
        if auto_recommend not in ["off", "warn", "enforce"]:
            raise ValueError("auto_recommend must be one of: off, warn, enforce")

    def _request(self, path, method="GET", body=None, params=None, json_payload=None, **kwargs):
        # Support 'method' as an explicit keyword arg so callers can write
        # _request("/path", method="POST", body=...) without positional ambiguity.
        if "method" in kwargs:
            method = kwargs.pop("method")

        # Support 'json' as a keyword argument (renamed to json_payload in signature to avoid conflict with json module)
        if "json" in kwargs:
            json_payload = kwargs.pop("json")

        url = f"{self.base_url}{self._append_query(path, params)}"
        data = self._serialize_request_payload(body, json_payload)
        req = urllib.request.Request(url, data=data, headers=self._build_request_headers(), method=method)

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            self._raise_normalized_http_error(e)
        except Exception as e:
            raise DashClawError(f"Request failed: {str(e)}")

    def _append_query(self, path, params):
        if not params:
            return path
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return f"{path}&{query}" if "?" in path else f"{path}?{query}"

    def _build_request_headers(self):
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
        }
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers

    def _serialize_request_payload(self, body, json_payload):
        payload = json_payload if json_payload is not None else body
        if payload is None:
            return None
        return json.dumps(payload).encode("utf-8")

    def _raise_normalized_http_error(self, e):
        """Translate an HTTPError into GuardBlockedError or DashClawError."""
        try:
            error_data = json.loads(e.read().decode("utf-8"))
            message = error_data.get("error", str(e))
            details = error_data.get("details")
            decision = error_data.get("decision")

            # Check for governance block
            if e.code == 403 and decision and decision.get("decision") == "block":
                raise GuardBlockedError(decision)
        except GuardBlockedError:
            raise
        except Exception:
            message = str(e)
            details = None
        raise DashClawError(message, status=e.code, details=details)

    def _is_restrictive_decision(self, decision):
        return isinstance(decision, dict) and decision.get("decision") in ["block", "require_approval"]

    def _build_guard_context(self, action_def):
        return {
            "action_type": action_def.get("action_type"),
            "risk_score": action_def.get("risk_score"),
            "systems_touched": action_def.get("systems_touched"),
            "reversible": action_def.get("reversible"),
            "declared_goal": action_def.get("declared_goal"),
            "agent_id": self.agent_id,
        }

    def _report_recommendation_event(self, event):
        try:
            payload = dict(event or {})
            if "agent_id" not in payload or payload.get("agent_id") is None:
                payload["agent_id"] = self.agent_id
            self._request("/api/learning/recommendations/events", method="POST", body=payload)
        except Exception:
            # Telemetry should not break action flow.
            pass

    def _auto_recommend(self, action_def):
        if self.auto_recommend == "off" or not isinstance(action_def, dict) or not action_def.get("action_type"):
            return self._recommendation_passthrough(action_def)

        try:
            result = self.recommend_action(action_def)
        except Exception as e:
            print(f"[DashClaw] Recommendation fetch failed (proceeding): {str(e)}")
            return self._recommendation_passthrough(action_def)

        self._notify_recommendation_callback(result)

        recommendation = result.get("recommendation")
        if not isinstance(recommendation, dict):
            return result

        confidence = self._coerce_recommendation_confidence(recommendation.get("confidence"))

        override_reason = self._resolve_recommendation_override(result, action_def, confidence)
        if override_reason:
            return self._override_recommendation(result, action_def, recommendation, override_reason)

        return self._apply_auto_recommendation(result, action_def, recommendation, confidence)

    def _resolve_recommendation_override(self, result, action_def, confidence):
        """Return the override reason that prevents auto-applying, or None to apply."""
        if confidence < self.recommendation_confidence_min:
            return f"confidence_below_threshold:{confidence}<{self.recommendation_confidence_min}"

        guard_decision = self._probe_recommendation_guard(result, action_def)
        if self._is_restrictive_decision(guard_decision):
            return f"guard_restrictive:{guard_decision.get('decision')}"

        if self.auto_recommend == "warn":
            return "warn_mode_no_autoadapt"

        return None

    def _recommendation_passthrough(self, action_def):
        return {"action": action_def, "recommendation": None, "adapted_fields": []}

    def _notify_recommendation_callback(self, result):
        if not self.recommendation_callback:
            return
        try:
            self.recommendation_callback(result)
        except Exception:
            pass

    def _coerce_recommendation_confidence(self, confidence):
        try:
            return float(confidence if confidence is not None else 0)
        except Exception:
            return 0

    def _probe_recommendation_guard(self, result, action_def):
        try:
            return self.guard(self._build_guard_context(result.get("action") or action_def))
        except Exception as e:
            print(f"[DashClaw] Recommendation guard probe failed: {str(e)}")
            return None

    def _override_recommendation(self, result, action_def, recommendation, override_reason):
        self._report_recommendation_event({
            "recommendation_id": recommendation.get("id"),
            "event_type": "overridden",
            "details": {
                "action_type": action_def.get("action_type"),
                "reason": override_reason,
            },
        })
        return {
            **result,
            "action": {
                **action_def,
                "recommendation_id": recommendation.get("id"),
                "recommendation_applied": False,
                "recommendation_override_reason": override_reason,
            },
        }

    def _apply_auto_recommendation(self, result, action_def, recommendation, confidence):
        self._report_recommendation_event({
            "recommendation_id": recommendation.get("id"),
            "event_type": "applied",
            "details": {
                "action_type": action_def.get("action_type"),
                "adapted_fields": result.get("adapted_fields", []),
                "confidence": confidence,
            },
        })
        return {
            **result,
            "action": {
                **(result.get("action") or action_def),
                "recommendation_id": recommendation.get("id"),
                "recommendation_applied": True,
                "recommendation_override_reason": None,
            },
        }

    # --- Category 1: Decision Recording ---

    def _sign_payload(self, payload):
        """Sign payload using RSASSA-PKCS1-v1_5 (PKCS#1 v1.5) + SHA-256."""
        if not self.private_key:
            return None
        
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import padding
            
            # Canonical JSON: stable bytes (no whitespace, sorted keys) so server verification is deterministic.
            data = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            signature = self.private_key.sign(
                data,
                padding.PKCS1v15(), # Matches RSASSA-PKCS1-v1_5 used in JS SDK
                hashes.SHA256()
            )
            return base64.b64encode(signature).decode("utf-8")
        except ImportError:
            print("[DashClaw] Warning: 'cryptography' library missing. Signatures will be skipped.")
            return None
        except Exception as e:
            print(f"[DashClaw] Failed to sign action: {str(e)}")
            return None

    def create_action(self, action_type, declared_goal, session_id=None, **kwargs):
        """I am attempting X.

        Non-fabrication (optional): pass ``content`` (the outbound text) and
        ``source_of_truth`` ({"allowedFacts": [...], "requiredFacts": [...],
        "forbiddenPatterns"?: [...], "extract"?: {...}}) to have a
        ``non_fabrication`` guard policy verify the content before the action
        proceeds. A violation blocks the action or routes it to approval and is
        recorded with a signed receipt in the decision ledger.

        Optional ``session_id``: pass the id from ``create_session()`` to link
        this action to a session via the Direct path (exact attribution). When
        omitted, the server falls back to time-window correlation by agent_id.
        """
        payload = {
            # Approvals lifecycle: same wait-window declaration as guard(),
            # for actions created directly as pending_approval (kwargs win).
            "approval_wait_seconds": 300,
            "action_type": action_type,
            "declared_goal": declared_goal,
            "agent_id": self.agent_id,
            **kwargs
        }
        if session_id is not None:
            payload["session_id"] = session_id

        # Auto-derive an idempotency key when the caller didn't supply one
        # (explicit key always wins) so a blind retry returns the original
        # row instead of duplicating the ledger. The hour bucket scopes
        # content-identical actions: a retry seconds later dedupes; the same
        # logical goal re-run much later is a new action. Mirrors
        # sdk/dashclaw.js createAction.
        if not payload.get("idempotency_key"):
            payload["idempotency_key"] = self.derive_idempotency_key({
                "agent_id": payload.get("agent_id") or "",
                "action_type": payload.get("action_type") or "",
                "declared_goal": payload.get("declared_goal") or "",
                "session_id": payload.get("session_id") or "",
                "ts_bucket": int(time.time() // 3600),
            })

        # Identity Verification: Sign the payload if a private key is available.
        signature = self._sign_payload(payload)
        if signature:
            payload["_signature"] = signature

        return self._request("/api/actions", "POST", json=payload)

    def record_assumption(self, assumption):
        """Record what the agent believed to be true when making a decision.

        .. deprecated::
            Use :meth:`register_assumption` instead. Both methods POST to the
            same endpoint; ``register_assumption`` is the canonical form.
        """
        warnings.warn(
            "record_assumption is deprecated; use register_assumption",
            DeprecationWarning,
            stacklevel=2,
        )
        return self._request("/api/assumptions", "POST", json=assumption)

    def _connect_sse(self, action_id, timeout):
        """
        Connect to the SSE stream and listen for action.updated events.
        Returns the matching action data or None on failure (triggers polling fallback).
        """
        resp = self._open_sse_stream(timeout)
        if resp is None:
            return None

        try:
            return self._listen_for_action_update(resp, action_id, timeout)
        finally:
            try:
                resp.close()
            except Exception:
                pass

    def _open_sse_stream(self, timeout):
        url = f"{self.base_url}/api/stream"
        headers = {
            "x-api-key": self.api_key,
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache",
        }
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        req = urllib.request.Request(url, headers=headers)

        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except Exception:
            return None

    def _read_sse_chunk(self, resp):
        try:
            chunk = resp.read(4096)
        except Exception:
            return None
        if not chunk:
            return None
        return chunk.decode("utf-8", errors="replace")

    def _listen_for_action_update(self, resp, action_id, timeout):
        buffer = ""
        state = {"event": None, "data": ""}
        start_time = time.time()

        while (time.time() - start_time) < timeout:
            chunk = self._read_sse_chunk(resp)
            if chunk is None:
                return None

            buffer += chunk
            lines = buffer.split("\n")
            buffer = lines.pop()

            for line in lines:
                match = self._consume_sse_line(line, state, action_id)
                if match is not None:
                    return match

        return None

    def _consume_sse_line(self, line, state, action_id):
        """Feed one SSE line into the parse state; return the matching event payload, if any."""
        if line.startswith("id: ") or line.startswith(":"):
            return None  # id lines unused; ":" = SSE comment (heartbeat)
        if line.startswith("event: "):
            state["event"] = line[7:].strip()
            return None
        if line.startswith("data: "):
            state["data"] += line[6:]
            return None
        if line != "":
            return None

        # Blank line: dispatch the buffered event, then reset.
        match = None
        if state["event"] == "action.updated" and state["data"]:
            match = self._parse_action_update(state["data"], action_id)
        state["event"] = None
        state["data"] = ""
        return match

    def _parse_action_update(self, raw_data, action_id):
        try:
            data = json.loads(raw_data)
            if data.get("action_id") == action_id:
                return data
        except Exception:
            pass
        return None

    def _left_pending_without_approval(self, was_pending, action):
        return was_pending and action.get("status") != "pending_approval"

    def _is_running_before_pending(self, was_pending, action):
        return not was_pending and action.get("status") == "running"

    def _evaluate_wait_for_approval_action(self, action_id, res, was_pending=False):
        action = res.get("action", {}) if isinstance(res, dict) else {}

        if action.get("status") == "pending_approval":
            was_pending = True

        if action.get("approved_by"):
            print(f"[DashClaw] Action {action_id} approved by operator: {action.get('approved_by')}")
            return res, was_pending

        if action.get("status") in ["failed", "cancelled"]:
            raise ApprovalDeniedError(
                action.get("error_message") or "Operator denied the action.",
                decision=action.get("status")
            )

        # Approvals lifecycle (roadmap v2.3): the server expired the approval —
        # it can no longer release anything. Terminal; `decision` distinguishes
        # it from an operator denial.
        if action.get("status") == "expired":
            raise ApprovalDeniedError(
                action.get("error_message") or "Approval expired before a decision was made.",
                decision="expired"
            )

        if self._left_pending_without_approval(was_pending, action):
            raise DashClawError(
                f"Action {action_id} left pending_approval state without explicit approval metadata (Status: {action.get('status')})"
            )

        if self._is_running_before_pending(was_pending, action):
            return res, was_pending

        return None, was_pending

    def _wait_for_approval_via_sse(self, action_id, timeout, start_time):
        """Try the SSE fast path. Returns (resolved, value); raises ApprovalDeniedError on denial."""
        remaining = timeout - (time.time() - start_time)
        if remaining <= 0:
            return False, None

        sse_data = self._connect_sse(action_id, remaining)
        if sse_data is None:
            return False, None

        if sse_data.get("approved_by"):
            return True, self.get_action(action_id)

        if sse_data.get("status") in ["failed", "cancelled"]:
            raise ApprovalDeniedError(
                sse_data.get("error_message") or "Operator denied the action.",
                decision=sse_data.get("status")
            )

        if sse_data.get("status") == "expired":
            raise ApprovalDeniedError(
                sse_data.get("error_message") or "Approval expired before a decision was made.",
                decision="expired"
            )

        return False, None

    def _poll_for_approval(self, action_id, interval, deadline):
        was_pending = False
        res = self.get_action(action_id)
        resolved, was_pending = self._evaluate_wait_for_approval_action(action_id, res, was_pending)
        if resolved is not None:
            return resolved

        while time.time() < deadline:
            if interval > 0:
                time.sleep(interval)

            res = self.get_action(action_id)
            resolved, was_pending = self._evaluate_wait_for_approval_action(action_id, res, was_pending)
            if resolved is not None:
                return resolved

        raise TimeoutError(f"[DashClaw] Timed out waiting for approval of action {action_id}")

    def wait_for_approval(self, action_id, timeout=300, interval=5):
        """Wait for human approval. Uses SSE for instant notification, falls back to polling."""
        start_time = time.time()

        # Try SSE first
        try:
            resolved, value = self._wait_for_approval_via_sse(action_id, timeout, start_time)
            if resolved:
                return value
        except ApprovalDeniedError:
            raise
        except Exception:
            pass  # SSE failed — fall through to polling

        return self._poll_for_approval(action_id, interval, start_time + timeout)

    def update_outcome(self, action_id, status=None, **kwargs):
        """Update the outcome of an action."""
        if isinstance(status, dict):
            payload = dict(status)
            payload.update(kwargs)
        else:
            payload = {"status": status, **kwargs}
            
        if "timestamp_end" not in payload:
            payload["timestamp_end"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return self._request(f"/api/actions/{action_id}", method="PATCH", body=payload)

    def heartbeat(self, status="online", current_task_id=None, metadata=None):
        """Report agent presence and health."""
        payload = {
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "status": status,
            "current_task_id": current_task_id,
            "metadata": metadata,
        }
        return self._request("/api/agents/heartbeat", method="POST", body=payload)

    def start_heartbeat(self, interval=60, **kwargs):
        """Start an automatic heartbeat timer in a background thread."""
        if hasattr(self, "_heartbeat_thread") and self._heartbeat_thread and self._heartbeat_thread.is_alive():
            return

        import threading
        self._heartbeat_stop_event = threading.Event()

        def _heartbeat_loop():
            while not self._heartbeat_stop_event.is_set():
                try:
                    self.heartbeat(**kwargs)
                except Exception:
                    pass
                self._heartbeat_stop_event.wait(interval)

        self._heartbeat_thread = threading.Thread(target=_heartbeat_loop, daemon=True)
        self._heartbeat_thread.start()

    def stop_heartbeat(self):
        """Stop the automatic heartbeat timer."""
        if hasattr(self, "_heartbeat_stop_event"):
            self._heartbeat_stop_event.set()
            self._heartbeat_thread.join(timeout=1)
            self._heartbeat_thread = None

    def get_actions(self, **filters):
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        path = f"/api/actions?{query}" if query else "/api/actions"
        return self._request(path)

    def get_action(self, action_id):
        return self._request(f"/api/actions/{action_id}")

    def get_action_trace(self, action_id):
        return self._request(f"/api/actions/{action_id}/trace")

    # --- Category 12: Approvals ---

    def approve_action(self, action_id, decision, reasoning=None):
        if decision not in ["allow", "deny"]:
            raise ValueError("decision must be either 'allow' or 'deny'")

        payload = {"decision": decision}
        if reasoning is not None:
            payload["reasoning"] = reasoning

        return self._request(f"/api/actions/{action_id}/approve", method="POST", body=payload)

    def get_pending_approvals(self, limit=20, offset=0):
        return self.get_actions(status="pending_approval", limit=limit, offset=offset)

    def _record_tracked_failure(self, action_id, start_time, error):
        duration_ms = int((time.time() - start_time) * 1000)
        try:
            self.update_outcome(action_id, status="failed", duration_ms=duration_ms, error_message=str(error))
        except Exception as outcome_err:
            warnings.warn(f"[DashClaw] Failed to close action {action_id}: {outcome_err}")

    @contextmanager
    def track(self, action_type, declared_goal, **kwargs):
        start_time = time.time()
        res = self.create_action(action_type, declared_goal, **kwargs)
        action_id = res.get("action_id")

        try:
            yield {"action_id": action_id}
            duration_ms = int((time.time() - start_time) * 1000)
            self.update_outcome(action_id, status="completed", duration_ms=duration_ms)
        except Exception as e:
            self._record_tracked_failure(action_id, start_time, e)
            raise

    # --- Category 2: Decision Integrity (Loops & Assumptions) ---

    def register_open_loop(self, action_id, loop_type, description, **kwargs):
        """Register an unresolved dependency for a decision. Open loops track work that must be completed before the decision is fully resolved."""
        payload = {
            "action_id": action_id,
            "loop_type": loop_type,
            "description": description,
            **kwargs
        }
        return self._request("/api/actions/loops", method="POST", body=payload)

    def resolve_open_loop(self, loop_id, status, resolution=None):
        payload = {"status": status, "resolution": resolution}
        return self._request(f"/api/actions/loops/{loop_id}", method="PATCH", body=payload)

    def get_open_loops(self, **filters):
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        path = f"/api/actions/loops?{query}" if query else "/api/actions/loops"
        return self._request(path)

    def register_assumption(self, action_id, assumption=None, **kwargs):
        """Register assumptions underlying a decision."""
        if isinstance(action_id, dict) and assumption is None:
            payload = action_id
        else:
            payload = {
                "action_id": action_id,
                "assumption": assumption,
                **kwargs
            }
        return self._request("/api/assumptions", "POST", json=payload)

    def get_assumption(self, assumption_id):
        return self._request(f"/api/actions/assumptions/{assumption_id}")

    def validate_assumption(self, assumption_id, validated, invalidated_reason=None):
        payload = {"validated": validated}
        if invalidated_reason:
            payload["invalidated_reason"] = invalidated_reason
        return self._request(f"/api/actions/assumptions/{assumption_id}", method="PATCH", body=payload)

    def get_drift_report(self, **filters):
        filters["drift"] = "true"
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        return self._request(f"/api/actions/assumptions?{query}")

    # --- Category 3: Decision Integrity Signals ---

    def get_signals(self):
        """Get current decision integrity signals. Returns autonomy breaches, logic drift, and governance violations."""
        return self._request("/api/actions/signals")

    # --- Category 4: Dashboard Data ---

    def record_decision(self, decision, **kwargs):
        payload = {"decision": decision, "agent_id": self.agent_id, **kwargs}
        return self._request("/api/learning", method="POST", body=payload)

    def get_recommendations(
        self,
        action_type=None,
        limit=50,
        agent_id=None,
        include_inactive=False,
        track_events=True,
        include_metrics=False,
        lookback_days=None,
    ):
        params = {"agent_id": agent_id or self.agent_id, "limit": limit}
        if action_type is not None:
            params["action_type"] = action_type
        if include_inactive:
            params["include_inactive"] = "true"
        if track_events:
            params["track_events"] = "true"
        if include_metrics:
            params["include_metrics"] = "true"
        if lookback_days is not None:
            params["lookback_days"] = lookback_days
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return self._request(f"/api/learning/recommendations?{query}")

    def get_recommendation_metrics(
        self,
        action_type=None,
        limit=100,
        agent_id=None,
        include_inactive=False,
        lookback_days=30,
    ):
        params = {
            "agent_id": agent_id or self.agent_id,
            "limit": limit,
            "lookback_days": lookback_days,
        }
        if action_type is not None:
            params["action_type"] = action_type
        if include_inactive:
            params["include_inactive"] = "true"
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return self._request(f"/api/learning/recommendations/metrics?{query}")

    def record_recommendation_events(self, events):
        if isinstance(events, list):
            return self._request("/api/learning/recommendations/events", method="POST", body={"events": events})
        return self._request("/api/learning/recommendations/events", method="POST", body=events or {})

    def set_recommendation_active(self, recommendation_id, active):
        recommendation_id = urllib.parse.quote(str(recommendation_id), safe="")
        return self._request(
            f"/api/learning/recommendations/{recommendation_id}",
            method="PATCH",
            body={"active": bool(active)},
        )

    def rebuild_recommendations(
        self,
        action_type=None,
        lookback_days=30,
        min_samples=5,
        episode_limit=5000,
        action_id=None,
        agent_id=None,
    ):
        payload = {
            "agent_id": agent_id or self.agent_id,
            "action_type": action_type,
            "lookback_days": lookback_days,
            "min_samples": min_samples,
            "episode_limit": episode_limit,
            "action_id": action_id,
        }
        return self._request("/api/learning/recommendations", method="POST", body=payload)

    def _fetch_top_recommendation(self, action_type):
        response = self.get_recommendations(action_type=action_type, limit=1)
        recommendations = response.get("recommendations", [])
        return recommendations[0] if recommendations else None

    def _apply_risk_cap_hint(self, adapted, adapted_fields, hints):
        risk_cap = hints.get("preferred_risk_cap")
        if not isinstance(risk_cap, (int, float)):
            return
        current = adapted.get("risk_score")
        if current is None or current > risk_cap:
            adapted["risk_score"] = risk_cap
            adapted_fields.append("risk_score")

    def _apply_reversible_hint(self, adapted, adapted_fields, hints):
        if hints.get("prefer_reversible") is True and adapted.get("reversible") is None:
            adapted["reversible"] = True
            adapted_fields.append("reversible")

    def _apply_confidence_floor_hint(self, adapted, adapted_fields, hints):
        confidence_floor = hints.get("confidence_floor")
        if not isinstance(confidence_floor, (int, float)):
            return
        current = adapted.get("confidence")
        if current is None or current < confidence_floor:
            adapted["confidence"] = confidence_floor
            adapted_fields.append("confidence")

    def recommend_action(self, action):
        if not isinstance(action, dict) or not action.get("action_type"):
            return {"action": action, "recommendation": None, "adapted_fields": []}

        recommendation = self._fetch_top_recommendation(action.get("action_type"))
        if not recommendation:
            return {"action": action, "recommendation": None, "adapted_fields": []}

        adapted = dict(action)
        adapted_fields = []
        hints = recommendation.get("hints", {}) if isinstance(recommendation, dict) else {}

        self._apply_risk_cap_hint(adapted, adapted_fields, hints)
        self._apply_reversible_hint(adapted, adapted_fields, hints)
        self._apply_confidence_floor_hint(adapted, adapted_fields, hints)

        return {
            "action": adapted,
            "recommendation": recommendation,
            "adapted_fields": adapted_fields,
        }

    def create_goal(self, title, **kwargs):
        payload = {"title": title, "agent_id": self.agent_id, **kwargs}
        return self._request("/api/goals", method="POST", body=payload)

    def record_content(self, title, **kwargs):
        payload = {"title": title, "agent_id": self.agent_id, **kwargs}
        return self._request("/api/content", method="POST", body=payload)

    def record_interaction(self, summary, **kwargs):
        payload = {"summary": summary, "agent_id": self.agent_id, **kwargs}
        return self._request("/api/relationships", method="POST", body=payload)

    def report_connections(self, connections):
        # connections: list of dicts with provider, auth_type, etc.
        formatted = []
        for c in connections:
            formatted.append({
                "provider": c.get("provider"),
                "auth_type": c.get("authType") or c.get("auth_type", "api_key"),
                "plan_name": c.get("planName") or c.get("plan_name"),
                "status": c.get("status", "active"),
                "metadata": c.get("metadata")
            })
        payload = {"agent_id": self.agent_id, "connections": formatted}
        return self._request("/api/agents/connections", method="POST", body=payload)

    def report_token_usage(self, tokens_in, tokens_out, **kwargs):
        """Report a token usage snapshot."""
        payload = {"tokens_in": tokens_in, "tokens_out": tokens_out, "agent_id": self.agent_id, **kwargs}
        return self._request("/api/tokens", method="POST", body=payload)

    def _report_token_usage_from_llm(self, tokens_in, tokens_out, model):
        """Internal: fire-and-forget token report extracted from an LLM response."""
        if tokens_in is None and tokens_out is None:
            return
        try:
            self._request("/api/tokens", method="POST", body={
                "tokens_in": tokens_in or 0,
                "tokens_out": tokens_out or 0,
                "model": model,
                "agent_id": self.agent_id,
            })
        except Exception:
            pass  # fire-and-forget: never let telemetry break the caller

    def wrap_client(self, llm_client, provider=None):
        """Wrap an Anthropic or OpenAI client to auto-report token usage.

        Returns the same client instance (mutated) for fluent usage.

        Args:
            llm_client: An Anthropic or OpenAI SDK client instance.
            provider: Force provider detection ('anthropic' or 'openai').

        Example::

            anthropic = claw.wrap_client(Anthropic())
            msg = anthropic.messages.create(model="claude-sonnet-4-20250514", max_tokens=1024, messages=[...])
            # Token usage is auto-reported to DashClaw
        """
        if getattr(llm_client, "_dashclaw_wrapped", False):
            return llm_client

        detected = provider or self._detect_llm_provider(llm_client)
        if not detected:
            raise ValueError(
                "DashClaw.wrap_client: unable to detect provider. "
                "Pass provider='anthropic' or provider='openai'."
            )

        if detected == "anthropic":
            self._wrap_anthropic_create(llm_client)
        elif detected == "openai":
            self._wrap_openai_create(llm_client)

        llm_client._dashclaw_wrapped = True
        return llm_client

    def _detect_llm_provider(self, llm_client):
        if hasattr(llm_client, "messages") and hasattr(getattr(llm_client, "messages"), "create"):
            return "anthropic"
        if hasattr(llm_client, "chat") and hasattr(getattr(llm_client, "chat"), "completions"):
            return "openai"
        return None

    def _wrap_anthropic_create(self, llm_client):
        original = llm_client.messages.create

        def wrapped_create(*args, **kwargs):
            response = original(*args, **kwargs)
            usage = getattr(response, "usage", None)
            self._report_token_usage_from_llm(
                tokens_in=getattr(usage, "input_tokens", None) if usage else None,
                tokens_out=getattr(usage, "output_tokens", None) if usage else None,
                model=getattr(response, "model", None),
            )
            return response

        llm_client.messages.create = wrapped_create

    def _wrap_openai_create(self, llm_client):
        original = llm_client.chat.completions.create

        def wrapped_create(*args, **kwargs):
            response = original(*args, **kwargs)
            usage = getattr(response, "usage", None)
            self._report_token_usage_from_llm(
                tokens_in=getattr(usage, "prompt_tokens", None) if usage else None,
                tokens_out=getattr(usage, "completion_tokens", None) if usage else None,
                model=getattr(response, "model", None),
            )
            return response

        llm_client.chat.completions.create = wrapped_create

    def create_calendar_event(self, summary, start_time, **kwargs):
        """Create a calendar event."""
        payload = {"summary": summary, "start_time": start_time, **kwargs}
        return self._request("/api/calendar", method="POST", body=payload)

    def record_idea(self, title, **kwargs):
        """Record an idea/inspiration."""
        payload = {"title": title, **kwargs}
        return self._request("/api/inspiration", method="POST", body=payload)

    def _is_prebuilt_memory_payload(self, health, entities, topics):
        return isinstance(health, dict) and "health" in health and entities is None and topics is None

    def report_memory_health(self, health, entities=None, topics=None):
        if self._is_prebuilt_memory_payload(health, entities, topics):
            payload = health
        else:
            payload = {"health": health, "entities": entities, "topics": topics}
        return self._request("/api/memory", method="POST", body=payload)

    # --- Category 5: Session Handoffs ---

    def create_handoff(self, summary, **kwargs):
        payload = {"summary": summary, "agent_id": self.agent_id, **kwargs}
        return self._request("/api/handoffs", method="POST", body=payload)

    def get_handoffs(self, **filters):
        filters["agent_id"] = self.agent_id
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        return self._request(f"/api/handoffs?{query}")

    def get_latest_handoff(self):
        return self._request(f"/api/handoffs?agent_id={self.agent_id}&latest=true")

    # --- Category 7: Automation Snippets ---

    def save_snippet(self, name, code, **kwargs):
        payload = {"name": name, "code": code, "agent_id": self.agent_id, **kwargs}
        return self._request("/api/snippets", method="POST", body=payload)

    def get_snippets(self, **filters):
        params = {k: v for k, v in filters.items() if v is not None}
        query = urllib.parse.urlencode(params)
        return self._request(f"/api/snippets?{query}")

    def get_snippet(self, snippet_id):
        snippet_id = urllib.parse.quote(str(snippet_id), safe="")
        return self._request(f"/api/snippets/{snippet_id}")

    def use_snippet(self, snippet_id):
        snippet_id = urllib.parse.quote(str(snippet_id), safe="")
        return self._request(f"/api/snippets/{snippet_id}/use", method="POST")

    def delete_snippet(self, snippet_id):
        snippet_id = urllib.parse.quote(str(snippet_id), safe="")
        return self._request(f"/api/snippets?id={snippet_id}", method="DELETE")

    # --- Category 8: User Preferences ---

    def log_observation(self, observation, **kwargs):
        """Log a user observation."""
        payload = {"type": "observation", "agent_id": self.agent_id, "observation": observation, **kwargs}
        return self._request("/api/preferences", method="POST", body=payload)

    def set_preference(self, preference, **kwargs):
        """Set a learned user preference."""
        payload = {"type": "preference", "agent_id": self.agent_id, "preference": preference, **kwargs}
        return self._request("/api/preferences", method="POST", body=payload)

    def log_mood(self, mood, **kwargs):
        """Log user mood/energy for a session."""
        payload = {"type": "mood", "agent_id": self.agent_id, "mood": mood, **kwargs}
        return self._request("/api/preferences", method="POST", body=payload)

    def track_approach(self, approach, **kwargs):
        """Track an approach and whether it succeeded or failed."""
        payload = {"type": "approach", "agent_id": self.agent_id, "approach": approach, **kwargs}
        return self._request("/api/preferences", method="POST", body=payload)

    def get_preference_summary(self):
        """Get a summary of all user preference data."""
        return self._request(f"/api/preferences?type=summary&agent_id={self.agent_id}")

    def get_approaches(self, limit=None):
        """Get tracked approaches with success/fail counts."""
        params = {"type": "approaches", "agent_id": self.agent_id}
        if limit is not None:
            params["limit"] = limit
        query = urllib.parse.urlencode(params)
        return self._request(f"/api/preferences?{query}")

    # --- Category 9: Daily Digest ---

    def get_daily_digest(self, date=None):
        """Get a daily activity digest aggregated from all data sources."""
        params = {"agent_id": self.agent_id}
        if date is not None:
            params["date"] = date
        query = urllib.parse.urlencode(params)
        return self._request(f"/api/digest?{query}")

    # --- Category 10: Security Scanning ---

    def scan_content(self, text, destination=None):
        """Scan text for sensitive data. Returns findings and redacted text."""
        payload = {"text": text, "agent_id": self.agent_id, "store": False}
        if destination is not None:
            payload["destination"] = destination
        return self._request("/api/security/scan", method="POST", body=payload)

    def report_security_finding(self, text, destination=None):
        """Scan text and store finding metadata for audit trails."""
        payload = {"text": text, "agent_id": self.agent_id, "store": True}
        if destination is not None:
            payload["destination"] = destination
        return self._request("/api/security/scan", method="POST", body=payload)

    def scan_prompt_injection(self, text, source=None):
        """Scan text for prompt injection attacks (role overrides, delimiter injection, etc.)."""
        payload = {"text": text, "agent_id": self.agent_id}
        if source is not None:
            payload["source"] = source
        return self._request("/api/security/prompt-injection", method="POST", body=payload)

    # --- Category 11: Agent Messaging ---

    def send_message(self, body, to=None, message_type="info", attachments=None, **kwargs):
        payload = {
            "from_agent_id": self.agent_id,
            "to_agent_id": to,
            "message_type": message_type,
            "body": body,
            **kwargs
        }
        if attachments:
            payload["attachments"] = attachments
        return self._request("/api/messages", method="POST", body=payload)

    @contextmanager
    def action_context(self, action_id):
        """Context manager that auto-tags messages and assumptions with action_id.

        Usage:
            with claw.action_context("act_123") as ctx:
                ctx.send_message("Hello", to="agent-b")
                ctx.record_assumption({"assumption": "Staging is clear"})
                ctx.update_outcome(status="completed")
        """
        class _ActionContext:
            def __init__(ctx_self):
                ctx_self.action_id = action_id

            def send_message(ctx_self, body, to=None, message_type="info", attachments=None, **kwargs):
                kwargs["action_id"] = action_id
                return self.send_message(body, to=to, message_type=message_type, attachments=attachments, **kwargs)

            def record_assumption(ctx_self, assumption):
                if isinstance(assumption, dict):
                    assumption = {**assumption, "action_id": action_id}
                return self.record_assumption(assumption)

            def update_outcome(ctx_self, status=None, **kwargs):
                return self.update_outcome(action_id, status=status, **kwargs)

        yield _ActionContext()

    def get_inbox(self, **filters):
        filters["agent_id"] = self.agent_id
        filters["direction"] = "inbox"
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        return self._request(f"/api/messages?{query}")

    def get_sent_messages(self, message_type=None, thread_id=None, limit=None):
        """Get messages sent by this agent."""
        params = {"agent_id": self.agent_id, "direction": "sent"}
        if message_type is not None:
            params["type"] = message_type
        if thread_id is not None:
            params["thread_id"] = thread_id
        if limit is not None:
            params["limit"] = limit
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return self._request(f"/api/messages?{query}")

    def get_messages(self, direction=None, message_type=None, unread=None, thread_id=None, limit=None):
        """Get messages with full filter control. direction: 'inbox' | 'sent' | 'all'"""
        params = {"agent_id": self.agent_id}
        if direction is not None:
            params["direction"] = direction
        if message_type is not None:
            params["type"] = message_type
        if unread:
            params["unread"] = "true"
        if thread_id is not None:
            params["thread_id"] = thread_id
        if limit is not None:
            params["limit"] = limit
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return self._request(f"/api/messages?{query}")

    def get_message(self, message_id):
        """Get a single message by ID."""
        return self._request(f"/api/messages/{urllib.parse.quote(message_id)}")

    def mark_read(self, message_ids):
        return self._request("/api/messages", method="PATCH", body={
            "message_ids": message_ids,
            "action": "read",
            "agent_id": self.agent_id,
        })

    def archive_messages(self, message_ids):
        return self._request("/api/messages", method="PATCH", body={
            "message_ids": message_ids,
            "action": "archive",
            "agent_id": self.agent_id,
        })

    def broadcast(self, body, message_type="info", subject=None, thread_id=None):
        return self.send_message(
            body=body,
            to=None,
            message_type=message_type,
            subject=subject,
            thread_id=thread_id,
        )

    def create_message_thread(self, name, participants=None):
        return self._request("/api/messages/threads", method="POST", body={
            "name": name,
            "participants": participants,
            "created_by": self.agent_id,
        })

    def get_message_threads(self, status=None, limit=None):
        params = {"agent_id": self.agent_id}
        if status is not None:
            params["status"] = status
        if limit is not None:
            params["limit"] = limit
        query = urllib.parse.urlencode(params)
        return self._request(f"/api/messages/threads?{query}")

    def resolve_message_thread(self, thread_id, summary=None):
        return self._request("/api/messages/threads", method="PATCH", body={
            "thread_id": thread_id,
            "status": "resolved",
            "summary": summary,
        })

    def save_shared_doc(self, name, content):
        return self._request("/api/messages/docs", method="POST", body={
            "name": name,
            "content": content,
            "agent_id": self.agent_id,
        })

    def get_attachment_url(self, attachment_id):
        """Get the URL to download an attachment."""
        return f"{self.base_url}/api/messages/attachments?id={urllib.parse.quote(attachment_id)}"

    def get_attachment(self, attachment_id):
        """Download an attachment's binary data."""
        url = self.get_attachment_url(attachment_id)
        req = urllib.request.Request(url, headers={"x-api-key": self.api_key})
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            content_type = resp.headers.get("Content-Type", "application/octet-stream")
            cd = resp.headers.get("Content-Disposition", "")
            import re
            match = re.search(r'filename="(.+?)"', cd)
            filename = match.group(1) if match else attachment_id
            return {"data": data, "filename": filename, "mime_type": content_type}

    # --- Category 13: Policy Enforcement (Guard) ---

    def guard(self, context):
        """Can I do X?

        Returns a guard decision dict with at minimum:
            decision         : 'allow' | 'block' | 'require_approval' | 'warn'
            reason           : str | None
            signals          : list[str]
            verification_status : 'verified' | 'unverified' | 'expired'
                                | 'failed' | 'unknown_issuer'
            agent_id         : str | None  (JWT sub when verified, else body value)
            agent_name       : str | None

        Phase 2 (#104): pass `auth_token` to the constructor to attach a JWT
        bearer token; the server verifies it via JWKS and the JWT sub claim
        overrides `agent_id` in the audit record on success. See
        docs/agent-identity.md.

        Non-fabrication (optional): include ``content`` (outbound text) and
        ``source_of_truth`` in the context to have a ``non_fabrication`` policy
        verify the content; the decision carries a signed, re-verifiable receipt
        under ``non_fabrication``.
        """
        payload = {
            # Approvals lifecycle: declare the wait window this client will
            # poll if the decision is require_approval, so the pending row
            # gets a truthful approval_expires_at stamp. Matches the
            # wait_for_approval default (300s); context value wins.
            "approval_wait_seconds": 300,
            **context,
            "agent_id": context.get("agent_id", self.agent_id),
        }
        # Phase 1 parity with Node SDK: include agent_name from the constructor
        # for audit attribution if the caller didn't supply one in `context`.
        if context.get("agent_name") is None and self.agent_name:
            payload["agent_name"] = self.agent_name
        return self._request("/api/guard", "POST", json=payload)

    def run_governed(self, act, params, fn):
        """Evidence-first guard: one call that runs the full governance loop
        with `act` attached, so the server classifies it and folds the
        derived risk in rather than trusting a self-declared action_type.
        Node parity: sdk/dashclaw.js runGoverned. See
        docs/superpowers/specs/2026-07-05-evidence-first-guard.md.

        guard(with act) -> create_action -> (if pending_approval and
        params.get("wait") is not False) wait_for_approval -> fn() ->
        one-shot outcome report (completed on success, failed on exception).

        ``act``: {"kind": "shell"|"http"|"sql"|"file", ...} — see the wire
        contract. Scrubbed client-side before send.
        ``params``: context/action fields (action_type, declared_goal,
        risk_score, ...). ``wait`` (default True) controls whether to block
        on a pending approval; pass ``wait=False`` to skip
        wait_for_approval and poll separately instead.
        ``fn``: zero-arg callable — the real work to run once guard/approval
        clears.

        Raises GuardBlockedError when guard or create_action blocks the
        action, ApprovalDeniedError when an operator denies the pending
        approval.
        """
        context = dict(params or {})
        wait = context.pop("wait", None)
        scrubbed_act = scrub_act(act)

        decision = self.guard({**context, "act": scrubbed_act})
        if decision.get("decision") == "block":
            raise GuardBlockedError(decision)

        action_type = context.get("action_type")
        declared_goal = context.get("declared_goal")
        extra = {k: v for k, v in context.items() if k not in ("action_type", "declared_goal")}
        result = self.create_action(action_type, declared_goal, act=scrubbed_act, **extra)
        action_id = result.get("action_id")
        action = result.get("action") or {}
        if action.get("status") == "pending_approval" and wait is not False:
            self.wait_for_approval(action_id)

        try:
            value = fn()
            self.report_action_outcome(action_id, "completed")
            return value
        except Exception as e:
            self.report_action_outcome(action_id, "failed", error_message=str(e))
            raise

    def get_guard_decisions(self, decision=None, limit=20, offset=0, agent_id=None):
        params = {
            "agent_id": agent_id or self.agent_id,
            "limit": limit,
            "offset": offset,
        }
        if decision:
            params["decision"] = decision
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return self._request(f"/api/guard?{query}")

    # --- Category 14: Webhooks ---

    def get_webhooks(self):
        return self._request("/api/webhooks")

    def create_webhook(self, url, events=None):
        payload = {"url": url}
        if events is not None:
            payload["events"] = events
        return self._request("/api/webhooks", method="POST", body=payload)

    def delete_webhook(self, webhook_id):
        webhook_id = urllib.parse.quote(str(webhook_id), safe="")
        return self._request(f"/api/webhooks?id={webhook_id}", method="DELETE")

    def test_webhook(self, webhook_id):
        return self._request(f"/api/webhooks/{webhook_id}/test", method="POST")

    def get_webhook_deliveries(self, webhook_id):
        return self._request(f"/api/webhooks/{webhook_id}/deliveries")

    # --- Category 14: Policy Testing ---

    def test_policies(self):
        """Run guardrails tests against all active policies."""
        return self._request("/api/policies/test", method="POST", body={
            "agent_id": self.agent_id,
        })

    def get_proof_report(self, format="json"):
        """Generate a compliance proof report from active policies."""
        params = {"format": format} if format else {}
        query = urllib.parse.urlencode(params)
        return self._request(f"/api/policies/proof?{query}")

    def import_policies(self, pack=None, yaml=None):
        """Import a policy pack or raw YAML. Requires admin role."""
        payload = {}
        if pack is not None:
            payload["pack"] = pack
        if yaml is not None:
            payload["yaml"] = yaml
        return self._request("/api/policies/import", method="POST", body=payload)

    # --- Category 15: Compliance Engine ---

    def map_compliance(self, framework):
        """Map active policies to a compliance framework's controls."""
        framework_enc = urllib.parse.quote(str(framework), safe="")
        return self._request(f"/api/compliance/map?framework={framework_enc}")

    def analyze_gaps(self, framework):
        """Run gap analysis on a compliance framework mapping."""
        framework_enc = urllib.parse.quote(str(framework), safe="")
        return self._request(f"/api/compliance/gaps?framework={framework_enc}")

    def get_compliance_report(self, framework, format="json"):
        """Generate a full compliance report and save a snapshot."""
        params = {"framework": framework}
        if format:
            params["format"] = format
        query = urllib.parse.urlencode(params)
        return self._request(f"/api/compliance/report?{query}")

    def list_frameworks(self):
        """List available compliance frameworks."""
        return self._request("/api/compliance/frameworks")

    def get_compliance_evidence(self, window="30d"):
        """Get live compliance evidence from guard decisions and actions."""
        params = {"window": window} if window else {}
        query = urllib.parse.urlencode(params)
        return self._request(f"/api/compliance/evidence?{query}")

    # --- Agent Pairing ---

    def create_pairing(self, public_key_pem, algorithm="RSASSA-PKCS1-v1_5", agent_name=None):
        """Create an agent pairing request."""
        payload = {
            "agent_id": self.agent_id,
            "agent_name": agent_name or self.agent_name,
            "public_key": public_key_pem,
            "algorithm": algorithm,
        }
        return self._request("/api/pairings", method="POST", body=payload)

    def create_pairing_from_private_jwk(self, private_jwk, agent_name=None):
        """Derive a public PEM from a private JWK dict and create a pairing request.
        Requires the 'cryptography' package (pip install cryptography).
        """
        try:
            from cryptography.hazmat.primitives.serialization import (
                Encoding, PublicFormat, load_der_private_key
            )
            from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
            import json as json_mod

            # cryptography can load JWK via the jwcrypto or manually; use DER round-trip
            # The simplest path: serialize JWK -> PEM via cryptography's JWT support isn't
            # built-in, so use the private key object if already provided, else try jwcrypto.
            try:
                from jwcrypto import jwk as jwcrypto_jwk
                key = jwcrypto_jwk.JWK(**private_jwk)
                public_pem = key.export_to_pem(private_key=False, password=None).decode("utf-8")
            except ImportError:
                # Fallback: try loading via cryptography's hazmat directly from JWK components
                from cryptography.hazmat.primitives.asymmetric.rsa import (
                    RSAPrivateNumbers, RSAPublicNumbers, rsa_crt_iqmp, rsa_crt_dmp1, rsa_crt_dmq1
                )
                from cryptography.hazmat.backends import default_backend

                def b64url_to_int(s):
                    import base64
                    padded = s + '=' * (4 - len(s) % 4)
                    return int.from_bytes(base64.urlsafe_b64decode(padded), 'big')

                n = b64url_to_int(private_jwk['n'])
                e = b64url_to_int(private_jwk['e'])
                d = b64url_to_int(private_jwk['d'])
                p = b64url_to_int(private_jwk['p'])
                q = b64url_to_int(private_jwk['q'])
                dp = b64url_to_int(private_jwk.get('dp') or private_jwk.get('dmp1'))
                dq = b64url_to_int(private_jwk.get('dq') or private_jwk.get('dmq1'))
                qi = b64url_to_int(private_jwk.get('qi') or private_jwk.get('iqmp'))

                pub_numbers = RSAPublicNumbers(e, n)
                priv_numbers = RSAPrivateNumbers(p, q, d, dp, dq, qi, pub_numbers)
                private_key = priv_numbers.private_key(default_backend())
                public_pem = private_key.public_key().public_bytes(
                    Encoding.PEM, PublicFormat.SubjectPublicKeyInfo
                ).decode("utf-8")

        except Exception as e:
            raise DashClawError(f"create_pairing_from_private_jwk failed: {e}")

        return self.create_pairing(public_pem, agent_name=agent_name)

    def wait_for_pairing(self, pairing_id, timeout=300, interval=2):
        """Poll a pairing until it is approved or expired."""
        pairing_id_enc = urllib.parse.quote(str(pairing_id), safe="")
        start = time.time()
        while (time.time() - start) < timeout:
            res = self._request(f"/api/pairings/{pairing_id_enc}")
            pairing = res.get("pairing", {})
            if pairing.get("status") == "approved":
                return pairing
            if pairing.get("status") == "expired":
                raise DashClawError("Pairing expired")
            time.sleep(interval)
        raise TimeoutError("Timed out waiting for pairing approval")

    def get_pairing(self, pairing_id):
        """Get a pairing request by ID."""
        pairing_id_enc = urllib.parse.quote(str(pairing_id), safe="")
        return self._request(f"/api/pairings/{pairing_id_enc}")

    # --- Identity Binding ---

    def register_identity(self, agent_id, public_key, algorithm="RSASSA-PKCS1-v1_5"):
        """Register or update an agent's public key. Requires admin API key."""
        payload = {"agent_id": agent_id, "public_key": public_key, "algorithm": algorithm}
        return self._request("/api/identities", method="POST", body=payload)

    def get_identities(self):
        """List all registered agent identities for this org."""
        return self._request("/api/identities")

    # --- Organization Management ---

    def get_org(self):
        """Get the current organization's details. Requires admin API key."""
        return self._request("/api/orgs")

    def create_org(self, name, slug):
        """Create a new organization with an initial admin API key."""
        return self._request("/api/orgs", method="POST", body={"name": name, "slug": slug})

    def get_org_by_id(self, org_id):
        """Get organization details by ID. Requires admin API key."""
        org_id_enc = urllib.parse.quote(str(org_id), safe="")
        return self._request(f"/api/orgs/{org_id_enc}")

    def update_org(self, org_id, **updates):
        """Update organization details. Requires admin API key."""
        org_id_enc = urllib.parse.quote(str(org_id), safe="")
        return self._request(f"/api/orgs/{org_id_enc}", method="PATCH", body=updates)

    def get_org_keys(self, org_id):
        """List API keys for an organization. Requires admin API key."""
        org_id_enc = urllib.parse.quote(str(org_id), safe="")
        return self._request(f"/api/orgs/{org_id_enc}/keys")

    # --- Activity Logs ---

    def get_activity_logs(self, **filters):
        """Get activity/audit logs for the organization."""
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        path = f"/api/activity?{query}" if query else "/api/activity"
        return self._request(path)

    # --- Work Orders (task-grade contracts + receipts) ---

    def submit_work_order(self, order):
        """Submit a work order against a registered contract."""
        payload = dict(order)
        payload.setdefault("requested_by", self.agent_id)
        return self._request("/api/work-orders", "POST", json=payload)

    def get_work_order(self, work_order_id):
        """Get a work order + its receipt (when terminal)."""
        return self._request(f"/api/work-orders/{work_order_id}", "GET")

    def list_work_orders(self, filters=None):
        """List work orders. Filters: status, type, agent, limit, offset."""
        return self._request("/api/work-orders", "GET", params=filters or {})

    def cancel_work_order(self, work_order_id):
        """Cancel a queued/claimed/pending-approval work order."""
        return self._request(f"/api/work-orders/{work_order_id}", "DELETE")

    def claim_work_order(self, types=None, agent_id=None):
        """Worker: claim the next queued order of the given types."""
        return self._request("/api/work-orders/claim", "POST", json={
            "types": types,
            "agent_id": agent_id or self.agent_id,
        })

    def complete_work_order(self, work_order_id, result):
        """Worker: report completion. result = {status, output?, cost?, error?}."""
        payload = dict(result)
        payload.setdefault("agent_id", self.agent_id)
        return self._request(f"/api/work-orders/{work_order_id}/complete", "POST", json=payload)

    def list_work_order_types(self):
        """List registered work order contracts."""
        return self._request("/api/work-orders/types", "GET")

    def register_work_order_type(self, definition):
        """Register a new work order contract (input/output JSON Schema)."""
        return self._request("/api/work-orders/types", "POST", json=definition)

    # -----------------------------------------------
    # Prompt Management
    # -----------------------------------------------

    def list_prompt_templates(self, category: str = None) -> dict:
        """List all prompt templates, optionally filtered by category."""
        params = f"?category={category}" if category else ""
        return self._request(f"/api/prompts/templates{params}", "GET")

    def create_prompt_template(self, name: str, description: str = "", category: str = "general") -> dict:
        """Create a new prompt template."""
        return self._request("/api/prompts/templates", "POST", body={"name": name, "description": description, "category": category})

    def get_prompt_template(self, template_id: str) -> dict:
        """Get a prompt template by ID."""
        return self._request(f"/api/prompts/templates/{template_id}", "GET")

    def update_prompt_template(self, template_id: str, **fields) -> dict:
        """Update a prompt template (name, description, category)."""
        return self._request(f"/api/prompts/templates/{template_id}", "PATCH", body=fields)

    def delete_prompt_template(self, template_id: str) -> dict:
        """Delete a prompt template and all its versions."""
        return self._request(f"/api/prompts/templates/{template_id}", "DELETE")

    def list_prompt_versions(self, template_id: str) -> dict:
        """List all versions for a template."""
        return self._request(f"/api/prompts/templates/{template_id}/versions", "GET")

    def create_prompt_version(self, template_id: str, content: str, model_hint: str = "", parameters: list = None, changelog: str = "") -> dict:
        """Create a new version for a template."""
        return self._request(f"/api/prompts/templates/{template_id}/versions", "POST", body={
            "content": content,
            "model_hint": model_hint,
            "parameters": parameters or [],
            "changelog": changelog,
        })

    def get_prompt_version(self, template_id: str, version_id: str) -> dict:
        """Get a specific version."""
        return self._request(f"/api/prompts/templates/{template_id}/versions/{version_id}", "GET")

    def activate_prompt_version(self, template_id: str, version_id: str) -> dict:
        """Activate a specific version (deactivates all others for that template)."""
        return self._request(f"/api/prompts/templates/{template_id}/versions/{version_id}", "POST")

    def render_prompt(self, template_id: str = None, version_id: str = None, variables: dict = None, action_id: str = None, agent_id: str = None, record: bool = False) -> dict:
        """Render a prompt template with variables. Optionally record as a prompt run."""
        return self._request("/api/prompts/render", "POST", body={
            "template_id": template_id,
            "version_id": version_id,
            "variables": variables or {},
            "action_id": action_id,
            "agent_id": agent_id,
            "record": record,
        })

    def list_prompt_runs(self, template_id: str = None, version_id: str = None, limit: int = 50) -> dict:
        """List prompt execution runs."""
        params = []
        if template_id:
            params.append(f"template_id={template_id}")
        if version_id:
            params.append(f"version_id={version_id}")
        if limit:
            params.append(f"limit={limit}")
        qs = f"?{'&'.join(params)}" if params else ""
        return self._request(f"/api/prompts/runs{qs}", "GET")

    def get_prompt_stats(self, template_id: str = None) -> dict:
        """Get prompt usage statistics."""
        params = f"?template_id={template_id}" if template_id else ""
        return self._request(f"/api/prompts/stats{params}", "GET")

    # ----------------------------------------------
    # Category: Evaluations
    # ----------------------------------------------

    def create_score(self, action_id, scorer_name, score, label=None, reasoning=None, evaluated_by=None, metadata=None):
        """Create an evaluation score for an action."""
        return self._request("/api/evaluations", "POST", body={
            "action_id": action_id,
            "scorer_name": scorer_name,
            "score": score,
            "label": label,
            "reasoning": reasoning,
            "evaluated_by": evaluated_by,
            "metadata": metadata,
        })

    def get_scores(self, **filters):
        """List evaluation scores with optional filters."""
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        path = f"/api/evaluations?{query}" if query else "/api/evaluations"
        return self._request(path, "GET")

    def create_scorer(self, name, scorer_type, config=None, description=None):
        """Create a reusable scorer definition."""
        return self._request("/api/evaluations/scorers", "POST", body={
            "name": name,
            "scorer_type": scorer_type,
            "config": config,
            "description": description,
        })

    def get_scorers(self):
        """List all scorers for this org."""
        return self._request("/api/evaluations/scorers", "GET")

    def update_scorer(self, scorer_id, **updates):
        """Update a scorer."""
        return self._request(f"/api/evaluations/scorers/{scorer_id}", "PATCH", body=updates)

    def delete_scorer(self, scorer_id):
        """Delete a scorer."""
        return self._request(f"/api/evaluations/scorers/{scorer_id}", "DELETE")

    def create_eval_run(self, name, scorer_id, action_filters=None):
        """Create and start an evaluation run."""
        return self._request("/api/evaluations/runs", "POST", body={
            "name": name,
            "scorer_id": scorer_id,
            "action_filters": action_filters,
        })

    def get_eval_runs(self, **filters):
        """List evaluation runs."""
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        path = f"/api/evaluations/runs?{query}" if query else "/api/evaluations/runs"
        return self._request(path, "GET")

    def get_eval_run(self, run_id):
        """Get details of an evaluation run."""
        return self._request(f"/api/evaluations/runs/{run_id}", "GET")

    def get_eval_stats(self, **filters):
        """Get aggregate evaluation statistics."""
        query = urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None})
        path = f"/api/evaluations/stats?{query}" if query else "/api/evaluations/stats"
        return self._request(path, "GET")

    # -----------------------------------------------
    # Compliance Export
    # -----------------------------------------------

    def create_compliance_export(self, frameworks: list, name: str = "Compliance Export", format: str = "markdown", window_days: int = 30, include_evidence: bool = True, include_remediation: bool = True, include_trends: bool = False) -> dict:
        """Generate a compliance export for one or more frameworks."""
        return self._request("/api/compliance/exports", method="POST", body={
            "name": name, "frameworks": frameworks, "format": format, "window_days": window_days,
            "include_evidence": include_evidence, "include_remediation": include_remediation, "include_trends": include_trends,
        })

    def list_compliance_exports(self, limit: int = 20) -> dict:
        """List compliance export records."""
        return self._request(f"/api/compliance/exports?limit={limit}")

    def get_compliance_export(self, export_id: str) -> dict:
        """Get a specific compliance export with full report content."""
        return self._request(f"/api/compliance/exports/{export_id}")

    def download_compliance_export(self, export_id: str) -> dict:
        """Download the signed compliance bundle (JSON) for an export.

        Returns the parsed signed bundle dict. The human-readable report is at
        ``result["payload"]["report"]``; re-verify the whole bundle via
        ``POST /api/integrity/verify``.
        """
        return self._request(f"/api/compliance/exports/{export_id}/download")

    def delete_compliance_export(self, export_id: str) -> dict:
        """Delete a compliance export."""
        return self._request(f"/api/compliance/exports/{export_id}", method="DELETE")

    def create_compliance_schedule(self, frameworks: list, cron_expression: str, name: str = "Scheduled Export", **kwargs) -> dict:
        """Create a recurring compliance export schedule."""
        return self._request("/api/compliance/schedules", method="POST", body={
            "name": name, "frameworks": frameworks, "cron_expression": cron_expression, **kwargs,
        })

    def list_compliance_schedules(self) -> dict:
        """List compliance export schedules."""
        return self._request("/api/compliance/schedules")

    def update_compliance_schedule(self, schedule_id: str, **fields) -> dict:
        """Update a compliance schedule (toggle enabled, rename)."""
        return self._request(f"/api/compliance/schedules/{schedule_id}", method="PATCH", body=fields)

    def delete_compliance_schedule(self, schedule_id: str) -> dict:
        """Delete a compliance schedule."""
        return self._request(f"/api/compliance/schedules/{schedule_id}", method="DELETE")

    def get_compliance_trends(self, framework: str = None, limit: int = 30) -> dict:
        """Get compliance coverage trend data from snapshots."""
        params = []
        if framework: params.append(f"framework={framework}")
        if limit: params.append(f"limit={limit}")
        qs = f"?{'&'.join(params)}" if params else ""
        return self._request(f"/api/compliance/trends{qs}")

    # -----------------------------------------------
    # Drift Detection
    # -----------------------------------------------

    def compute_drift_baselines(self, agent_id: str = None, lookback_days: int = 30) -> dict:
        """Compute statistical baselines from historical agent data."""
        return self._request("/api/drift/alerts", method="POST", json={"action": "compute_baselines", "agent_id": agent_id, "lookback_days": lookback_days})

    def detect_drift(self, agent_id: str = None, window_days: int = 7) -> dict:
        """Run drift detection comparing recent window to baseline."""
        return self._request("/api/drift/alerts", method="POST", json={"action": "detect", "agent_id": agent_id, "window_days": window_days})

    def record_drift_snapshots(self) -> dict:
        """Record daily metric snapshots for trend visualization."""
        return self._request("/api/drift/alerts", method="POST", json={"action": "record_snapshots"})

    def list_drift_alerts(self, agent_id: str = None, severity: str = None, acknowledged: bool = None, limit: int = 50) -> dict:
        """List drift alerts with optional filters."""
        params = []
        if agent_id: params.append(f"agent_id={agent_id}")
        if severity: params.append(f"severity={severity}")
        if acknowledged is not None: params.append(f"acknowledged={str(acknowledged).lower()}")
        if limit: params.append(f"limit={limit}")
        qs = f"?{'&'.join(params)}" if params else ""
        return self._request(f"/api/drift/alerts{qs}")

    def acknowledge_drift_alert(self, alert_id: str) -> dict:
        """Acknowledge a drift alert."""
        return self._request(f"/api/drift/alerts/{alert_id}", method="PATCH")

    def delete_drift_alert(self, alert_id: str) -> dict:
        """Delete a drift alert."""
        return self._request(f"/api/drift/alerts/{alert_id}", method="DELETE")

    def get_drift_stats(self, agent_id: str = None) -> dict:
        """Get drift detection statistics."""
        params = f"?agent_id={agent_id}" if agent_id else ""
        return self._request(f"/api/drift/stats{params}")

    def get_drift_snapshots(self, agent_id: str = None, metric: str = None, limit: int = 30) -> dict:
        """Get metric trend snapshots."""
        params = []
        if agent_id: params.append(f"agent_id={agent_id}")
        if metric: params.append(f"metric={metric}")
        if limit: params.append(f"limit={limit}")
        qs = f"?{'&'.join(params)}" if params else ""
        return self._request(f"/api/drift/snapshots{qs}")

    def get_drift_metrics(self) -> dict:
        """List available drift detection metrics."""
        return self._request("/api/drift/metrics")

    # -----------------------------------------------
    # Learning Analytics
    # -----------------------------------------------

    def compute_learning_velocity(self, agent_id: str = None, lookback_days: int = 30, period: str = "daily") -> dict:
        """Compute learning velocity (rate of score improvement) for agents."""
        return self._request("/api/learning/analytics/velocity", method="POST", json={"agent_id": agent_id, "lookback_days": lookback_days, "period": period})

    def get_learning_velocity(self, agent_id: str = None, limit: int = 30) -> dict:
        """Get computed velocity data."""
        params = []
        if agent_id: params.append(f"agent_id={agent_id}")
        if limit: params.append(f"limit={limit}")
        qs = f"?{'&'.join(params)}" if params else ""
        return self._request(f"/api/learning/analytics/velocity{qs}")

    def compute_learning_curves(self, agent_id: str = None, lookback_days: int = 60) -> dict:
        """Compute learning curves per action type."""
        return self._request("/api/learning/analytics/curves", method="POST", json={"agent_id": agent_id, "lookback_days": lookback_days})

    def get_learning_curves(self, agent_id: str = None, action_type: str = None, limit: int = 50) -> dict:
        """Get learning curve data."""
        params = []
        if agent_id: params.append(f"agent_id={agent_id}")
        if action_type: params.append(f"action_type={action_type}")
        if limit: params.append(f"limit={limit}")
        qs = f"?{'&'.join(params)}" if params else ""
        return self._request(f"/api/learning/analytics/curves{qs}")

    def get_learning_analytics_summary(self, agent_id: str = None) -> dict:
        """Get comprehensive learning analytics summary."""
        params = f"?agent_id={agent_id}" if agent_id else ""
        return self._request(f"/api/learning/analytics/summary{params}")

    def get_maturity_levels(self) -> dict:
        """Get the maturity level definitions."""
        return self._request("/api/learning/analytics/maturity")

    # --- Scoring Profiles -----------------------------------

    def create_scoring_profile(self, **kwargs):
        return self._request("/api/scoring/profiles", method="POST", json=kwargs)

    def list_scoring_profiles(self, **params):
        return self._request("/api/scoring/profiles", params=params)

    def get_scoring_profile(self, profile_id):
        return self._request(f"/api/scoring/profiles/{profile_id}")

    def update_scoring_profile(self, profile_id, **kwargs):
        return self._request(f"/api/scoring/profiles/{profile_id}", method="PATCH", json=kwargs)

    def delete_scoring_profile(self, profile_id):
        return self._request(f"/api/scoring/profiles/{profile_id}", method="DELETE")

    def add_scoring_dimension(self, profile_id, **kwargs):
        return self._request(f"/api/scoring/profiles/{profile_id}/dimensions", method="POST", json=kwargs)

    def update_scoring_dimension(self, profile_id, dimension_id, **kwargs):
        return self._request(f"/api/scoring/profiles/{profile_id}/dimensions/{dimension_id}", method="PATCH", json=kwargs)

    def delete_scoring_dimension(self, profile_id, dimension_id):
        return self._request(f"/api/scoring/profiles/{profile_id}/dimensions/{dimension_id}", method="DELETE")

    def score_with_profile(self, profile_id, action):
        if isinstance(action, list):
            raise TypeError("use batch_score_with_profile for arrays")
        return self._request("/api/scoring/score", method="POST", json={"profile_id": profile_id, "action": action})

    def batch_score_with_profile(self, profile_id, actions):
        if not isinstance(actions, list):
            raise TypeError("batch_score_with_profile expects a list")
        return self._request("/api/scoring/score", method="POST", json={"profile_id": profile_id, "actions": actions})

    def get_profile_scores(self, **params):
        return self._request("/api/scoring/score", params=params)

    def get_profile_score_stats(self, profile_id):
        return self._request("/api/scoring/score", params={"profile_id": profile_id, "view": "stats"})

    # --- Risk Templates ------------------------------------

    def create_risk_template(self, **kwargs):
        return self._request("/api/scoring/risk-templates", method="POST", json=kwargs)

    def list_risk_templates(self, **params):
        return self._request("/api/scoring/risk-templates", params=params)

    def update_risk_template(self, template_id, **kwargs):
        return self._request(f"/api/scoring/risk-templates/{template_id}", method="PATCH", json=kwargs)

    def delete_risk_template(self, template_id):
        return self._request(f"/api/scoring/risk-templates/{template_id}", method="DELETE")

    # --- Auto-Calibration ----------------------------------

    def auto_calibrate(self, **options):
        return self._request("/api/scoring/calibrate", method="POST", json=options)

    # --- Session Lifecycle ----------------------------------

    def create_session(self, workspace=None, branch=None):
        """Create a new agent session for lifecycle tracking."""
        payload = {"agent_id": self.agent_id}
        if workspace is not None:
            payload["workspace"] = workspace
        if branch is not None:
            payload["branch"] = branch
        return self._request("/api/sessions", "POST", json=payload)

    def get_session(self, session_id):
        """Get a session by ID."""
        return self._request(f"/api/sessions/{session_id}", "GET")

    def update_session(self, session_id, **updates):
        """Update session state. Fields: status, green_level, branch_freshness, commits_behind, blocked_reason."""
        return self._request(f"/api/sessions/{session_id}", "PATCH", json=updates)

    def list_sessions(self, agent_id=None, status=None, limit=50):
        """List sessions with optional filters."""
        params = {}
        if agent_id is not None:
            params["agent_id"] = agent_id
        if status is not None:
            params["status"] = status
        if limit is not None:
            params["limit"] = limit
        return self._request("/api/sessions", "GET", params=params)

    def get_session_events(self, session_id):
        """Get the event log for a session."""
        return self._request(f"/api/sessions/{session_id}/events", "GET")

    # --- Execution Studio: Execution Graph ----------------

    def get_action_graph(self, action_id):
        """Read-only execution graph (nodes + edges) for an action."""
        return self._request(f"/api/actions/{action_id}/graph", "GET")

    # --- Durable execution finality -----------------------
    # See docs/architecture/durable-execution-finality.md

    def report_action_outcome(self, action_id, status, summary=None, error_message=None, progress=None):
        """Record the terminal outcome of an approved action.

        Status must be one of ``completed``, ``partial``, or ``failed``.
        ``error_message`` is required when ``status='failed'``.
        ``progress`` (dict) is required when ``status='partial'``.

        Raises a 409 error (DashClawError with .status == 409) if the outcome
        is already set — inspect the response body for ``current_status``.
        """
        payload = {"status": status}
        if summary is not None:
            payload["summary"] = summary
        if error_message is not None:
            payload["error_message"] = error_message
        if progress is not None:
            payload["progress"] = progress
        return self._request(f"/api/actions/{action_id}/outcome", "POST", json=payload)

    def get_action_outcome(self, action_id):
        """Read the current outcome state of an action.

        Returns a dict with ``status`` (one of pending, completed, partial,
        failed, lost_confirmation), ``outcome_at``, ``summary``,
        ``error_message``, ``progress``, ``elapsed_ms``. Call before retry
        to avoid re-executing already-completed actions.
        """
        return self._request(f"/api/actions/{action_id}/outcome", "GET")

    def report_action_success(self, action_id, summary=None):
        """Convenience: report a successful terminal outcome."""
        return self.report_action_outcome(action_id, "completed", summary=summary)

    def report_action_failure(self, action_id, error_message, summary=None):
        """Convenience: report a failed terminal outcome. ``error_message`` required."""
        return self.report_action_outcome(
            action_id, "failed", summary=summary, error_message=error_message
        )

    def report_action_partial(self, action_id, progress, summary=None):
        """Convenience: report a partial outcome. ``progress`` (dict) required."""
        return self.report_action_outcome(
            action_id, "partial", summary=summary, progress=progress
        )

    @staticmethod
    def derive_idempotency_key(parts):
        """Derive a stable idempotency key from the intent of an action.

        Pass the same ``parts`` dict for the same logical action; vary at
        least one part for distinct actions. The returned SHA-256 hex digest
        can be supplied to ``create_action(idempotency_key=...)`` so a retried
        create returns the original row instead of inserting a duplicate.

        Reusing the key for a logically distinct action is the agent's bug,
        not DashClaw's — derive from intent (agent_id, action_type, scope,
        request_id), never from time.
        """
        import hashlib

        if not isinstance(parts, dict):
            raise TypeError("derive_idempotency_key: parts must be a dict")
        ordered = "|".join(f"{k}={parts.get(k) if parts.get(k) is not None else ''}" for k in sorted(parts))
        return hashlib.sha256(ordered.encode("utf-8")).hexdigest()

    # --- Execution Studio: Workflow Templates -------------

    def list_workflow_templates(self, status=None, limit=50, offset=0):
        """List workflow templates."""
        params = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        return self._request("/api/workflows/templates", "GET", params=params)

    def create_workflow_template(self, **kwargs):
        """Create a workflow template. Required: name."""
        return self._request("/api/workflows/templates", "POST", json=kwargs)

    def get_workflow_template(self, template_id):
        """Fetch a single workflow template."""
        return self._request(f"/api/workflows/templates/{template_id}", "GET")

    def update_workflow_template(self, template_id, **kwargs):
        """Partial update. Bumps version when steps change."""
        return self._request(f"/api/workflows/templates/{template_id}", "PATCH", json=kwargs)

    def duplicate_workflow_template(self, template_id, **kwargs):
        """Clone a template as a new draft."""
        return self._request(f"/api/workflows/templates/{template_id}/duplicate", "POST", json=kwargs)

    def launch_workflow_template(self, template_id, **kwargs):
        """Launch a template. Creates a traceable action record with workflow metadata.
        Resolves any linked model strategy into a snapshot at launch time."""
        return self._request(f"/api/workflows/templates/{template_id}/launch", "POST", json=kwargs)

    def execute_workflow_template(self, template_id, variables=None, agent_id=None, declared_goal=None):
        """Execute a workflow template through the governed runtime."""
        body = {}
        if variables is not None:
            body["variables"] = variables
        if agent_id is not None:
            body["agent_id"] = agent_id
        if declared_goal is not None:
            body["declared_goal"] = declared_goal
        return self._request(f"/api/workflows/templates/{template_id}/execute", "POST", json=body)

    # --- Execution Studio: Model Strategies ---------------

    def list_model_strategies(self):
        """List model strategies."""
        return self._request("/api/model-strategies", "GET")

    def create_model_strategy(self, **kwargs):
        """Create a model strategy. Required: name, config (with config.primary.provider and config.primary.model)."""
        return self._request("/api/model-strategies", "POST", json=kwargs)

    def get_model_strategy(self, strategy_id):
        """Fetch a single model strategy."""
        return self._request(f"/api/model-strategies/{strategy_id}", "GET")

    def update_model_strategy(self, strategy_id, **kwargs):
        """Partial update. Config patches merge over existing."""
        return self._request(f"/api/model-strategies/{strategy_id}", "PATCH", json=kwargs)

    def delete_model_strategy(self, strategy_id):
        """Delete a model strategy. Nulls soft refs on linked workflow templates."""
        return self._request(f"/api/model-strategies/{strategy_id}", "DELETE")

    def complete_with_strategy(self, strategy_id, messages, **kwargs):
        """Execute a chat completion using a model strategy. Resolves BYOK
        provider credentials, handles fallback chain, enforces budget caps.
        kwargs: max_tokens, temperature, task_mode."""
        return self._request(
            f"/api/model-strategies/{strategy_id}/complete", "POST",
            json={"messages": messages, **kwargs}
        )

    # --- Execution Studio: Knowledge Collections ----------

    def list_knowledge_collections(self, source_type=None, limit=50, offset=0):
        """List knowledge collections."""
        params = {"limit": limit, "offset": offset}
        if source_type is not None:
            params["source_type"] = source_type
        return self._request("/api/knowledge/collections", "GET", params=params)

    def create_knowledge_collection(self, **kwargs):
        """Create a knowledge collection. Required: name."""
        return self._request("/api/knowledge/collections", "POST", json=kwargs)

    def get_knowledge_collection(self, collection_id):
        """Fetch a single knowledge collection."""
        return self._request(f"/api/knowledge/collections/{collection_id}", "GET")

    def update_knowledge_collection(self, collection_id, **kwargs):
        """Update collection metadata."""
        return self._request(f"/api/knowledge/collections/{collection_id}", "PATCH", json=kwargs)

    def list_knowledge_collection_items(self, collection_id, limit=100, offset=0):
        """List items in a knowledge collection."""
        return self._request(f"/api/knowledge/collections/{collection_id}/items", "GET", params={"limit": limit, "offset": offset})

    def add_knowledge_collection_item(self, collection_id, **kwargs):
        """Add an item to a collection. Required: source_uri. Bumps parent doc_count."""
        return self._request(f"/api/knowledge/collections/{collection_id}/items", "POST", json=kwargs)

    def sync_knowledge_collection(self, collection_id):
        """Ingest pending items: fetch, chunk, embed, store. Caller-invoked."""
        return self._request(f"/api/knowledge/collections/{collection_id}/sync", "POST", json={})

    def search_knowledge_collection(self, collection_id, query, limit=5):
        """Semantic search over chunked + embedded collection content."""
        return self._request(
            f"/api/knowledge/collections/{collection_id}/search", "POST",
            json={"query": query, "limit": limit}
        )

    # --- Execution Studio: Capability Registry ------------

    def list_capabilities(self, category=None, risk_level=None, search=None, limit=100, offset=0):
        """Search the capability registry. Filters are combinable."""
        params = {"limit": limit, "offset": offset}
        if category is not None:
            params["category"] = category
        if risk_level is not None:
            params["risk_level"] = risk_level
        if search is not None:
            params["search"] = search
        return self._request("/api/capabilities", "GET", params=params)

    def create_capability(self, **kwargs):
        """Register a capability. Required: name."""
        return self._request("/api/capabilities", "POST", json=kwargs)

    def get_capability(self, capability_id):
        """Fetch a single capability."""
        return self._request(f"/api/capabilities/{capability_id}", "GET")

    def update_capability(self, capability_id, **kwargs):
        """Update a capability."""
        return self._request(f"/api/capabilities/{capability_id}", "PATCH", json=kwargs)

    def invoke_capability(self, capability_id, payload=None, actor=None, reason=None):
        """Invoke a governed capability."""
        body = {}
        if payload is not None:
            body["payload"] = payload
        if actor is not None:
            body["actor"] = actor
        if reason is not None:
            body["reason"] = reason
        return self._request(f"/api/capabilities/{capability_id}/invoke", "POST", json=body)

    def test_capability(self, capability_id, payload=None):
        """Run a non-production test of a capability."""
        body = {}
        if payload is not None:
            body["payload"] = payload
        return self._request(f"/api/capabilities/{capability_id}/test", "POST", json=body)

    def get_capability_health(self, capability_id):
        """Fetch derived health information for a capability."""
        return self._request(f"/api/capabilities/{capability_id}/health", "GET")

    def list_capability_health(self, status=None, certification_status=None, stale_only=None, limit=50, offset=0):
        """List capability health entries with optional operator filters."""
        params = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        if certification_status is not None:
            params["certification_status"] = certification_status
        if stale_only is not None:
            params["stale_only"] = stale_only
        return self._request("/api/capabilities/health", "GET", params=params)

    def get_capability_history(self, capability_id, action_type=None, status=None, limit=20, offset=0):
        """Fetch recent capability test and invoke history."""
        params = {"limit": limit, "offset": offset}
        if action_type is not None:
            params["action_type"] = action_type
        if status is not None:
            params["status"] = status
        return self._request(f"/api/capabilities/{capability_id}/history", "GET", params=params)

    # Agent Reputation -----------------------------------------------------

    def get_agent_reputation(self, agent_id):
        """Get the current reputation vector for an agent."""
        return self._request(f"/api/reputation/agents/{agent_id}", "GET")

    def list_agent_reputation_events(self, agent_id, limit=50, offset=0):
        """List paginated reputation events for an agent."""
        return self._request(f"/api/reputation/agents/{agent_id}/events", "GET", params={"limit": limit, "offset": offset})

    def recompute_agent_reputation(self, agent_id):
        """Recompute the reputation vector from evidence and store a signed receipt."""
        return self._request(f"/api/reputation/agents/{agent_id}/recompute", "POST")

    def get_agent_reputation_receipt(self, agent_id):
        """Get the signed receipt for an agent's current reputation vector."""
        return self._request(f"/api/reputation/agents/{agent_id}/receipt", "GET")

    def verify_reputation_receipt(self, receipt):
        """Verify a reputation receipt against the instance's published signing keys."""
        return self._request("/api/reputation/verify", "POST", json={"receipt": receipt})

    # Managed Secrets --------------------------------------------------------

    def get_agent_env(self, agent_id=None):
        """Fetch the delivery-enabled managed-secret bundle for an agent.

        GET /api/secrets/env — org-level + agent-level merged, decrypted
        server-side. Returns ``{"env": {NAME: value}, "count": n,
        "delivered": [names]}``.

        SECURITY: the returned ``env`` map contains LIVE secret values. Treat
        it as memory-only — never log it, never write it to disk or a cache,
        and never echo values back to a model, a user, or an error message.
        Inject into a child-process environment and let it fall out of scope.

        :param agent_id: agent to fetch the merged bundle for
            (defaults to this client's ``agent_id``).
        """
        return self._request(
            "/api/secrets/env", "GET",
            params={"agent_id": agent_id or self.agent_id},
        )

    # Agent Registry -------------------------------------------------------

    def register_agent(self, name, **kwargs):
        """Register an external delegatable provider."""
        return self._request("/api/agents/registry", "POST", json={"name": name, **kwargs})

    def list_registered_agents(self, status=None):
        """List registered agents (org-scoped)."""
        params = {}
        if status is not None:
            params["status"] = status
        return self._request("/api/agents/registry", "GET", params=params)

    def get_registered_agent(self, registered_agent_id):
        """Get a registered agent's detail."""
        return self._request(f"/api/agents/registry/{registered_agent_id}", "GET")

    def update_registered_agent(self, registered_agent_id, **patch):
        """Update a registered agent."""
        return self._request(f"/api/agents/registry/{registered_agent_id}", "PATCH", json=patch)

    def add_agent_capability(self, registered_agent_id, capability_id):
        """Group an existing capability under a registered agent."""
        return self._request(f"/api/agents/registry/{registered_agent_id}/capabilities", "POST", json={"capability_id": capability_id})

    def list_agent_capabilities(self, registered_agent_id):
        """List capabilities grouped under a registered agent."""
        return self._request(f"/api/agents/registry/{registered_agent_id}/capabilities", "GET")

    def invoke_registered_agent(self, registered_agent_id, capability_id, agent_id=None, payload=None, declared_goal=None):
        """Invoke a capability through a registered agent, governed by the capability runtime + guard."""
        body = {"registered_agent_id": registered_agent_id, "capability_id": capability_id}
        if agent_id is not None:
            body["agent_id"] = agent_id
        if payload is not None:
            body["payload"] = payload
        if declared_goal is not None:
            body["declared_goal"] = declared_goal
        return self._request("/api/agents/invoke", "POST", json=body)

    # x402 spend governance -------------------------------------------------

    def list_providers(self, status=None):
        """List registered x402 providers (org-scoped)."""
        params = {}
        if status is not None:
            params["status"] = status
        return self._request("/api/x402/providers", "GET", params=params)

    def create_provider(self, name, **kwargs):
        """Register a paid x402 provider."""
        return self._request("/api/x402/providers", "POST", json={"name": name, **kwargs})

    def get_provider(self, provider_id):
        """Get a provider's detail + endpoints."""
        return self._request(f"/api/x402/providers/{provider_id}", "GET")

    def update_provider(self, provider_id, **patch):
        """Update a provider."""
        return self._request(f"/api/x402/providers/{provider_id}", "PATCH", json=patch)

    def list_provider_endpoints(self, provider_id):
        """List a provider's endpoints."""
        return self._request(f"/api/x402/providers/{provider_id}/endpoints", "GET")

    def create_provider_endpoint(self, provider_id, name, **kwargs):
        """Add an endpoint to a provider."""
        return self._request(
            f"/api/x402/providers/{provider_id}/endpoints", "POST", json={"name": name, **kwargs}
        )

    def record_purchase(
        self,
        agent_id,
        provider,
        declared_goal,
        purchase_reason,
        context_gap,
        expected_value,
        **kwargs,
    ):
        """Govern + record a paid acquisition. Branch on action['status']."""
        body = {
            "agent_id": agent_id,
            "provider": provider,
            "declared_goal": declared_goal,
            "purchase_reason": purchase_reason,
            "context_gap": context_gap,
            "expected_value": expected_value,
            **kwargs,
        }
        return self._request("/api/x402/purchases", "POST", json=body)

    def list_purchases(self, provider_id=None):
        """List governed purchases (org-scoped)."""
        params = {}
        if provider_id is not None:
            params["provider_id"] = provider_id
        return self._request("/api/x402/purchases", "GET", params=params)

    def record_x402_purchase(
        self,
        agent_id,
        provider,
        spend,
        declared_goal=None,
        purchase_reason=None,
        context_gap=None,
        expected_value=None,
        transaction_hash=None,
        request_id=None,
        currency="USDC",
        payment_method="x402",
    ):
        """Record a SETTLED x402 payment end-to-end in one call.

        Governs + records the purchase, marks it succeeded, and (when given)
        attaches the on-chain receipt. Use this when your agent pays OUTSIDE an
        OpenClaw governance hook (e.g. a native-shell agentcash wrapper) and must
        self-report so the spend lands on Spend -> x402. The server
        resolves/auto-registers the provider from ``provider``, so you do not
        register one first. Only call this for a settled payment -- a free quote
        or a failed call has nothing to record.

        Returns ``{action, purchase, decision, outcome}``.
        """
        origin = provider
        res = self.record_purchase(
            agent_id=agent_id,
            provider=origin,
            declared_goal=declared_goal or f"x402 capability call to {origin}",
            purchase_reason=purchase_reason or f"Paid x402 capability call to {origin}",
            context_gap=context_gap or f"Capability gated behind payment at {origin}",
            expected_value=expected_value or f"Paid result from {origin}",
            spend_amount=spend,
            cost_estimate=spend,
            currency=currency,
            payment_method=payment_method,
        )
        action, purchase, decision = self._unwrap_x402_result(res)
        summary = f"x402 settled: ${spend} {currency} at {origin}"
        receipt = {
            "origin": origin,
            "transactionHash": transaction_hash,
            "requestId": request_id,
        }
        outcome = self._settle_x402_action(action, summary, receipt)
        return {
            "action": action,
            "purchase": purchase,
            "decision": decision,
            "outcome": outcome,
        }

    def _unwrap_x402_result(self, res):
        if not isinstance(res, dict):
            return None, None, None
        return res.get("action"), res.get("purchase"), res.get("decision")

    def _settle_x402_action(self, action, summary, receipt):
        action_id = (action or {}).get("action_id") or (action or {}).get("id")
        if not action_id:
            return None
        outcome = self.report_action_success(action_id, summary)
        if receipt.get("transactionHash") or receipt.get("requestId"):
            self._attach_x402_receipt(action_id, summary, receipt)
        return outcome

    def _attach_x402_receipt(self, action_id, summary, receipt):
        # Attach the receipt snapshot. Python has no standalone
        # record_purchase_result; the artifact POST is inlined here.
        self._request(
            "/api/artifacts",
            "POST",
            json={
                "artifact_type": "x402_purchase_result",
                "name": f"x402 result {action_id}",
                "description": summary,
                "content_json": receipt,
                "content_url": None,
                "source_action_id": action_id,
            },
        )


# Backward compatibility alias (Legacy)
OpenClawAgent = DashClaw

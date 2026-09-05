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

# V5: wait_for_plan_review's terminal set. "pending" and "previewing" are both
# non-terminal — a plan dry-running its steps ("previewing") hasn't reached an
# operator verdict yet, same as "pending".
_PLAN_REVIEW_TERMINAL_STATUSES = {"approved", "partially_approved", "denied", "revoked", "expired"}

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

class ApprovalPendingError(DashClawError):
    """Thrown by run_governed(wait=False) when the action still needs approval.

    The governed work was NOT executed. Poll wait_for_approval(action_id) and
    re-run once approved.
    """
    def __init__(self, action_id):
        super().__init__(
            f"Action {action_id} is pending approval — the governed work was NOT executed. "
            f"Poll wait_for_approval({action_id!r}) and re-run once approved.",
            status=202,
        )
        self.action_id = action_id

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

        if guard_mode not in ["off", "warn", "enforce"]:
            raise ValueError("guard_mode must be one of: off, warn, enforce")

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
        # 'allow_contained' is deliberately NOT restrictive here: it means the
        # server let the act proceed (held for operator promote/discard
        # afterward), not that run_governed/execution should pause. A bare
        # SDK caller never sees it anyway — this client never advertises
        # client_capabilities, so the server negotiates 'allow_contained'
        # down to 'require_approval' before it ever reaches this check.
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

        # guard_mode pre-check: these constructor options were previously
        # accepted, validated, documented — and never read again, so
        # guard_mode="enforce" / hitl_mode="wait" silently governed nothing
        # (the README's own HITL example was a no-op). Enforced here now.
        self._guard_check(payload)

        # Identity Verification: Sign the payload if a private key is available.
        signature = self._sign_payload(payload)
        if signature:
            payload["_signature"] = signature

        result = self._request("/api/actions", "POST", json=payload)

        # hitl_mode="wait": physically hold the agent at the approval gate.
        # wait_for_approval raises ApprovalDeniedError on deny and TimeoutError
        # on timeout — exactly the contract the README documents.
        if self.hitl_mode == "wait" and isinstance(result, dict):
            action = result.get("action") or {}
            action_id = result.get("action_id") or action.get("action_id")
            if action.get("status") == "pending_approval" and action_id:
                approved = self.wait_for_approval(action_id)
                if isinstance(approved, dict):
                    result = {**result, "action": approved}
        return result

    # Fields worth forwarding to the guard pre-check (mirrors the legacy Node
    # SDK's _guardCheck context).
    _GUARD_CONTEXT_FIELDS = (
        "action_type", "declared_goal", "risk_score", "systems_touched",
        "reversible", "target", "write_paths", "content", "source_of_truth", "act",
    )

    def _guard_check(self, payload):
        """Pre-flight guard evaluation for create_action, per guard_mode.

        off     — no pre-check (the server still evaluates guard on POST
                  /api/actions; a block there raises via the 403 response).
        warn    — evaluate and print warnings/blocks, never stop the action.
        enforce — evaluate; a block decision raises GuardBlockedError, and a
                  FAILED guard call raises too (fail closed): proceeding when
                  the guard cannot answer would silently drop enforcement.
        """
        if self.guard_mode == "off":
            return
        context = {k: payload[k] for k in self._GUARD_CONTEXT_FIELDS if payload.get(k) is not None}
        context["agent_id"] = payload.get("agent_id", self.agent_id)
        try:
            decision = self.guard(context)
        except Exception as e:
            if self.guard_mode == "enforce":
                raise DashClawError(
                    f"Guard check failed and guard_mode='enforce' — refusing to proceed ungoverned: {e}"
                )
            print(f"[DashClaw] Guard check failed (guard_mode='warn', proceeding): {e}")
            return
        if self.guard_callback:
            try:
                self.guard_callback(decision)
            except Exception as cb_err:
                print(f"[DashClaw] guard_callback raised: {cb_err}")
        is_blocked = decision.get("decision") == "block"
        warnings_list = decision.get("warnings") or []
        if warnings_list:
            print(f"[DashClaw] Guard warnings: {'; '.join(str(w) for w in warnings_list)}")
        if is_blocked:
            if self.guard_mode == "enforce":
                raise GuardBlockedError(decision)
            print(f"[DashClaw] Guard would block (guard_mode='warn', proceeding): {decision.get('reason')}")

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

    # --- Containment Verdicts (RFC 2026-07-06) ---
    # This SDK never advertises client_capabilities, so a guard() call from
    # this client can never receive decision "allow_contained" in the first
    # place (the server negotiates it down to "require_approval" for
    # non-advertising callers) — resolve_containment/list_contained only
    # manage rows that reached "awaiting_promotion" some other way (e.g. a
    # capability-aware caller, or the dashboard).

    def resolve_containment(self, action_id, verdict):
        """Operator verdict on a contained action awaiting promotion (admin
        credential required).

        verdict: "promote" | "discard". Response is
        {"action": {...}, "promotion_action_id": "..."} on promote,
        {"action": {...}} on discard; "action" is the full action row on
        every path, and "reissued": True marks a re-promote of an
        already-promoted action (grant re-stamp or fresh mint).
        """
        if verdict not in ("promote", "discard"):
            raise ValueError("verdict must be either 'promote' or 'discard'")
        return self._request(f"/api/actions/{action_id}/containment", method="POST", body={"verdict": verdict})

    def list_contained(self, status="awaiting_promotion", limit=None):
        """List actions by containment status (default: awaiting_promotion).

        Rows are enriched with batched evidence state:
        "containment_has_evidence" (a patch artifact exists) and
        "containment_evidence_ref" (the ref the newest captured diff
        describes).
        """
        return self.get_actions(containment_status=status, limit=limit)

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

    # --- Category 2: Decision Integrity (Assumptions) ---

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
        return self._request(f"/api/assumptions/{assumption_id}")

    def validate_assumption(self, assumption_id, validated, invalidated_reason=None):
        payload = {"validated": validated}
        if invalidated_reason:
            payload["invalidated_reason"] = invalidated_reason
        return self._request(f"/api/assumptions/{assumption_id}", method="PATCH", body=payload)

    # --- Category 3: Decision Integrity Signals ---

    def get_signals(self):
        """Get current decision integrity signals. Returns autonomy breaches, logic drift, and governance violations."""
        return self._request("/api/signals")

    # --- Security Scanning ---

    def scan_prompt_injection(self, text, source=None):
        """Scan text for prompt injection attacks (role overrides, delimiter injection, etc.)."""
        payload = {"text": text, "agent_id": self.agent_id}
        if source is not None:
            payload["source"] = source
        return self._request("/api/security/prompt-injection", method="POST", body=payload)

    # --- Category 11: Action Context ---

    @contextmanager
    def action_context(self, action_id):
        """Context manager that auto-tags assumptions and outcome updates with action_id.

        Usage:
            with claw.action_context("act_123") as ctx:
                ctx.record_assumption({"assumption": "Staging is clear"})
                ctx.update_outcome(status="completed")
        """
        class _ActionContext:
            def __init__(ctx_self):
                ctx_self.action_id = action_id

            def record_assumption(ctx_self, assumption):
                if isinstance(assumption, dict):
                    assumption = {**assumption, "action_id": action_id}
                return self.record_assumption(assumption)

            def update_outcome(ctx_self, status=None, **kwargs):
                return self.update_outcome(action_id, status=status, **kwargs)

        yield _ActionContext()

    # --- Category 13: Policy Enforcement (Guard) ---

    def guard(self, context, record=False):
        """Can I do X?

        Returns a guard decision dict with at minimum:
            decision         : 'allow' | 'block' | 'require_approval' | 'warn'
                              | 'allow_contained'
            reason           : str | None
            signals          : list[str]
            verification_status : 'verified' | 'unverified' | 'expired'
                                | 'failed' | 'unknown_issuer'
            agent_id         : str | None  (JWT sub when verified, else body value)
            agent_name       : str | None
            containment      : {"status": "contained", "basis": str} | None

        'allow_contained' (Containment Verdicts, RFC 2026-07-06): a provably
        file-scoped act the server will let proceed but hold for operator
        promote/discard via `resolve_containment` — ONLY when the caller
        declared `client_capabilities: ["allow_contained"]` in the guard
        context. This SDK never sets that field, so a bare SDK caller
        receives 'require_approval' in its place (version skew only ever
        tightens, never silently loosens). When present, `containment`
        carries the eligibility basis.

        Phase 2 (#104): pass `auth_token` to the constructor to attach a JWT
        bearer token; the server verifies it via JWKS and the JWT sub claim
        overrides `agent_id` in the audit record on success. See
        docs/agent-identity.md.

        Stated confidence (optional): include ``confidence`` — your honest
        0-100 integer, stated BEFORE acting, that this action completes
        without a human stepping in. It is stored on the action record the
        guard call creates and scored against the real outcome on /decisions
        (Predicted vs actual); it never affects the decision. Omit it rather
        than guess — exactly 50 is the column default and reads as
        "unstated", and an unusable value is dropped rather than rejected.

        Non-fabrication (optional): include ``content`` (outbound text) and
        ``source_of_truth`` in the context to have a ``non_fabrication`` policy
        verify the content; the decision carries a signed, re-verifiable receipt
        under ``non_fabrication``.

        ``record`` (default False): pass True to add ``?record=true``, which
        also creates the action record in this same request (the response
        then carries ``recorded`` and ``action_id``) — used by
        ``run_governed`` to fold guard+create_action into one HTTP call.
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
        # Match create_action retry identity without changing evaluation-only
        # calls or overriding an explicit caller key.
        if record and not payload.get("idempotency_key"):
            payload["idempotency_key"] = self.derive_idempotency_key({
                "agent_id": payload.get("agent_id") or "",
                "action_type": payload.get("action_type") or "",
                "declared_goal": payload.get("declared_goal") or "",
                "session_id": payload.get("session_id") or "",
                "ts_bucket": int(time.time() // 3600),
            })
        params = {"record": "true"} if record else None
        return self._request("/api/guard", "POST", json=payload, params=params)

    def run_governed(self, act, params, fn):
        """Evidence-first guard: one call that runs the full governance loop
        with `act` attached, so the server classifies it and folds the
        derived risk in rather than trusting a self-declared action_type.
        Node parity: sdk/dashclaw.js runGoverned. See
        docs/superpowers/specs/2026-07-05-evidence-first-guard.md.

        guard(with act) -> optional create_action -> approval -> fn() -> outcome.
        Minimal inputs use record=True to combine guard and recording. Richer
        fields, signing, configured guard/HITL modes, or a server that did not
        record use create_action. Either response can require approval.

        ``act``: {"kind": "shell"|"http"|"sql"|"file", ...} — see the wire
        contract. Scrubbed client-side before send.
        ``params``: context/action fields (action_type, declared_goal,
        risk_score, ...). ``wait`` (default True) controls whether to block
        on a pending approval; pass ``wait=False`` to get an
        ApprovalPendingError instead of blocking — the governed work is
        NEVER run while the approval is pending. Poll and re-run once
        approved.
        ``fn``: zero-arg callable — the real work to run once guard/approval
        clears.

        Raises GuardBlockedError when guard blocks the action,
        ApprovalDeniedError when an operator denies the pending approval,
        ApprovalPendingError when the action needs approval and
        ``wait=False`` was passed (fn() was not executed).
        """
        context = dict(params or {})
        wait = context.pop("wait", None)
        scrubbed_act = scrub_act(act)
        guard_context = {**context, "act": scrubbed_act}

        # In-guard recording does not preserve richer action metadata or run
        # create_action's signing and configured guard/HITL behavior.
        record_fields = {
            "action_type", "declared_goal", "risk_score", "agent_name", "systems_touched",
            "reversible", "target", "content", "source_of_truth", "intel", "tool",
            "write_paths", "trigger", "swarm_id", "idempotency_key",
            "approval_wait_seconds", "client_capabilities", "metadata", "confidence",
        }
        record = (context.keys() <= record_fields and self.private_key is None
                  and self.guard_mode == "off" and self.hitl_mode == "off")
        decision = self.guard(guard_context, record=record)
        if decision.get("decision") == "block":
            raise GuardBlockedError(decision)

        action_id = decision.get("action_id")
        requires_approval = decision.get("decision") == "require_approval"
        if not record or decision.get("recorded") is not True or not action_id:
            # Server didn't record the action on the guard call — fall back
            # to the previous two-call path so older self-hosted servers
            # keep working.
            action_type = context.get("action_type")
            declared_goal = context.get("declared_goal")
            extra = {k: v for k, v in context.items() if k not in ("action_type", "declared_goal")}
            result = self.create_action(action_type, declared_goal, act=scrubbed_act, **extra)
            action_id = result.get("action_id")
            requires_approval = requires_approval or (result.get("action") or {}).get("status") == "pending_approval"

        if requires_approval:
            # wait=False must not become a silent approval bypass: the previous
            # behavior fell through and executed fn() with the approval still
            # pending. Fail loud instead; the caller polls and re-runs.
            if wait is False:
                raise ApprovalPendingError(action_id)
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

    def create_delegation_constraint(self, rules, name=None, agent_ids=None):
        """POST /api/policies — Create a delegation_constraint policy: cap what a
        composed subagent (parent:child identity) may do. Thin wrapper over the
        policy-create endpoint so attenuation has a first-class verb.
        rules: { parent?, child_types?, max_risk_score?, allowed_action_types?,
            blocked_action_types?, blocked_path_globs?, max_depth?,
            escalate_action?, require_verified_parent? }
        """
        payload = {
            "name": name or "Delegation constraint",
            "policy_type": "delegation_constraint",
            "rules": rules,
            "active": True,
        }
        if agent_ids is not None:
            payload["agent_ids"] = agent_ids
        return self._request("/api/policies", "POST", json=payload)

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

    def submit_plan(self, declared_goal, steps, ttl_minutes=None):
        """Submit a preflight plan for operator review; steps are dry-run server-side."""
        # Hash parity with run_governed/guard: scrub each step's act the same
        # way before it leaves the client, so the server-side
        # act_content_hash binds to what an operator actually reviewed.
        scrubbed_steps = [
            {**step, "act": scrub_act(step["act"])} if isinstance(step, dict) and step.get("act") else step
            for step in steps
        ]
        payload = {"agent_id": self.agent_id, "declared_goal": declared_goal, "steps": scrubbed_steps}
        if ttl_minutes is not None:
            payload["ttl_minutes"] = ttl_minutes
        return self._request("/api/plans", "POST", json=payload)

    def get_plan(self, plan_id):
        """Fetch a plan with per-step grant status."""
        return self._request(f"/api/plans/{plan_id}", "GET")

    def attest_plan(self, plan_id, plan_hash):
        """Prove a pinned plan is still usable before acting on it.

        Returns the attestation only when the plan is approved, unexpired,
        unrevoked and still carries ``plan_hash``; every other outcome raises
        (403/404), so an unattended run fails closed before its first model
        call.
        """
        return self._request(f"/api/plans/{plan_id}/attest", "POST", json={"plan_hash": plan_hash})

    def list_plans(self, status=None, agent_id=None, limit=None):
        """List submitted plans."""
        params = {k: v for k, v in {"status": status, "agent_id": agent_id, "limit": limit}.items() if v is not None}
        return self._request("/api/plans", "GET", params=params)

    def resolve_plan(self, plan_id, verdict, step_overrides=None):
        """Operator verdict on a plan: approve, deny, or revoke (admin credential)."""
        payload = {"verdict": verdict}
        if step_overrides is not None:
            payload["step_overrides"] = step_overrides
        return self._request(f"/api/plans/{plan_id}", "POST", json=payload)

    def wait_for_plan_review(self, plan_id, timeout=300, interval=5):
        """Poll until the plan reaches a terminal review state.

        V5: "previewing" (the plan is still dry-running its steps) is NOT
        terminal, same as "pending" — polling on status != "pending" would
        have returned immediately on a "previewing" plan without ever seeing
        an operator's actual verdict.
        """
        deadline = time.time() + timeout
        while True:
            result = self.get_plan(plan_id)
            plan = (result or {}).get("plan") or {}
            if plan.get("status") in _PLAN_REVIEW_TERMINAL_STATUSES:
                return result
            if time.time() >= deadline:
                raise TimeoutError(f"Plan {plan_id} was not reviewed within {timeout}s")
            time.sleep(interval)


# Backward compatibility alias (Legacy)
OpenClawAgent = DashClaw

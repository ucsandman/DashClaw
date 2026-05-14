#!/usr/bin/env python3
"""
Hermes Agent transform_tool_result hook for DashClaw.

Fires after every tool call, before the result is shown to the model.
Returning a non-empty string replaces the result. We use this to redact
secrets from tool output so they never enter conversation history
(where they would be cached, replayed, and persisted in any logging
pipeline downstream).

Bounded:
  - Only the first 256 KB of result text is scanned; larger payloads
    are passed through unchanged (their size suggests file dumps that
    the agent surfaced deliberately).
  - We redact patterns in place; the rest of the result is preserved
    verbatim so the model can still reason about whatever else the
    tool produced.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dashclaw_common import emit_noop, read_stdin_json  # noqa: E402

import json as _json

MAX_SCAN_BYTES = 256 * 1024
REDACTION = "[DASHCLAW_REDACTED]"

# High-precision secret patterns. Each is intentionally narrow to avoid
# false positives that would make the redacted output confusing.
SECRET_PATTERNS = [
    # Anthropic API keys
    (re.compile(r"sk-ant-[a-zA-Z0-9_\-]{40,}"), "anthropic_key"),
    # OpenAI keys (current and legacy)
    (re.compile(r"sk-(?:proj-)?[a-zA-Z0-9_\-]{40,}"), "openai_key"),
    # AWS access key id
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "aws_access_key"),
    # AWS secret access key (40 base64-ish chars after `aws_secret`)
    (re.compile(r"aws_secret_access_key[\"' :=]+([A-Za-z0-9/+=]{40})", re.IGNORECASE), "aws_secret"),
    # GitHub tokens (classic / fine-grained / app)
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{36,}\b"), "github_token"),
    # Slack tokens
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}\b"), "slack_token"),
    # Stripe live secret keys
    (re.compile(r"\bsk_live_[A-Za-z0-9]{16,}\b"), "stripe_secret"),
    # Generic JWT (header.payload.signature, base64url)
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b"), "jwt"),
    # PEM-style private keys
    (re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----"), "private_key_block"),
    # DashClaw API keys themselves — never let one leak back into context
    (re.compile(r"\bdcw_[A-Za-z0-9_\-]{20,}\b"), "dashclaw_key"),
]


def _redact(text: str) -> tuple[str, list[str]]:
    if not text or len(text) > MAX_SCAN_BYTES:
        return text, []
    hits: list[str] = []
    out = text
    for pattern, label in SECRET_PATTERNS:
        if pattern.search(out):
            hits.append(label)
            out = pattern.sub(REDACTION, out)
    return out, hits


def main() -> int:
    data = read_stdin_json()
    result = data.get("result")

    if isinstance(result, str):
        redacted, hits = _redact(result)
        if hits:
            sys.stdout.write(redacted)
            return 0
        emit_noop()
        return 0

    if isinstance(result, (dict, list)):
        try:
            serialised = _json.dumps(result)
        except Exception:
            emit_noop()
            return 0
        redacted, hits = _redact(serialised)
        if hits:
            sys.stdout.write(redacted)
            return 0

    emit_noop()
    return 0


if __name__ == "__main__":
    sys.exit(main())

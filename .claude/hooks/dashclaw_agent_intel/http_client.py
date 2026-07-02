"""HTTP retry helper shared by every DashClaw hook script.

The Vercel and Neon cold start path can take 3 to 6 seconds combined,
which exceeds the timeout each hook uses for a single request. Without
retries, one cold start blocks a tool call, drops an action update, or
loses a token attribution. Three attempts with exponential backoff absorb
the common case while keeping the worst case bounded.

The latency-critical guard call overrides the retry count via
DASHCLAW_GUARD_RETRIES (default 0: a single attempt, so an unreachable
instance fails closed in ~one connect timeout instead of ~8s of retries
and backoff per tool call).

Stdlib only. No third party dependencies.
"""

import os
import time
import urllib.error
import urllib.request


def env_retries(name, default):
    """Read a retry-count env var. Clamps to >= 0; bad values fall back."""
    raw = os.environ.get(name, "")
    try:
        value = int(raw) if raw != "" else default
    except ValueError:
        return default
    return max(0, value)


def request_with_retry(req, timeout, retries=2):
    """urlopen the given Request with up to retries+1 attempts.

    Returns the response body as bytes on success. Raises the final
    exception when every attempt fails. Sleeps 0.4 seconds after the
    first failure and 0.8 seconds after the second before retrying.

    Worst case latency when the API is down: 1.2 seconds of sleep plus
    one timeout per attempt. Best case when the first attempt succeeds:
    same as a single urlopen call. Cold start case where one attempt
    fails and the next succeeds: roughly 0.4 seconds of extra latency
    on top of the successful attempt.
    """
    last_exc = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            # Transient-only retries: a non-transient 4xx (auth failure,
            # validation error) fails identically on every attempt —
            # retrying burns latency and duplicates work downstream.
            # 408 (request timeout) and 429 (rate limit) stay retryable,
            # as do all 5xx.
            if exc.code < 500 and exc.code not in (408, 429):
                raise
            last_exc = exc
            if attempt < retries:
                time.sleep(0.4 * (2 ** attempt))
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(0.4 * (2 ** attempt))
    if last_exc is not None:
        raise last_exc
    return b""

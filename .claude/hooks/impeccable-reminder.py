#!/usr/bin/env python3
"""
UserPromptSubmit hook: inject a reminder to read .impeccable.md when the
user prompt involves UI, design, copy, or visual work.

The reminder is terse to minimize context cost. The hook runs on every
prompt but only emits output when design-related keywords are matched.
Matching is deliberately narrow to avoid false positives on generic words
like "copy" (as in "copy this file") or "audit" (as in "audit the API").

Behavior:
- Reads Claude Code hook payload (JSON) from stdin.
- Matches design keywords in the user prompt with word boundaries.
- Prints the reminder to stdout when a match is found (stdout becomes
  additional context injected into the conversation).
- Always exits 0 so a broken hook never blocks a prompt.
"""

import json
import re
import sys

# Keywords strongly associated with UI / design / visual / copy work.
# Word-boundary match so "page" won't hit "rampage" and "ui" won't hit "build".
# Deliberately narrow: generic DashClaw domain terms like "decisions",
# "approvals", "component", and "extract" are excluded because they
# appear constantly in backend work too and would cause false positives.
DESIGN_KEYWORDS = re.compile(
    r"\b("
    r"ui|ux|design|redesign|restyle|styling|stylesheet|"
    r"css|tailwind|scss|theme|palette|typography|font|fonts|"
    r"layout|layouts|"
    r"frontend|front-end|"
    r"visual|visuals|aesthetic|"
    r"hero|landing|marketing|microcopy|"
    r"brand|branding|logo|favicon|icon|icons|"
    r"polish|bolder|quieter|distill|delight|colorize|typeset|arrange|animate|"
    r"globals\.css|tailwind\.config|\.impeccable"
    r")\b",
    re.IGNORECASE,
)

# ASCII-only text to avoid encoding mangling on Windows consoles that
# default to cp1252 rather than UTF-8.
REMINDER = (
    "[design-context reminder - DashClaw]\n"
    "This prompt appears to touch UI, design, copy, or visual work. "
    "Before making changes:\n"
    "1. Read `.impeccable.md` at the repo root - it is the canonical design "
    "context for DashClaw (users, brand personality, aesthetic direction, "
    "anti-references, and 7 tiebreaker principles).\n"
    "2. Apply the principles in order: evidence over decoration; brand orange "
    "as signal not noise; calm under pressure; token-first; developer-reader "
    "first; WCAG 2.1 AA floor; four anti-references guardrail (never "
    "generic-SaaS, consumer-AI, heavy-enterprise, or crypto/web3).\n"
    "3. Use CSS tokens from `app/globals.css` and the Tailwind theme - never "
    "hardcode hex values."
)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # Malformed or empty stdin — never block a prompt on a broken hook.
        return 0

    prompt = payload.get("prompt", "") or ""
    if DESIGN_KEYWORDS.search(prompt):
        print(REMINDER)
    return 0


if __name__ == "__main__":
    sys.exit(main())

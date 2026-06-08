"""Shell command parser for dashclaw-agent-intel.

Extracts structured metadata from shell command strings:
base command, subcommands, flags, targets, wrappers, pipes,
redirections, and chained commands.

Uses only the Python standard library.
"""

import shlex
from typing import Optional

# Commands whose first positional argument is a subcommand.
SUBCOMMAND_TOOLS = frozenset({
    "git", "docker", "kubectl", "npm", "yarn", "pip",
    "cargo", "go", "apt", "brew", "systemctl",
})

# Wrappers that prefix the real command.
WRAPPERS = frozenset({
    "sudo", "env", "nohup", "nice", "ionice",
    "strace", "time", "timeout",
})

# Redirection operators, ordered longest-first so we greedily match.
_REDIR_OPS = ("&>>", "&>", "2>>", "2>", ">>", ">")


def _split_on_unquoted(command_str: str, delimiters: list[str]) -> list[tuple[str, str]]:
    """Split *command_str* on unquoted *delimiters*.

    Returns a list of (segment_text, delimiter_used) tuples.
    The last segment's delimiter is always the empty string.
    """
    segments: list[tuple[str, str]] = []
    in_single = False
    in_double = False
    buf: list[str] = []
    i = 0
    while i < len(command_str):
        ch = command_str[i]

        # Track quoting state.
        if ch == "'" and not in_double:
            in_single = not in_single
            buf.append(ch)
            i += 1
            continue
        if ch == '"' and not in_single:
            in_double = not in_double
            buf.append(ch)
            i += 1
            continue

        if not in_single and not in_double:
            # Try each delimiter (longest-first is important when
            # delimiters share prefixes, but our callers sort that).
            matched = False
            for delim in delimiters:
                if command_str[i:i + len(delim)] == delim:
                    segments.append(("".join(buf), delim))
                    buf = []
                    i += len(delim)
                    matched = True
                    break
            if matched:
                continue

        buf.append(ch)
        i += 1

    segments.append(("".join(buf), ""))
    return segments


def _tokenize(segment: str) -> list[str]:
    """Tokenize a shell segment using shlex, falling back on split."""
    segment = segment.strip()
    if not segment:
        return []
    try:
        return shlex.split(segment)
    except ValueError:
        # Unbalanced quotes, etc. -- best-effort.
        return segment.split()


def _extract_redirections(tokens: list[str]) -> tuple[list[str], list[dict]]:
    """Separate redirection operators and their targets from *tokens*.

    Returns (remaining_tokens, redirections).
    """
    remaining: list[str] = []
    redirections: list[dict] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        matched_op: Optional[str] = None

        # Check if the token *is* a redirection operator.
        for op in _REDIR_OPS:
            if tok == op:
                matched_op = op
                break

        # Check if the token *starts with* a redirection operator
        # (e.g. ">output.txt" as one token).
        if matched_op is None:
            for op in _REDIR_OPS:
                if tok.startswith(op) and len(tok) > len(op):
                    redirections.append({"type": op, "target": tok[len(op):]})
                    i += 1
                    break
            else:
                if matched_op is None:
                    remaining.append(tok)
                i += 1
            continue

        # The operator is a standalone token.  Next token is the target.
        if i + 1 < len(tokens):
            redirections.append({"type": matched_op, "target": tokens[i + 1]})
            i += 2
        else:
            # Dangling operator -- keep it as-is.
            remaining.append(tok)
            i += 1

    return remaining, redirections


def _skip_wrapper_args(wrapper: str, tokens: list[str]) -> list[str]:
    """Consume flag-like arguments that belong to the *wrapper*, returning
    the remaining tokens that represent the wrapped command.

    Each wrapper has slightly different syntax, so we use simple heuristics:
    - ``sudo``: skip flags (starting with ``-``) until a non-flag token.
    - ``env``: skip ``KEY=VAL`` pairs and flags until a non-flag,
      non-assignment token.
    - ``nice`` / ``ionice``: skip ``-<flag> <value>`` pairs.
    - ``timeout``: skip flags then skip the duration argument.
    - ``nohup`` / ``time`` / ``strace``: skip flags.
    """
    i = 0
    if wrapper == "env":
        while i < len(tokens):
            if tokens[i].startswith("-") or "=" in tokens[i]:
                i += 1
            else:
                break
    elif wrapper in ("nice", "ionice"):
        while i < len(tokens) and tokens[i].startswith("-"):
            i += 1
            # Skip the value that follows the flag (e.g. -n 10, -c 2).
            if i < len(tokens) and not tokens[i].startswith("-"):
                i += 1
    elif wrapper == "timeout":
        # Skip flags, then skip the duration positional.
        while i < len(tokens) and tokens[i].startswith("-"):
            i += 1
        if i < len(tokens):
            # The next token is the duration.
            i += 1
    elif wrapper == "strace":
        while i < len(tokens) and tokens[i].startswith("-"):
            i += 1
    elif wrapper == "sudo":
        while i < len(tokens) and tokens[i].startswith("-"):
            i += 1
    elif wrapper in ("nohup", "time"):
        while i < len(tokens) and tokens[i].startswith("-"):
            i += 1
    return tokens[i:]


def _parse_segment(tokens: list[str]) -> dict:
    """Parse a list of tokens into the structured result dict.

    This handles one logical command (no pipes, no chains).
    """
    result: dict = {
        "base_command": "",
        "subcommand": None,
        "flags": [],
        "targets": [],
        "wrapper": None,
        "pipes": [],
        "redirections": [],
        "chains": [],
    }

    if not tokens:
        return result

    # Strip redirections first.
    tokens, redirections = _extract_redirections(tokens)
    result["redirections"] = redirections

    if not tokens:
        return result

    # Detect wrapper.
    idx = 0
    if tokens[idx] in WRAPPERS:
        result["wrapper"] = tokens[idx]
        remaining = _skip_wrapper_args(tokens[idx], tokens[idx + 1:])
        tokens = remaining
        if not tokens:
            return result
        idx = 0

    # Base command.
    result["base_command"] = tokens[idx]
    rest = tokens[idx + 1:]

    # Detect subcommand.
    if result["base_command"] in SUBCOMMAND_TOOLS and rest:
        first_rest = rest[0]
        if not first_rest.startswith("-"):
            result["subcommand"] = first_rest
            rest = rest[1:]

    # Classify remaining tokens as flags or targets.
    for tok in rest:
        if tok.startswith("-"):
            result["flags"].append(tok)
        else:
            result["targets"].append(tok)

    return result


def parse_command(command_str: str) -> dict:
    """Parse a shell command string into structured metadata.

    Returns a dict with the following keys:
        base_command  (str)           – the primary executable
        subcommand    (str | None)    – e.g. "push" for "git push"
        flags         (list[str])     – tokens starting with "-"
        targets       (list[str])     – positional arguments
        wrapper       (str | None)    – sudo, env, nohup, etc.
        pipes         (list[dict])    – parsed segments for each pipe stage
        redirections  (list[dict])    – {"type": ">", "target": "file"}
        chains        (list[dict])    – parsed segments for && / ; chains
    """
    if not command_str or not command_str.strip():
        return {
            "base_command": "",
            "subcommand": None,
            "flags": [],
            "targets": [],
            "wrapper": None,
            "pipes": [],
            "redirections": [],
            "chains": [],
        }

    # --- 1. Split on chains (&&, ;) first. ---
    chain_segments = _split_on_unquoted(command_str, ["&&", ";"])
    chain_texts = [seg for seg, _delim in chain_segments]
    chain_texts = [t.strip() for t in chain_texts if t.strip()]

    if len(chain_texts) > 1:
        chains: list[dict] = []
        for ct in chain_texts:
            parsed = parse_command(ct)
            chains.append(parsed)

        # Top-level fields mirror the first chain segment.
        first = chains[0]
        return {
            "base_command": first["base_command"],
            "subcommand": first["subcommand"],
            "flags": first["flags"],
            "targets": first["targets"],
            "wrapper": first["wrapper"],
            "pipes": first["pipes"],
            "redirections": first["redirections"],
            "chains": chains,
        }

    # --- 2. Split on pipes (|) ---
    pipe_segments = _split_on_unquoted(command_str, ["|"])
    pipe_texts = [seg for seg, _delim in pipe_segments]
    pipe_texts = [t.strip() for t in pipe_texts if t.strip()]

    if len(pipe_texts) > 1:
        pipes: list[dict] = []
        for pt in pipe_texts:
            tokens = _tokenize(pt)
            parsed = _parse_segment(tokens)
            pipes.append(parsed)

        first = pipes[0]
        return {
            "base_command": first["base_command"],
            "subcommand": first["subcommand"],
            "flags": first["flags"],
            "targets": first["targets"],
            "wrapper": first["wrapper"],
            "pipes": pipes,
            "redirections": first["redirections"],
            "chains": [],
        }

    # --- 3. Single command ---
    tokens = _tokenize(command_str)
    result = _parse_segment(tokens)
    result["pipes"] = []
    result["chains"] = []
    return result

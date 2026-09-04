"""Written-paths ledger — script-then-execute composition detection (spec
docs/plans/2026-08-06-script-then-execute-spec.md).

PostToolUse records paths this session wrote; PreToolUse looks up the path a
Bash/PowerShell call is about to execute and, on a TTL-fresh hit, grades the
script's CONTENT with the same classifiers that grade inline commands. The
composition signal itself never escalates risk (F5 lesson): it only routes a
content grade onto executes that would otherwise never get one.

State is a per-session JSON temp file, instance-suffixed like the containment
session state, holding path + timestamp only — content is read from disk at
execute time so the grade covers the bytes that will actually run. All I/O is
fail-soft: a corrupt or unwritable ledger degrades to pre-spec behavior.
"""

import json
import ntpath
import os
import posixpath
import re
import sys
import tempfile
import time

from .bash_classifier import (
    _INLINE_ESCAPE_HATCH_RE,
    _RAW_DEVICE_WRITE_RE,
    _SPEND_CLI_RE,
    _SPEND_GENERIC_URL_RE,
    _SPEND_URL_RE,
    classify_bash,
)

_SESSION_ID_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]")
_GIT_BASH_DRIVE_RE = re.compile(r"^/([a-zA-Z])(/|$)")

_MAX_ENTRIES = 500
_CONTENT_CAP_BYTES = 256 * 1024
_DEFAULT_TTL_MINUTES = 60

_SHELL_EXTS = {".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd"}
_INTERP_EXTS = {".py", ".js", ".mjs", ".cjs", ".ts", ".rb", ".pl"}

# Extensions that mark a token as an executable script even when the token
# carries no path separator — `cmd /c x.bat` and bare `x.cmd` execute a file
# the same as `./x.sh` does (MoltFire probe, 2026-08-06). Also the recovery
# hook for Windows forms the bash tokenizer mangled: `.\x.bat` reaches the
# parser as `.x.bat`, separators gone.
_SCRIPT_EXTS = _SHELL_EXTS | _INTERP_EXTS


def _has_script_ext(token):
    return os.path.splitext(token.lower())[1] in _SCRIPT_EXTS

# Interpreters whose first positional target is the script they execute, with
# the inline-eval flags that mean "no script file involved".
_EXEC_INTERPRETERS = {
    "bash": {"-c"},
    "sh": {"-c"},
    "zsh": {"-c"},
    "dash": {"-c"},
    "ksh": {"-c"},
    "python": {"-c", "-m"},
    "python2": {"-c", "-m"},
    "python3": {"-c", "-m"},
    "node": {"-e", "--eval", "-p", "--print"},
    "ruby": {"-e"},
    "perl": {"-e", "-E"},
}


def _ttl_seconds():
    raw = os.environ.get("DASHCLAW_SCRIPT_EXEC_TTL_MINUTES", "")
    try:
        minutes = float(raw)
        if minutes <= 0:
            raise ValueError
    except (TypeError, ValueError):
        minutes = _DEFAULT_TTL_MINUTES
    return minutes * 60


def _safe_session_id(session_id):
    return _SESSION_ID_SAFE_RE.sub("_", session_id or "")


def ledger_path(session_id, instance_suffix):
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_written_paths_"
        + (instance_suffix or "noinstance")
        + "_"
        + _safe_session_id(session_id)
        + ".json",
    )


def normalize_exec_path(path, cwd, platform=None):
    """Normalize a path so the write side and the execute side derive the same
    ledger key (spec §4): strip quotes, map Git Bash drive form, resolve
    relative against the hook cwd, normpath + best-effort realpath, casefold
    on win32. `platform` is overridable for deterministic cross-OS tests."""
    if platform is None:
        platform = sys.platform
    p = (path or "").strip().strip("\"'")
    if not p:
        return ""
    if platform == "win32":
        # Git Bash drive form: /c/Users/x -> C:\Users\x (the Write tool
        # records Windows form; Bash may execute the POSIX form).
        m = _GIT_BASH_DRIVE_RE.match(p)
        if m:
            p = m.group(1).upper() + ":\\" + p[m.end():].replace("/", "\\")
        p = p.replace("/", "\\")
        pathmod = ntpath
        c = (cwd or "").strip().strip("\"'").replace("/", "\\")
    else:
        pathmod = posixpath
        c = (cwd or "").strip().strip("\"'")
    if not pathmod.isabs(p) and c:
        p = pathmod.join(c, p)
    p = pathmod.normpath(p)
    # realpath resolves symlinks / 8.3 names — only meaningful on the OS we
    # are actually running on; forced-platform tests skip it.
    if platform == sys.platform:
        try:
            p = os.path.realpath(p)
        except (OSError, ValueError):
            pass
    if platform == "win32":
        p = p.casefold()
    return p


def _load_entries(path, now):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        entries = data.get("entries") or []
    except (OSError, ValueError):
        return []
    ttl = _ttl_seconds()
    fresh = []
    for e in entries:
        try:
            at = float(e["at"])
            key = str(e["path"])
        except (KeyError, TypeError, ValueError):
            continue
        if now - at <= ttl:
            fresh.append({"path": key, "at": at})
    return fresh


def record_written_paths(session_id, instance_suffix, paths, cwd, now=None):
    """Record normalized written paths in the session ledger. Fail-soft:
    never raises into the hook."""
    try:
        if now is None:
            now = time.time()
        keys = []
        for p in paths or []:
            k = normalize_exec_path(p, cwd)
            if k:
                keys.append(k)
        if not keys:
            return
        path = ledger_path(session_id, instance_suffix)
        entries = _load_entries(path, now)
        keyset = set(keys)
        entries = [e for e in entries if e["path"] not in keyset]
        for k in keys:
            entries.append({"path": k, "at": now})
        entries.sort(key=lambda e: e["at"])
        entries = entries[-_MAX_ENTRIES:]
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"entries": entries}, f)
    except Exception:
        pass


_SEPARATORS_RE = re.compile(r"[\\/]")


def lookup_written_path(session_id, instance_suffix, path, cwd, now=None):
    """Return the REAL recorded path when this session recorded a TTL-fresh
    write matching `path`, else None.

    Two match forms: the normalized key, and a separator-stripped alias — the
    bash tokenizer treats backslash as an escape character, so a Windows path
    in a command reaches the parser with its separators stripped
    (C:\\tmp\\x.sh -> C:tmpx.sh). Returning the real path lets the caller
    read the actual file for grading."""
    try:
        if now is None:
            now = time.time()
        entries = _load_entries(ledger_path(session_id, instance_suffix), now)
        if not entries:
            return None
        key = normalize_exec_path(path, cwd)
        if key:
            for e in entries:
                if e["path"] == key:
                    return e["path"]
        raw = (path or "").strip().strip("\"'")
        stripped = _SEPARATORS_RE.sub("", raw)
        if sys.platform == "win32":
            stripped = stripped.casefold()
        if stripped:
            for e in entries:
                if _SEPARATORS_RE.sub("", e["path"]) == stripped:
                    return e["path"]
        # Separator-less script names (`x.bat` after `cmd /c`, or `.\x.bat`
        # tokenizer-mangled to `.x.bat`) can't reconstruct their directory, so
        # match by recorded basename. Gated to script extensions to keep the
        # alias narrow (F5 lesson).
        if raw and not _SEPARATORS_RE.search(raw) and _has_script_ext(raw):
            name = raw.lstrip(".")
            if sys.platform == "win32":
                name = name.casefold()
            if name:
                for e in entries:
                    base = _SEPARATORS_RE.split(e["path"])[-1]
                    if base == name:
                        return e["path"]
        return None
    except Exception:
        return None


def is_recently_written(session_id, instance_suffix, path, cwd, now=None):
    """True when this session recorded a TTL-fresh write to `path`."""
    return lookup_written_path(session_id, instance_suffix, path, cwd, now=now) is not None


def delete_ledger(session_id, instance_suffix):
    """Session-end hygiene (Stop hook). Best-effort."""
    try:
        os.remove(ledger_path(session_id, instance_suffix))
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Execute-side extraction + content grading
# ---------------------------------------------------------------------------

def _looks_like_path(token):
    return "/" in token or "\\" in token


def _segment_candidates(seg):
    base = (seg.get("base_command") or "").strip()
    flags = [f for f in (seg.get("flags") or [])]
    targets = [t for t in (seg.get("targets") or []) if t]
    out = []

    # The program token itself, when it is a path (./x.sh, /tmp/x.sh, C:\x.ps1)
    # or a bare/mangled script name (x.cmd, .x.bat after backslash loss).
    if base and (_looks_like_path(base) or _has_script_ext(base)):
        out.append(base)

    base_name = base.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].lower()

    if base_name in ("source", "."):
        if targets:
            out.append(targets[0])
    elif base_name in ("pwsh", "powershell"):
        lowered = {f.lower() for f in flags}
        if "-file" in lowered and targets:
            out.append(targets[0])
    elif base_name == "cmd":
        # /c doesn't start with '-', so the parser leaves it in targets.
        lowered = [t.lower() for t in targets]
        if "/c" in lowered:
            idx = lowered.index("/c")
            if idx + 1 < len(targets):
                nxt = targets[idx + 1]
                if _looks_like_path(nxt) or _has_script_ext(nxt):
                    out.append(nxt)
    elif base_name in _EXEC_INTERPRETERS:
        eval_flags = _EXEC_INTERPRETERS[base_name]
        if not any(f in eval_flags for f in flags) and targets:
            out.append(targets[0])
    return out


def extract_exec_candidates(parsed):
    """Executed-path candidates from parse_command output, per chained/piped
    segment (spec §3.3 step 1). Raw strings — normalization happens at lookup."""
    segments = []
    chains = parsed.get("chains") or []
    if chains:
        segments.extend(chains)
    else:
        segments.append(parsed)
    # pipe stages of each segment (the top-level dict mirrors stage 1 only)
    for seg in list(segments):
        for stage in seg.get("pipes") or []:
            segments.append(stage)

    out = []
    seen = set()
    for seg in segments:
        for cand in _segment_candidates(seg):
            if cand not in seen:
                seen.add(cand)
                out.append(cand)
    return out


def _grade_shell_lines(content):
    risk = 0
    validations = []
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        graded = classify_bash(line)
        if graded["risk_score"] > risk:
            risk = graded["risk_score"]
            validations = graded["validations"]
    return risk, validations


def _grade_interpreter_content(content):
    risk = 0
    validations = []
    if _INLINE_ESCAPE_HATCH_RE.search(content):
        risk = 80
        validations.append({
            "check": "script_content_escape_hatch",
            "result": "warn",
            "reason": "script content spawns processes, deletes files, or shells out",
        })
    if _RAW_DEVICE_WRITE_RE.search(content):
        risk = 100
        validations.append({
            "check": "script_content_device_write",
            "result": "block",
            "reason": "script content writes to a raw block device",
        })
    return risk, validations


def grade_script_content(path, cap_bytes=_CONTENT_CAP_BYTES):
    """Grade a script file's content with the same calibration inline commands
    get (spec §3.3 step 3). Returns {readable, risk_score, validations};
    readable=False means missing/oversized/undecodable — the caller applies
    the review-band floor for that case."""
    try:
        if os.path.getsize(path) > cap_bytes:
            return {"readable": False, "risk_score": 0, "validations": []}
        with open(path, "rb") as f:
            raw = f.read(cap_bytes + 1)
        content = raw.decode("utf-8", errors="replace")
    except OSError:
        return {"readable": False, "risk_score": 0, "validations": []}

    ext = os.path.splitext(path)[1].lower()
    first_line = content.split("\n", 1)[0] if content else ""
    shebang_shell = first_line.startswith("#!") and (
        "sh" in first_line and "python" not in first_line
    )
    shebang_interp = first_line.startswith("#!") and any(
        name in first_line for name in ("python", "node", "ruby", "perl")
    )

    if ext in _SHELL_EXTS or (ext == "" and not shebang_interp) or shebang_shell:
        risk, validations = _grade_shell_lines(content)
    elif ext in _INTERP_EXTS or shebang_interp:
        risk, validations = _grade_interpreter_content(content)
    else:
        risk, validations = _grade_interpreter_content(content)

    # A script that names a purchase endpoint or CLI (2026-09-04 incident):
    # a `.mjs`/`.py` script's fetch() call to a registrar/billing endpoint is
    # invisible to _grade_interpreter_content's escape-hatch/device-write
    # checks, so check the raw content directly, independent of extension.
    if (
        _SPEND_URL_RE.search(content)
        or _SPEND_GENERIC_URL_RE.search(content)
        or _SPEND_CLI_RE.search(content)
    ):
        risk = max(risk, 75)
        validations.append({
            "check": "spend_endpoint",
            "result": "warn",
            "reason": "script names a purchase endpoint",
        })

    return {"readable": True, "risk_score": risk, "validations": validations}

#!/usr/bin/env python3
"""
DashClaw database containment (Neon) — the staging medium for the
`db_branch` containment basis.

See docs/rfcs/2026-09-04-database-containment.md. The file basis stages a
mutation in a git worktree; this module stages a Postgres mutation on an
ephemeral Neon branch of the same database, so the operator reviews the
statement, the schema diff and the output once and Promote replays the
ORIGINAL command against production.

Imported by dashclaw_pretool.py (detect + branch + rewrite) and
dashclaw_posttool.py (schema diff + credential scrub). Stdlib only, like
every hook script here.

SECRET DISCIPLINE: this module is the only place a production connection URL
is ever read. It is never logged, never sent to DashClaw, and never written
to session state — only the branch HOST and the Neon ids are persisted, and
every string that leaves the machine goes through scrub_db_credentials()
first. Callers must keep that property: log the host, never the URL.
"""

import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# Quoting-aware segmentation, shared with the classifier so the hook's notion
# of "this segment runs psql" matches the one the server grades on.
from dashclaw_agent_intel.command_parser import parse_command, split_chain_texts

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

# Neon's control-plane API. Overridable ONLY so the hook test suite can point
# the client at a local mock: these requests carry the operator's NEON_API_KEY
# as a Bearer token, so a production installation must never set this.
NEON_API_BASE_DEFAULT = "https://console.neon.tech/api/v2"
_DEFAULT_TTL_HOURS = 72
_HTTP_TIMEOUT = 10
# A Neon account with many projects must not stall PreToolUse: the endpoint
# probe walks at most this many pages of 100 before giving up (set
# NEON_PROJECT_ID to skip the walk entirely).
_MAX_PROJECT_PAGES = 10


def db_containment_enabled():
    """DB containment kill switch, independent of DASHCLAW_CONTAINMENT (which
    covers both media). Read per call, not at import: the hook processes one
    tool call per process, and tests drive this through the environment."""
    return (os.environ.get("DASHCLAW_DB_CONTAINMENT") or "1") != "0"


def neon_api_key():
    return os.environ.get("NEON_API_KEY") or ""


def neon_api_base():
    return (os.environ.get("DASHCLAW_NEON_API_BASE") or NEON_API_BASE_DEFAULT).rstrip("/")


def ttl_hours():
    raw = os.environ.get("DASHCLAW_DB_CONTAINMENT_TTL_HOURS")
    try:
        return max(1, int(raw)) if raw else _DEFAULT_TTL_HOURS
    except (TypeError, ValueError):
        return _DEFAULT_TTL_HOURS


def utc_now_iso():
    """RFC3339 timestamp, the format Neon's API speaks."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def expires_at_iso(now=None):
    """RFC3339 expiry Neon self-deletes the branch at. Expiry IS the cleanup
    story (RFC): a session that never finishes leaves nothing behind."""
    base = now or datetime.now(timezone.utc)
    return (base + timedelta(hours=ttl_hours())).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Detection: is this command talking to a Postgres database, and which one?
# ---------------------------------------------------------------------------

_PG_URL_RE = re.compile(r"postgres(?:ql)?://[^\s'\"<>`]+", re.IGNORECASE)

# Postgres clients whose mere presence in the command slot makes the segment a
# database act (RFC "Evidence classifier"). Mirrors the server's classifyShell
# list — a hook classifier that diverges from the server's is worse than a
# shared over-tag, since the server does the real grading.
_DB_BARE_CLIENTS = frozenset({"psql", "pg_restore"})
_PRISMA_DB_SUBCOMMANDS = frozenset({
    ("db", "push"), ("db", "execute"),
    ("migrate", "deploy"), ("migrate", "dev"), ("migrate", "reset"),
})
_DRIZZLE_DB_SUBCOMMANDS = frozenset({"push", "migrate", "drop"})
# `npx prisma …` / `pnpm dlx drizzle-kit …` are the way these tools are
# actually invoked; the runner is not the act.
_RUNNERS = frozenset({"npx", "pnpm", "yarn", "bunx", "bun", "npm"})
_RUNNER_PASSTHROUGH = frozenset({"dlx", "exec", "run"})


def _basename(token):
    token = (token or "").replace("\\", "/").rsplit("/", 1)[-1]
    if token.lower().endswith(".exe"):
        token = token[:-4]
    return token.lower()


def _segment_words(parsed):
    """Non-flag words of one parsed segment, in order, with runner prefixes
    dropped.

    parse_command already strips leading KEY=VALUE assignments, wrappers
    (sudo/env/timeout/…) and redirections, and it tokenizes quote-aware — so a
    `git commit -m "fix the psql thing"` never surfaces `psql` in the command
    slot."""
    base = parsed.get("base_command") or ""
    if not base:
        return []
    words = [base]
    if parsed.get("subcommand"):
        words.append(parsed["subcommand"])
    words.extend(parsed.get("targets") or [])
    words = [_basename(w) for w in words]
    while words and words[0] in _RUNNERS:
        words.pop(0)
        while words and words[0] in _RUNNER_PASSTHROUGH:
            words.pop(0)
    return words


def _segments(command):
    """Every sequential AND piped segment of the command, parsed. `psql` in
    the second stage of a pipe is still a database act."""
    segments = []
    for chain_text in split_chain_texts(command or ""):
        parsed = parse_command(chain_text)
        pipes = parsed.get("pipes") or []
        segments.extend(pipes if pipes else [parsed])
    return segments


def is_db_command(command):
    """True when this Bash command targets a Postgres database.

    Used ONLY to decide whether to advertise `allow_contained:db` and, later,
    to rewrite the command — the risk grading stays server-side. Over-tagging
    is therefore cheap (the server still decides); under-tagging silently
    removes the feature, which is why the URL-literal arm is deliberately
    broad."""
    if not command:
        return False
    if _PG_URL_RE.search(command):
        return True
    for parsed in _segments(command):
        words = _segment_words(parsed)
        if not words:
            continue
        head = words[0]
        rest = words[1:]
        if head in _DB_BARE_CLIENTS:
            return True
        if head == "prisma" and len(rest) >= 2 and (rest[0], rest[1]) in _PRISMA_DB_SUBCOMMANDS:
            return True
        if head == "drizzle-kit" and rest and rest[0].split(":")[0] in _DRIZZLE_DB_SUBCOMMANDS:
            return True
    return False


def has_pg_url_literal(command):
    """True when the command text itself carries a postgres(ql):// literal.

    Used by the pretool gate to EXCLUDE such commands from database
    containment: the ledger's sensitive-data scan redacts a connection string
    inside a recorded act, and promotion replays the recorded act byte-for-
    byte, so a literal-carrying command could be staged and then never
    replayed (the CLI refuses a redaction marker). Those commands stay on the
    approval rail. The detector and the rewrite below still handle literals —
    the module stays general for any future caller that records differently."""
    return bool(command) and bool(_PG_URL_RE.search(command))


def _read_database_url_from_env_file(path):
    """DATABASE_URL out of a dotenv file — that ONE key, nothing else, and it
    never leaves this process except as the branch URL handed to the rewritten
    command."""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                if key.strip() != "DATABASE_URL":
                    continue
                # Trailing comment BEFORE the quotes (the reverse of the hooks'
                # generic _apply_env_line): a quoted `DATABASE_URL='…'  # note`
                # otherwise keeps its closing quote and never parses as a URL.
                val = val.strip()
                if " #" in val:
                    val = val[:val.index(" #")].strip()
                val = val.strip('"').strip("'")
                if val:
                    return val
    except Exception:
        return None
    return None


def _split_netloc(url):
    """(userinfo, host, port) for a postgres URL's authority, or None.

    Hand-split rather than urlsplit().hostname because a password with a `%`
    or a non-ASCII byte makes urlsplit's re-assembly lossy, and this URL must
    round-trip byte-for-byte apart from the host."""
    match = re.match(r"^(postgres(?:ql)?://)(.*)$", url or "", re.IGNORECASE)
    if not match:
        return None
    rest = match.group(2)
    authority = re.split(r"[/?#]", rest, 1)[0]
    userinfo, sep, hostport = authority.rpartition("@")
    if not sep:
        userinfo, hostport = "", authority
    host, colon, port = hostport.rpartition(":")
    if not colon or not port.isdigit():
        host, port = hostport, ""
    return userinfo, host, port


def _host_of(url):
    parts = _split_netloc(url)
    return parts[1] if parts else ""


def endpoint_id(url):
    """Neon endpoint id = the host up to the first dot (`ep-…`), or None when
    the URL is not a Neon endpoint."""
    host = _host_of(url)
    if not host.lower().endswith(".neon.tech"):
        return None
    candidate = host.split(".", 1)[0]
    return candidate if candidate.startswith("ep-") else None


def database_name(url):
    """The database component of a Postgres URL (`…/neondb?sslmode=require`
    -> `neondb`), or None. Neon's compare_schema needs it."""
    match = re.match(r"^postgres(?:ql)?://[^/]*/([^?#]*)", url or "", re.IGNORECASE)
    if not match:
        return None
    name = urllib.parse.unquote(match.group(1))
    return name or None


def detect_db_target(command, workspace):
    """The PRODUCTION connection URL this command addresses, or None.

    Resolution order (RFC "Target resolution"): a postgres(ql):// literal in
    the command, then DATABASE_URL in the environment, then DATABASE_URL from
    <workspace>/.env.local, then <workspace>/.env. None when nothing resolves
    or the host is not a Neon endpoint — the caller then simply doesn't
    advertise `allow_contained:db` and the verdict lands as require_approval,
    today's behavior.

    NEVER log or transmit the return value."""
    literal = _PG_URL_RE.search(command or "")
    candidates = []
    if literal:
        candidates.append(literal.group(0).rstrip("'\";,"))
    env_url = os.environ.get("DATABASE_URL")
    if env_url:
        candidates.append(env_url)
    if workspace:
        for fname in (".env.local", ".env"):
            file_url = _read_database_url_from_env_file(os.path.join(workspace, fname))
            if file_url:
                candidates.append(file_url)
    for url in candidates:
        if endpoint_id(url):
            return url
    return None


# ---------------------------------------------------------------------------
# Rewrite + scrub
# ---------------------------------------------------------------------------

def branch_url(prod_url, branch_host):
    """The production URL with ONLY the host replaced. Neon child branches
    inherit the parent's roles and passwords, so user, password, port, database
    and query string all stay exactly as they were."""
    parts = _split_netloc(prod_url)
    if not parts or not branch_host:
        return prod_url
    userinfo, host, port = parts
    old_authority = (userinfo + "@" if userinfo else "") + host + (":" + port if port else "")
    new_authority = (userinfo + "@" if userinfo else "") + branch_host + (":" + port if port else "")
    return prod_url.replace(old_authority, new_authority, 1)


def _single_quote(value):
    """POSIX single-quoting: everything inside '' is literal, and an embedded
    quote is closed, escaped and reopened. Always quotes (never bare) so the
    emitted prefix is stable regardless of what the URL contains."""
    return "'" + str(value).replace("'", "'\"'\"'") + "'"


def rewrite_command(command, prod_url, contained_url, branch_host):
    """The command as it will run against the contained branch.

    Two arms (RFC "Branch lifecycle"): a command carrying the production URL
    literal gets every occurrence replaced; anything else is prefixed with the
    branch's DATABASE_URL/PGHOST so a client reading either env var connects
    to the branch instead of production."""
    if prod_url and prod_url in command:
        return command.replace(prod_url, contained_url)
    return ("DATABASE_URL=" + _single_quote(contained_url)
            + " PGHOST=" + _single_quote(branch_host) + " " + command)


_PG_URL_PASSWORD_RE = re.compile(
    r"(postgres(?:ql)?://[^\s:/@'\"]+:)([^@\s'\"]*)(@)", re.IGNORECASE
)


def scrub_db_credentials(text):
    """Redact the password of any postgres(ql)://user:pass@host URL.

    Applied to everything that leaves the machine (artifact content, logs).
    The rewritten statement an operator reviews still shows the user, host and
    database, which is what makes it reviewable, but never the secret."""
    if not text:
        return text
    return _PG_URL_PASSWORD_RE.sub(lambda m: m.group(1) + "[REDACTED]" + m.group(3), text)


# ---------------------------------------------------------------------------
# Session state
#
# Same tempdir + instance-suffix scheme as the containment worktree state in
# dashclaw_pretool.py (a co-installed hook instance must never read this one's
# branch), but a DISTINCT file name: a session can have both a worktree and a
# db branch, and neither may clobber the other.
# ---------------------------------------------------------------------------

_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9_.-]")

_STATE_FIELDS = (
    "ref", "project_id", "parent_branch_id", "branch_id", "host", "db_name",
    "endpoint_id", "created_at", "expires_at",
)


def _safe_session_id(session_id):
    # Session ids come from untrusted stdin; mirrors dashclaw_pretool.py's own
    # sanitizer so a crafted id cannot escape the tempdir.
    if not session_id:
        return ""
    return _SESSION_ID_RE.sub("_", session_id)


def session_state_path(session_id, instance_suffix):
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_db_containment_session_" + instance_suffix + "_" + _safe_session_id(session_id) + ".json",
    )


def read_session_state(session_id, instance_suffix):
    """The branch this session already created, or None. Never raises."""
    try:
        with open(session_state_path(session_id, instance_suffix), encoding="utf-8") as f:
            data = json.loads(f.read())
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("branch_id") or not data.get("host"):
        return None
    return data


def write_session_state(session_id, instance_suffix, state):
    """Best-effort persist so the rest of the session reuses this branch
    instead of creating a second one. Contains ids and the branch HOST only —
    never a connection URL."""
    payload = {field: state.get(field) for field in _STATE_FIELDS}
    try:
        with open(session_state_path(session_id, instance_suffix), "w", encoding="utf-8") as f:
            f.write(json.dumps(payload))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Neon control-plane client
# ---------------------------------------------------------------------------

class NeonClient:
    """Minimal Neon API client on urllib.

    Never raises: every method returns None on any failure (no key, HTTP
    error, timeout, malformed body). Callers decide what a None means —
    PreToolUse fails toward interruption, PostToolUse records the evidence it
    does have."""

    def __init__(self, api_key=None, base=None, timeout=_HTTP_TIMEOUT):
        self.api_key = api_key if api_key is not None else neon_api_key()
        self.base = (base or neon_api_base()).rstrip("/")
        self.timeout = timeout

    def _request(self, method, path, body=None):
        if not self.api_key:
            return None
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self.base + path,
            data=data,
            headers={
                "Authorization": "Bearer " + self.api_key,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
        except Exception:
            # Includes urllib.error.HTTPError (a 404 from the endpoint probe is
            # the normal "wrong project" answer, not an error worth raising).
            return None
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return {"_raw": raw}

    # -- project / endpoint resolution ------------------------------------

    def resolve_project(self, endpoint_id_value):
        """The project id owning this endpoint, or None.

        NEON_PROJECT_ID short-circuits the walk (one API call instead of N);
        otherwise every project is probed with GET
        /projects/{id}/endpoints/{endpoint_id} until one answers."""
        if not endpoint_id_value:
            return None
        configured = os.environ.get("NEON_PROJECT_ID")
        if configured:
            return configured
        cursor = None
        for _ in range(_MAX_PROJECT_PAGES):
            query = "?limit=100" + ("&cursor=" + urllib.parse.quote(cursor) if cursor else "")
            page = self._request("GET", "/projects" + query)
            projects = (page or {}).get("projects") or []
            if not projects:
                return None
            for project in projects:
                project_id = project.get("id")
                if project_id and self.get_endpoint(project_id, endpoint_id_value):
                    return project_id
            cursor = (page or {}).get("pagination", {}).get("cursor") or projects[-1].get("id")
            if not cursor:
                return None
        return None

    def get_endpoint(self, project_id, endpoint_id_value):
        """The endpoint object, or None when this project doesn't own it."""
        resp = self._request(
            "GET",
            "/projects/" + urllib.parse.quote(str(project_id))
            + "/endpoints/" + urllib.parse.quote(str(endpoint_id_value)),
        )
        endpoint = (resp or {}).get("endpoint")
        return endpoint if isinstance(endpoint, dict) else None

    def endpoint_branch_id(self, project_id, endpoint_id_value):
        """The branch the endpoint serves — the parent of the contained
        branch."""
        endpoint = self.get_endpoint(project_id, endpoint_id_value)
        return (endpoint or {}).get("branch_id")

    # -- branch lifecycle --------------------------------------------------

    def create_branch(self, project_id, parent_id, name, expires_at):
        """Create the contained branch and its read_write endpoint. Returns
        (branch_id, host) or None.

        A read_write endpoint is required, not optional: the contained command
        must be able to WRITE to the branch — that is the whole point."""
        body = {
            "branch": {"parent_id": parent_id, "name": name, "expires_at": expires_at},
            "endpoints": [{"type": "read_write"}],
        }
        resp = self._request(
            "POST", "/projects/" + urllib.parse.quote(str(project_id)) + "/branches", body
        )
        if not resp:
            return None
        branch_id = (resp.get("branch") or {}).get("id")
        endpoints = resp.get("endpoints") or []
        host = endpoints[0].get("host") if endpoints and isinstance(endpoints[0], dict) else None
        if not branch_id or not host:
            return None
        return branch_id, host

    def compare_schema(self, project_id, branch_id, base_branch_id, db_name):
        """The schema diff between the contained branch and its parent, or
        None when Neon could not answer. An EMPTY string is a legitimate
        result (data-only change) and is not None."""
        query = "?base_branch_id=" + urllib.parse.quote(str(base_branch_id or ""))
        if db_name:
            query += "&db_name=" + urllib.parse.quote(str(db_name))
        resp = self._request(
            "GET",
            "/projects/" + urllib.parse.quote(str(project_id))
            + "/branches/" + urllib.parse.quote(str(branch_id)) + "/compare_schema" + query,
        )
        if resp is None:
            return None
        if isinstance(resp, dict):
            return resp.get("diff") or resp.get("_raw") or ""
        return str(resp)

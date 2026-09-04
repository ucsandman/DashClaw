"""Unit tests for dashclaw_db_containment.py — the db_branch staging medium
(RFC 2026-09-04): target detection, the database-command classifier, the
command rewrite, the credential scrub, and the Neon client.

Every Neon call is mocked at urllib.request.urlopen — this suite never opens a
socket. Environment is pinned per test (DATABASE_URL / NEON_* / PGHOST are
explicitly removed) so a developer with a real Neon key exported gets the same
result CI does.

Uses only the Python standard library.
"""

import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _HOOKS_DIR not in sys.path:
    sys.path.insert(0, _HOOKS_DIR)

import dashclaw_db_containment as dbc  # noqa: E402

_PROD_URL = "postgresql://neondb_owner:npg_s3cret@ep-cool-frost-12345.us-east-2.aws.neon.tech/neondb?sslmode=require"
_BRANCH_HOST = "ep-quiet-leaf-98765.us-east-2.aws.neon.tech"

# Every env key that can change an answer here. Cleared per test.
_ENV_KEYS = (
    "DATABASE_URL", "PGHOST", "NEON_API_KEY", "NEON_PROJECT_ID",
    "DASHCLAW_DB_CONTAINMENT", "DASHCLAW_DB_CONTAINMENT_TTL_HOURS",
    "DASHCLAW_NEON_API_BASE",
)


class _EnvIsolated(unittest.TestCase):
    def setUp(self):
        self._env_patch = mock.patch.dict(os.environ, {}, clear=False)
        self._env_patch.start()
        for key in _ENV_KEYS:
            os.environ.pop(key, None)

    def tearDown(self):
        self._env_patch.stop()


# ---------------------------------------------------------------------------
# is_db_command — capability advertisement + rewrite only; the SERVER grades
# ---------------------------------------------------------------------------

class TestIsDbCommand(_EnvIsolated):
    def test_psql_variants(self):
        self.assertTrue(dbc.is_db_command('psql -c "drop table users"'))
        self.assertTrue(dbc.is_db_command("psql -f migrate.sql"))
        self.assertTrue(dbc.is_db_command("pg_restore -d mydb dump.bin"))

    def test_migration_tools_including_runner_prefixes(self):
        self.assertTrue(dbc.is_db_command("npx prisma migrate deploy"))
        self.assertTrue(dbc.is_db_command("prisma db push"))
        self.assertTrue(dbc.is_db_command("pnpm dlx drizzle-kit push"))
        self.assertTrue(dbc.is_db_command("drizzle-kit migrate"))

    def test_url_literal_anywhere_counts(self):
        self.assertTrue(dbc.is_db_command("pg_dump postgres://u:p@host/db > out.sql"))

    def test_later_chain_and_pipe_segments_count(self):
        self.assertTrue(dbc.is_db_command("cd /app && psql -c 'select 1'"))
        self.assertTrue(dbc.is_db_command("cat seed.sql | psql"))

    def test_plain_commands_are_not_db_commands(self):
        self.assertFalse(dbc.is_db_command("ls"))
        self.assertFalse(dbc.is_db_command("npm run build"))
        self.assertFalse(dbc.is_db_command(""))

    def test_a_commit_message_mentioning_psql_is_not_a_db_command(self):
        # The command SLOT is what matters — quoted prose never promotes a
        # `git commit` into a database act.
        self.assertFalse(dbc.is_db_command('git commit -m "fix psql connection retry"'))

    def test_prisma_read_only_subcommands_are_not_db_commands(self):
        self.assertFalse(dbc.is_db_command("npx prisma generate"))


# ---------------------------------------------------------------------------
# detect_db_target — literal > env > .env.local > .env, Neon hosts only
# ---------------------------------------------------------------------------

class TestDetectDbTarget(_EnvIsolated):
    def test_url_literal_in_the_command_wins(self):
        os.environ["DATABASE_URL"] = "postgresql://u:p@ep-other-1.us-east-2.aws.neon.tech/db"
        self.assertEqual(dbc.detect_db_target("psql " + _PROD_URL, None), _PROD_URL)

    def test_environment_database_url(self):
        os.environ["DATABASE_URL"] = _PROD_URL
        self.assertEqual(dbc.detect_db_target('psql -c "select 1"', None), _PROD_URL)

    def test_env_local_then_env_from_the_workspace(self):
        with tempfile.TemporaryDirectory() as workspace:
            with open(os.path.join(workspace, ".env"), "w", encoding="utf-8") as f:
                f.write("DATABASE_URL=postgresql://u:p@ep-plain-env.us-east-2.aws.neon.tech/db\n")
            self.assertEqual(
                dbc.detect_db_target('psql -c "select 1"', workspace),
                "postgresql://u:p@ep-plain-env.us-east-2.aws.neon.tech/db",
            )
            # .env.local takes precedence when both exist.
            with open(os.path.join(workspace, ".env.local"), "w", encoding="utf-8") as f:
                f.write("OTHER=1\nDATABASE_URL='" + _PROD_URL + "'  # the real one\n")
            self.assertEqual(dbc.detect_db_target('psql -c "select 1"', workspace), _PROD_URL)

    def test_non_neon_host_resolves_to_none(self):
        os.environ["DATABASE_URL"] = "postgresql://u:p@db.internal.example.com:5432/app"
        self.assertIsNone(dbc.detect_db_target('psql -c "select 1"', None))

    def test_neon_host_without_an_endpoint_id_resolves_to_none(self):
        os.environ["DATABASE_URL"] = "postgresql://u:p@console.neon.tech/db"
        self.assertIsNone(dbc.detect_db_target('psql -c "select 1"', None))

    def test_nothing_configured_resolves_to_none(self):
        with tempfile.TemporaryDirectory() as workspace:
            self.assertIsNone(dbc.detect_db_target('psql -c "select 1"', workspace))


# ---------------------------------------------------------------------------
# URL surgery: only the host changes; only the password is redacted
# ---------------------------------------------------------------------------

class TestUrlHelpers(_EnvIsolated):
    def test_branch_url_replaces_only_the_host(self):
        self.assertEqual(
            dbc.branch_url(_PROD_URL, _BRANCH_HOST),
            "postgresql://neondb_owner:npg_s3cret@" + _BRANCH_HOST + "/neondb?sslmode=require",
        )

    def test_branch_url_keeps_the_port_and_an_escaped_password(self):
        url = "postgres://user:p%40ss%3A1@ep-a.us-east-2.aws.neon.tech:5432/db"
        self.assertEqual(
            dbc.branch_url(url, _BRANCH_HOST),
            "postgres://user:p%40ss%3A1@" + _BRANCH_HOST + ":5432/db",
        )

    def test_endpoint_id_and_database_name(self):
        self.assertEqual(dbc.endpoint_id(_PROD_URL), "ep-cool-frost-12345")
        self.assertEqual(dbc.database_name(_PROD_URL), "neondb")
        self.assertIsNone(dbc.endpoint_id("postgresql://u:p@localhost/db"))

    def test_scrub_db_credentials_redacts_only_the_password(self):
        scrubbed = dbc.scrub_db_credentials("psql " + _PROD_URL + " -c 'select 1'")
        self.assertNotIn("npg_s3cret", scrubbed)
        self.assertIn("neondb_owner:[REDACTED]@ep-cool-frost-12345", scrubbed)
        self.assertIn("sslmode=require", scrubbed)

    def test_scrub_db_credentials_handles_several_urls_and_no_url(self):
        text = "from " + _PROD_URL + " to postgres://u:hunter2@ep-b.neon.tech/db"
        scrubbed = dbc.scrub_db_credentials(text)
        self.assertNotIn("npg_s3cret", scrubbed)
        self.assertNotIn("hunter2", scrubbed)
        self.assertEqual(dbc.scrub_db_credentials("nothing to redact"), "nothing to redact")


# ---------------------------------------------------------------------------
# rewrite_command — literal replacement, else an env prefix
# ---------------------------------------------------------------------------

class TestRewriteCommand(_EnvIsolated):
    def test_literal_url_is_replaced_everywhere(self):
        contained = dbc.branch_url(_PROD_URL, _BRANCH_HOST)
        command = "psql " + _PROD_URL + " -c 'select 1' && psql " + _PROD_URL + " -c 'select 2'"
        rewritten = dbc.rewrite_command(command, _PROD_URL, contained, _BRANCH_HOST)
        self.assertNotIn("ep-cool-frost-12345", rewritten)
        self.assertEqual(rewritten.count(_BRANCH_HOST), 2)

    def test_env_prefix_when_the_command_carries_no_url(self):
        contained = dbc.branch_url(_PROD_URL, _BRANCH_HOST)
        rewritten = dbc.rewrite_command("npx prisma migrate deploy", _PROD_URL, contained, _BRANCH_HOST)
        self.assertEqual(
            rewritten,
            "DATABASE_URL='" + contained + "' PGHOST='" + _BRANCH_HOST + "' npx prisma migrate deploy",
        )

    def test_env_prefix_single_quotes_a_url_with_shell_metacharacters(self):
        nasty = "postgresql://u:it's$(x)`y`@" + _BRANCH_HOST + "/db?a=1&b=2"
        rewritten = dbc.rewrite_command("psql", _PROD_URL, nasty, _BRANCH_HOST)
        # A literal single quote is closed, escaped and reopened, so the shell
        # sees exactly the URL and never runs $(x) or `y`.
        self.assertIn("""DATABASE_URL='postgresql://u:it'"'"'s$(x)`y`@""", rewritten)
        self.assertTrue(rewritten.endswith(" psql"))


# ---------------------------------------------------------------------------
# Neon client — urllib mocked, never a socket
# ---------------------------------------------------------------------------

class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def _json_response(payload):
    return _FakeResponse(json.dumps(payload).encode("utf-8"))


class _UrlopenRecorder:
    """Answers urlopen from a {path_prefix: payload} routing table and records
    every Request it saw. Anything unrouted raises, mirroring a 404."""

    def __init__(self, routes):
        self.routes = routes
        self.requests = []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        for prefix, payload in self.routes.items():
            if req.full_url.startswith(prefix):
                return _json_response(payload)
        raise urllib_error_404(req.full_url)


def urllib_error_404(url):
    import urllib.error
    return urllib.error.HTTPError(url, 404, "Not Found", {}, None)


class TestNeonClient(_EnvIsolated):
    BASE = "https://neon.test/api/v2"

    def _client(self):
        return dbc.NeonClient(api_key="neon-key", base=self.BASE)

    def test_resolve_project_uses_neon_project_id_without_any_call(self):
        os.environ["NEON_PROJECT_ID"] = "proj-configured"
        recorder = _UrlopenRecorder({})
        with mock.patch("urllib.request.urlopen", recorder):
            self.assertEqual(self._client().resolve_project("ep-cool-frost-12345"), "proj-configured")
        self.assertEqual(recorder.requests, [], "the configured project id skips the lookup entirely")

    def test_resolve_project_walks_pages_and_probes_the_endpoint(self):
        page_one = {"projects": [{"id": "proj-a"}], "pagination": {"cursor": "cur-1"}}
        page_two = {"projects": [{"id": "proj-b"}]}
        calls = {"projects": 0}

        def fake_urlopen(req, timeout=None):
            url = req.full_url
            if url.startswith(self.BASE + "/projects?"):
                calls["projects"] += 1
                return _json_response(page_one if calls["projects"] == 1 else page_two)
            if url == self.BASE + "/projects/proj-b/endpoints/ep-cool-frost-12345":
                return _json_response({"endpoint": {"branch_id": "br-parent", "id": "ep-cool-frost-12345"}})
            raise urllib_error_404(url)

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            client = self._client()
            # proj-a's probe 404s (unrouted), so the walk continues to page two.
            self.assertEqual(client.resolve_project("ep-cool-frost-12345"), "proj-b")
            self.assertEqual(client.endpoint_branch_id("proj-b", "ep-cool-frost-12345"), "br-parent")
        self.assertEqual(calls["projects"], 2)

    def test_create_branch_payload_shape(self):
        recorder = _UrlopenRecorder({
            self.BASE + "/projects/proj-1/branches": {
                "branch": {"id": "br-child"},
                "endpoints": [{"host": _BRANCH_HOST, "type": "read_write"}],
            },
        })
        with mock.patch("urllib.request.urlopen", recorder):
            created = self._client().create_branch(
                "proj-1", "br-parent", "dashclaw-contained-db-sess-1", "2026-09-07T00:00:00Z"
            )
        self.assertEqual(created, ("br-child", _BRANCH_HOST))
        req = recorder.requests[0]
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.headers.get("Authorization"), "Bearer neon-key")
        self.assertEqual(json.loads(req.data.decode("utf-8")), {
            "branch": {
                "parent_id": "br-parent",
                "name": "dashclaw-contained-db-sess-1",
                "expires_at": "2026-09-07T00:00:00Z",
            },
            "endpoints": [{"type": "read_write"}],
        })

    def test_compare_schema_query_and_empty_diff(self):
        recorder = _UrlopenRecorder({
            self.BASE + "/projects/proj-1/branches/br-child/compare_schema": {"diff": ""},
        })
        with mock.patch("urllib.request.urlopen", recorder):
            diff = self._client().compare_schema("proj-1", "br-child", "br-parent", "neondb")
        self.assertEqual(diff, "", "an empty diff is a legitimate answer, not a failure")
        self.assertIn("base_branch_id=br-parent", recorder.requests[0].full_url)
        self.assertIn("db_name=neondb", recorder.requests[0].full_url)

    def test_every_failure_returns_none_and_never_raises(self):
        def boom(req, timeout=None):
            raise OSError("connection reset")

        with mock.patch("urllib.request.urlopen", boom):
            client = self._client()
            self.assertIsNone(client.resolve_project("ep-cool-frost-12345"))
            self.assertIsNone(client.endpoint_branch_id("proj-1", "ep-cool-frost-12345"))
            self.assertIsNone(client.create_branch("proj-1", "br-parent", "n", "2026-09-07T00:00:00Z"))
            self.assertIsNone(client.compare_schema("proj-1", "br-child", "br-parent", "neondb"))

    def test_no_api_key_makes_every_call_a_no_op(self):
        recorder = _UrlopenRecorder({})
        with mock.patch("urllib.request.urlopen", recorder):
            self.assertIsNone(dbc.NeonClient(api_key="", base=self.BASE).resolve_project("ep-a"))
        self.assertEqual(recorder.requests, [])


# ---------------------------------------------------------------------------
# Env knobs + session state
# ---------------------------------------------------------------------------

class TestEnvAndSessionState(_EnvIsolated):
    def test_kill_switch_and_ttl_defaults(self):
        self.assertTrue(dbc.db_containment_enabled())
        self.assertEqual(dbc.ttl_hours(), 72)
        os.environ["DASHCLAW_DB_CONTAINMENT"] = "0"
        self.assertFalse(dbc.db_containment_enabled())
        os.environ["DASHCLAW_DB_CONTAINMENT_TTL_HOURS"] = "6"
        self.assertEqual(dbc.ttl_hours(), 6)
        os.environ["DASHCLAW_DB_CONTAINMENT_TTL_HOURS"] = "not-a-number"
        self.assertEqual(dbc.ttl_hours(), 72)

    def test_session_state_round_trip_holds_no_connection_url(self):
        session_id = "sess-db-state-test"
        suffix = "abc123def456"
        path = dbc.session_state_path(session_id, suffix)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        state = {
            "ref": "dashclaw/contained-db-sess-1",
            "project_id": "proj-1",
            "parent_branch_id": "br-parent",
            "branch_id": "br-child",
            "host": _BRANCH_HOST,
            "db_name": "neondb",
            "created_at": "2026-09-04T00:00:00Z",
            "expires_at": "2026-09-07T00:00:00Z",
            "prod_url": _PROD_URL,  # must be dropped on write
        }
        dbc.write_session_state(session_id, suffix, state)
        with open(path, encoding="utf-8") as f:
            raw = f.read()
        self.assertNotIn("npg_s3cret", raw)
        self.assertNotIn("prod_url", raw)
        read_back = dbc.read_session_state(session_id, suffix)
        self.assertEqual(read_back["branch_id"], "br-child")
        self.assertEqual(read_back["host"], _BRANCH_HOST)

    def test_state_path_is_distinct_from_the_worktree_state_file(self):
        path = dbc.session_state_path("sess-1", "inst-1")
        self.assertIn("dashclaw_db_containment_session_", path)
        self.assertNotIn("dashclaw_containment_session_inst", path)

    def test_missing_or_partial_state_reads_as_none(self):
        self.assertIsNone(dbc.read_session_state("sess-never-written-xyz", "inst-1"))
        session_id, suffix = "sess-partial-db", "inst-2"
        path = dbc.session_state_path(session_id, suffix)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"ref": "dashclaw/contained-db-x"}))
        self.assertIsNone(dbc.read_session_state(session_id, suffix),
                          "state without a branch must never look like a usable branch")


if __name__ == "__main__":
    unittest.main()

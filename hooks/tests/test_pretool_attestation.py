"""Attestation: the guard must be able to see WHICH MODEL and WHICH HARNESS acted.

Wes, 2026-09-06: "the underlying model and surrounding harness is what will
drastically impact whether or not an agent can be trusted ... the only model I
trust to [delete files] is Fable 5.1, I would never let Opus 5 or Sonnet 5 do
this task." That distinction was unrepresentable — the acting model is not on
hook stdin and not in the environment (no CLAUDE_MODEL); the harness writes it
per assistant entry in the session transcript, which is the only place it lives.

These tests pin the tail read, the harness derivation, and the failure modes —
most importantly that a missing or unreadable transcript degrades to silence
rather than to a fabricated model string.
"""

import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import dashclaw_pretool  # noqa: E402


def _entry(model=None, version=None, kind="assistant"):
    entry = {"type": kind, "uuid": "u1"}
    if version:
        entry["version"] = version
    if model:
        entry["message"] = {"model": model, "role": "assistant"}
    return json.dumps(entry)


class _TranscriptCase(unittest.TestCase):
    def setUp(self):
        self._paths = []

    def tearDown(self):
        for p in self._paths:
            try:
                os.unlink(p)
            except OSError:
                pass

    def _make(self, lines):
        fh = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8")
        fh.write("\n".join(lines) + "\n")
        fh.close()
        self._paths.append(fh.name)
        return fh.name


class ReadAttestationTest(_TranscriptCase):
    def test_reads_model_and_version_from_last_assistant_entry(self):
        path = self._make([
            _entry("claude-sonnet-5", "2.1.100"),
            _entry("claude-opus-5", "2.1.263"),
        ])
        self.assertEqual(dashclaw_pretool._read_attestation(path), ("claude-opus-5", "2.1.263"))

    def test_last_assistant_entry_wins_over_a_later_user_turn(self):
        path = self._make([
            _entry("claude-fable-5-1", "2.1.263"),
            json.dumps({"type": "user", "message": {"role": "user"}}),
        ])
        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-fable-5-1")

    def test_a_model_switch_mid_session_is_seen(self):
        """/model appends new assistant entries; the newest one is the truth."""
        path = self._make([_entry("claude-opus-5", "2.1.263")])
        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-opus-5")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(_entry("claude-fable-5-1", "2.1.263") + "\n")
        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-fable-5-1")

    def test_reads_only_the_tail_of_a_large_transcript(self):
        """This runs on EVERY governed tool call and a long session's transcript
        is megabytes. Entries beyond the tail window must not be read, and the
        seek must not leave a partial line that breaks the parse."""
        filler = json.dumps({"type": "user", "pad": "x" * 4000})
        lines = [_entry("claude-should-never-be-seen", "0.0.1")]
        lines += [filler] * 200
        lines.append(_entry("claude-opus-5", "2.1.263"))
        path = self._make(lines)
        self.assertGreater(os.path.getsize(path), dashclaw_pretool._TRANSCRIPT_TAIL_BYTES)
        self.assertEqual(dashclaw_pretool._read_attestation(path), ("claude-opus-5", "2.1.263"))

    def test_missing_transcript_is_silent_not_fabricated(self):
        self.assertEqual(dashclaw_pretool._read_attestation("/no/such/transcript.jsonl"), ("", ""))

    def test_empty_path_is_silent(self):
        self.assertEqual(dashclaw_pretool._read_attestation(""), ("", ""))
        self.assertEqual(dashclaw_pretool._read_attestation(None), ("", ""))

    def test_malformed_lines_are_skipped_not_fatal(self):
        path = self._make(["{not json at all", _entry("claude-opus-5", "2.1.263"), "}}}broken"])
        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-opus-5")

    def test_assistant_entry_without_a_model_yields_nothing(self):
        path = self._make([_entry(None, "2.1.263")])
        self.assertEqual(dashclaw_pretool._read_attestation(path), ("", ""))

    def test_values_are_capped(self):
        path = self._make([_entry("m" * 500, "v" * 500)])
        model, version = dashclaw_pretool._read_attestation(path)
        self.assertEqual(len(model), 128)
        self.assertEqual(len(version), 64)


class HarnessNameTest(unittest.TestCase):
    """The installers declare the harness through --agent-id
    (cli/lib/claude|codex/install.js, the Hermes adapter); a custom agent id
    is recognised by a Claude-Code-only stdin field; anything else is
    'unknown', never a guess."""

    def test_installer_declared_ids(self):
        for agent_id, want in [("claude-code", "claude-code"), ("codex", "codex"),
                               ("hermes", "hermes"), ("openclaw", "openclaw"), ("Codex", "codex")]:
            with mock.patch.object(dashclaw_pretool, "AGENT_ID", agent_id):
                self.assertEqual(dashclaw_pretool._harness_name({}), want, agent_id)

    def test_distinct_subagent_suffix_is_stripped(self):
        with mock.patch.object(dashclaw_pretool, "AGENT_ID", "codex:reviewer"):
            self.assertEqual(dashclaw_pretool._harness_name({}), "codex")

    def test_custom_agent_id_with_a_transcript_is_claude_code(self):
        with mock.patch.object(dashclaw_pretool, "AGENT_ID", "wes-laptop-bot"):
            self.assertEqual(dashclaw_pretool._harness_name({"transcript_path": "/t.jsonl"}), "claude-code")

    def test_custom_agent_id_without_a_transcript_is_unknown(self):
        with mock.patch.object(dashclaw_pretool, "AGENT_ID", "wes-laptop-bot"):
            self.assertEqual(dashclaw_pretool._harness_name({}), "unknown")


class AttachAttestationTest(_TranscriptCase):
    def test_attaches_model_harness_and_version(self):
        path = self._make([_entry("claude-fable-5-1", "2.1.263")])
        context = {}
        with mock.patch.object(dashclaw_pretool, "AGENT_ID", "claude-code"):
            dashclaw_pretool._attach_attestation(context, {"transcript_path": path})
        self.assertEqual(context["attested_model"], "claude-fable-5-1")
        self.assertEqual(context["harness"], "claude-code")
        self.assertEqual(context["harness_version"], "2.1.263")

    def test_codex_declares_its_harness_without_a_model(self):
        """Codex passes no transcript: harness is still declared — the harness
        half is the precondition for governance at all — and no model is
        invented."""
        context = {}
        with mock.patch.object(dashclaw_pretool, "AGENT_ID", "codex"):
            dashclaw_pretool._attach_attestation(context, {})
        self.assertEqual(context["harness"], "codex")
        self.assertNotIn("attested_model", context)
        self.assertNotIn("harness_version", context)


if __name__ == "__main__":
    unittest.main()

"""Attestation: the guard must be able to see WHICH MODEL and WHICH HARNESS acted.

Wes, 2026-09-06: "the underlying model and surrounding harness is what will
drastically impact whether or not an agent can be trusted ... the only model I
trust to [delete files] is Fable 5.1, I would never let Opus 5 or Sonnet 5 do
this task." That distinction was unrepresentable — the acting model is not on
hook stdin and not in the environment (no CLAUDE_MODEL); the harness writes it
per assistant entry in the session transcript, which is the only place it lives.

These tests pin the tail read, the cache, the failure modes, and — most
importantly — that a missing or unreadable transcript degrades to silence
rather than to a fabricated model string.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import dashclaw_pretool  # noqa: E402


def _entry(model=None, version=None, kind="assistant"):
    entry = {"type": kind, "uuid": "u1"}
    if version:
        entry["version"] = version
    if model:
        entry["message"] = {"model": model, "role": "assistant"}
    return json.dumps(entry)


def _transcript(lines):
    fh = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8")
    fh.write("\n".join(lines) + "\n")
    fh.close()
    return fh.name


class ReadAttestationTest(unittest.TestCase):
    def setUp(self):
        dashclaw_pretool._ATTESTATION_CACHE.clear()
        self._paths = []

    def tearDown(self):
        for p in self._paths:
            try:
                os.unlink(p)
            except OSError:
                pass

    def _make(self, lines):
        path = _transcript(lines)
        self._paths.append(path)
        return path

    def test_reads_model_and_version_from_last_assistant_entry(self):
        path = self._make([
            _entry("claude-sonnet-5", "2.1.100"),
            _entry("claude-opus-5", "2.1.263"),
        ])
        self.assertEqual(
            dashclaw_pretool._read_attestation(path),
            ("claude-opus-5", "2.1.263"),
        )

    def test_last_assistant_entry_wins_over_later_non_assistant(self):
        """A user turn after the assistant turn must not blank the model."""
        path = self._make([
            _entry("claude-fable-5-1", "2.1.263"),
            json.dumps({"type": "user", "message": {"role": "user"}}),
        ])
        model, _ = dashclaw_pretool._read_attestation(path)
        self.assertEqual(model, "claude-fable-5-1")

    def test_reads_only_the_tail_of_a_large_transcript(self):
        """A long session's transcript is megabytes and this runs on EVERY tool
        call. Entries beyond the tail window must not be read, and the seek must
        not leave a partial line that breaks the parse."""
        filler = json.dumps({"type": "user", "pad": "x" * 4000})
        lines = [_entry("claude-should-never-be-seen", "0.0.1")]
        lines += [filler] * 200                      # push well past the window
        lines.append(_entry("claude-opus-5", "2.1.263"))
        path = self._make(lines)
        self.assertGreater(os.path.getsize(path), dashclaw_pretool._TRANSCRIPT_TAIL_BYTES)
        self.assertEqual(
            dashclaw_pretool._read_attestation(path),
            ("claude-opus-5", "2.1.263"),
        )

    def test_caches_on_path_and_size(self):
        """Proven by a same-size rewrite: if the tail were re-read, the new
        model would come back. The stale value proves the cache was consulted —
        this runs on every governed tool call, so a re-read per call is waste."""
        path = self._make([_entry("claude-opus-5", "2.1.263")])
        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-opus-5")

        size_before = os.path.getsize(path)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(_entry("claude-XXXXX5", "2.1.263") + "\n")  # same byte length
        self.assertEqual(os.path.getsize(path), size_before)

        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-opus-5")

    def test_cache_misses_when_the_transcript_grows(self):
        """A /model switch mid-session appends entries, so the size changes and
        the next call must see the NEW model, not the cached one."""
        path = self._make([_entry("claude-opus-5", "2.1.263")])
        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-opus-5")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(_entry("claude-fable-5-1", "2.1.263") + "\n")
        self.assertEqual(dashclaw_pretool._read_attestation(path)[0], "claude-fable-5-1")

    def test_deleted_transcript_yields_nothing_even_when_cached(self):
        """getsize runs before the cache lookup on purpose: a vanished
        transcript is 'no attestation', never a stale claim about the model."""
        path = self._make([_entry("claude-opus-5", "2.1.263")])
        dashclaw_pretool._read_attestation(path)
        os.unlink(path)
        self._paths.remove(path)
        self.assertEqual(dashclaw_pretool._read_attestation(path), ("", ""))

    def test_missing_transcript_is_silent_not_fabricated(self):
        self.assertEqual(
            dashclaw_pretool._read_attestation("/no/such/transcript.jsonl"),
            ("", ""),
        )

    def test_empty_path_is_silent(self):
        self.assertEqual(dashclaw_pretool._read_attestation(""), ("", ""))
        self.assertEqual(dashclaw_pretool._read_attestation(None), ("", ""))

    def test_malformed_lines_are_skipped_not_fatal(self):
        path = self._make([
            "{not json at all",
            _entry("claude-opus-5", "2.1.263"),
            "}}}broken",
        ])
        model, _ = dashclaw_pretool._read_attestation(path)
        self.assertEqual(model, "claude-opus-5")

    def test_assistant_entry_without_a_model_yields_nothing(self):
        path = self._make([_entry(None, "2.1.263")])
        self.assertEqual(dashclaw_pretool._read_attestation(path), ("", ""))

    def test_values_are_capped(self):
        path = self._make([_entry("m" * 500, "v" * 500)])
        model, version = dashclaw_pretool._read_attestation(path)
        self.assertEqual(len(model), 128)
        self.assertEqual(len(version), 64)


class AttachAttestationTest(unittest.TestCase):
    def setUp(self):
        dashclaw_pretool._ATTESTATION_CACHE.clear()
        self._paths = []

    def tearDown(self):
        for p in self._paths:
            try:
                os.unlink(p)
            except OSError:
                pass

    def test_attaches_model_harness_and_version(self):
        path = _transcript([_entry("claude-fable-5-1", "2.1.263")])
        self._paths.append(path)
        context = {}
        dashclaw_pretool._attach_attestation(context, {"transcript_path": path})
        self.assertEqual(context["attested_model"], "claude-fable-5-1")
        self.assertEqual(context["harness"], "claude-code")
        self.assertEqual(context["harness_version"], "2.1.263")

    def test_harness_is_declared_even_when_the_model_is_unknown(self):
        """A harness that cannot report its model still identifies itself — the
        harness half is the precondition for governance at all."""
        context = {}
        dashclaw_pretool._attach_attestation(context, {})
        self.assertEqual(context["harness"], "claude-code")
        self.assertNotIn("attested_model", context)
        self.assertNotIn("harness_version", context)


if __name__ == "__main__":
    unittest.main()

"""Tests for dashclaw_agent_intel.stop_transcript — the pure transcript logic
extracted from dashclaw_stop.py. These pin the behavior contracts the Stop
hook's token attribution, coverage truth, and assumption capture depend on."""

import unittest

from dashclaw_agent_intel import stop_transcript as st


def _user(text="hi", uuid="u1"):
    return {"type": "user", "uuid": uuid, "message": {"content": text}}


def _tool_result_user(uuid="tr1"):
    return {
        "type": "user",
        "uuid": uuid,
        "message": {"content": [{"type": "tool_result", "content": "ok"}]},
    }


def _assistant(uuid="a1", input_tokens=0, output_tokens=0, cache_creation=0,
               cache_read=0, model="", content=None):
    usage = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_input_tokens": cache_creation,
        "cache_read_input_tokens": cache_read,
    }
    msg = {"usage": usage}
    if model:
        msg["model"] = model
    if content is not None:
        msg["content"] = content
    return {"type": "assistant", "uuid": uuid, "message": msg}


# ---------------------------------------------------------------------------
# Turn boundary resolution
# ---------------------------------------------------------------------------

class TestTurnStart(unittest.TestCase):
    def test_starts_after_last_real_user_prompt(self):
        entries = [_user(uuid="u1"), _assistant(uuid="a1"), _user(text="again", uuid="u2"), _assistant(uuid="a2")]
        self.assertEqual(st.index_after_last_user_prompt(entries), 3)

    def test_tool_result_user_messages_are_not_prompts(self):
        entries = [_user(uuid="u1"), _assistant(uuid="a1"), _tool_result_user(), _assistant(uuid="a2")]
        # The tool_result user entry must NOT start a new turn.
        self.assertEqual(st.index_after_last_user_prompt(entries), 1)

    def test_no_user_prompt_returns_zero(self):
        self.assertEqual(st.index_after_last_user_prompt([_assistant()]), 0)

    def test_cursor_uuid_wins_over_prompt_fallback(self):
        entries = [_user(uuid="u1"), _assistant(uuid="a1"), _assistant(uuid="a2")]
        self.assertEqual(st.resolve_turn_start(entries, "a1"), 2)

    def test_missing_cursor_falls_back_to_prompt(self):
        entries = [_user(uuid="u1"), _assistant(uuid="a1")]
        self.assertEqual(st.resolve_turn_start(entries, "nope"), 1)


# ---------------------------------------------------------------------------
# Token usage math
# ---------------------------------------------------------------------------

class TestUsage(unittest.TestCase):
    def test_cache_read_discounted_to_ten_percent(self):
        usage = {"input_tokens": 100, "cache_creation_input_tokens": 50, "cache_read_input_tokens": 1000}
        self.assertEqual(st.usage_input_tokens(usage), 100 + 50 + 100)

    def test_cache_read_rounds_half_away_from_zero(self):
        # 25 * 0.1 = 2.5 -> must round to 3 (JS Math.round parity), not
        # banker's-round to 2.
        self.assertEqual(st.usage_input_tokens({"cache_read_input_tokens": 25}), 3)

    def test_collect_turn_usage_sums_since_cursor(self):
        entries = [
            _user(uuid="u1"),
            _assistant(uuid="a1", input_tokens=10, output_tokens=5, model="m-old"),
            _assistant(uuid="a2", input_tokens=7, output_tokens=3, model="m-new"),
        ]
        tokens_in, tokens_out, model, cursor = st.collect_turn_usage(entries, "a1")
        self.assertEqual((tokens_in, tokens_out), (7, 3))
        self.assertEqual(model, "m-new")
        self.assertEqual(cursor, "a2")

    def test_collect_turn_usage_keeps_first_model_seen(self):
        entries = [
            _user(uuid="u1"),
            _assistant(uuid="a1", input_tokens=1, model="first"),
            _assistant(uuid="a2", input_tokens=1, model="second"),
        ]
        _, _, model, _ = st.collect_turn_usage(entries, "")
        self.assertEqual(model, "first")

    def test_empty_transcript_preserves_cursor(self):
        tokens_in, tokens_out, model, cursor = st.collect_turn_usage([], "prev")
        self.assertEqual((tokens_in, tokens_out, model, cursor), (0, 0, "", "prev"))


# ---------------------------------------------------------------------------
# Governed tool_use collection
# ---------------------------------------------------------------------------

class TestGovernedTools(unittest.TestCase):
    def test_governed_matcher_matches_harness_set(self):
        for name in ("Agent", "Task", "Workflow", "Bash", "Edit", "Write",
                     "MultiEdit", "Skill", "mcp__dashclaw__guard"):
            self.assertTrue(st.is_governed_tool_name(name), name)

    def test_governed_matcher_rejects_read_tools(self):
        for name in ("Read", "Glob", "Grep", "", None, "bash"):
            self.assertFalse(st.is_governed_tool_name(name), repr(name))

    def test_collect_turn_tool_uses_reads_blocks_from_start(self):
        entries = [
            _assistant(uuid="a0", content=[{"type": "tool_use", "id": "t0", "name": "Bash"}]),
            _assistant(uuid="a1", content=[
                {"type": "tool_use", "id": "t1", "name": "Edit"},
                {"type": "text", "text": "hi"},
                {"type": "tool_use", "id": "t2", "name": "Read"},
            ]),
        ]
        self.assertEqual(st.collect_turn_tool_uses(entries, 1), [("t1", "Edit"), ("t2", "Read")])


# ---------------------------------------------------------------------------
# Assumption extraction
# ---------------------------------------------------------------------------

class TestAssumptions(unittest.TestCase):
    def test_extracts_numbered_items(self):
        text = "ASSUMPTIONS I'M MAKING:\n1. The DB is local\n2. Schema is current\n→ Correct me now"
        self.assertEqual(st.extract_assumptions(text), ["The DB is local", "Schema is current"])

    def test_blank_after_first_item_ends_block(self):
        text = "ASSUMPTIONS I'M MAKING:\n\n1. One\n\n2. Two"
        self.assertEqual(st.extract_assumptions(text), ["One"])

    def test_caps_at_five_and_dedupes(self):
        items = "\n".join("%d. item %d" % (i, i % 6) for i in range(1, 10))
        out = st.extract_assumptions("ASSUMPTIONS I'M MAKING:\n" + items)
        self.assertLessEqual(len(out), st.ASSUMPTIONS_PER_TURN_CAP)
        self.assertEqual(len(out), len(set(out)))

    def test_no_header_no_items(self):
        self.assertEqual(st.extract_assumptions("1. not preceded by header"), [])

    def test_turn_assistant_text_joins_text_blocks(self):
        entries = [
            _assistant(uuid="a1", content=[{"type": "text", "text": "one"}]),
            {"type": "assistant", "uuid": "a2", "message": {"content": "two"}},
            _user(uuid="u1"),
        ]
        self.assertEqual(st.turn_assistant_text(entries, 0), "one\ntwo")


# ---------------------------------------------------------------------------
# Distribution + PATCH body
# ---------------------------------------------------------------------------

class TestDistribution(unittest.TestCase):
    def test_distribute_sums_to_total(self):
        for total, n in ((10, 3), (0, 4), (7, 7), (5, 2)):
            parts = st.distribute(total, n)
            self.assertEqual(sum(parts), total)
            self.assertEqual(len(parts), n)

    def test_early_buckets_get_remainder(self):
        self.assertEqual(st.distribute(10, 3), [4, 3, 3])

    def test_patch_body_without_tokens_omits_token_fields(self):
        body = st.patch_body_for(0, 0, "m", False, "ts")
        self.assertNotIn("tokens_in", body)
        self.assertTrue(body["close_if_running"])
        self.assertEqual(body["status"], "completed")

    def test_patch_body_with_tokens_includes_model(self):
        body = st.patch_body_for(3, 4, "claude-x", True, "ts")
        self.assertEqual((body["tokens_in"], body["tokens_out"], body["model"]), (3, 4, "claude-x"))

    def test_datetime_now_iso_ends_with_z(self):
        self.assertTrue(st.datetime_now_iso().endswith("Z"))


if __name__ == "__main__":
    unittest.main()

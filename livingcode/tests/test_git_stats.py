import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock


def _iso_days_ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S +0000")


class TestGitStatsCollector(unittest.TestCase):

    @patch("livingcode.collectors.git_stats._run_git")
    def test_collects_commit_counts(self, mock_git):
        from livingcode.collectors.git_stats import collect_git_stats
        mock_git.side_effect = self._mock_git_responses()
        result = collect_git_stats("/fake/repo")
        self.assertEqual(result.commits_7d, 14)
        self.assertEqual(result.commits_30d, 48)

    @patch("livingcode.collectors.git_stats._run_git")
    def test_calculates_bus_factor(self, mock_git):
        from livingcode.collectors.git_stats import collect_git_stats
        mock_git.side_effect = self._mock_git_responses()
        result = collect_git_stats("/fake/repo")
        self.assertEqual(result.bus_factor, 1)

    @patch("livingcode.collectors.git_stats._run_git")
    def test_counts_active_and_stale_branches(self, mock_git):
        from livingcode.collectors.git_stats import collect_git_stats
        mock_git.side_effect = self._mock_git_responses()
        result = collect_git_stats("/fake/repo")
        self.assertEqual(result.active_branches, 2)
        self.assertEqual(result.stale_branches, 1)

    @patch("livingcode.collectors.git_stats._run_git")
    def test_returns_top_contributors(self, mock_git):
        from livingcode.collectors.git_stats import collect_git_stats
        mock_git.side_effect = self._mock_git_responses()
        result = collect_git_stats("/fake/repo")
        self.assertEqual(len(result.top_contributors_30d), 2)
        self.assertEqual(result.top_contributors_30d[0]["name"], "Wes Sander")

    @patch("livingcode.collectors.git_stats._run_git")
    def test_counts_files_changed(self, mock_git):
        from livingcode.collectors.git_stats import collect_git_stats
        mock_git.side_effect = self._mock_git_responses()
        result = collect_git_stats("/fake/repo")
        self.assertEqual(result.files_changed_7d, 3)

    def _mock_git_responses(self):
        """Returns a side_effect callable that dispatches on sequential call order."""
        call_count = {"n": 0}

        def dispatch(*args, **kwargs):
            call_count["n"] += 1
            n = call_count["n"]
            ordered = [
                "14",     # 1: commits 7d
                "48",     # 2: commits 30d
                "  origin/main\n  origin/feat-a\n  origin/stale-one",  # 3: branches
                # Relative dates — hardcoded ones rot past the active-branch
                # window and the test starts failing on the calendar.
                _iso_days_ago(3),     # 4: main last commit (active)
                _iso_days_ago(4),     # 5: feat-a last commit (active)
                _iso_days_ago(120),   # 6: stale-one last commit (stale)
                "    46\tWes Sander\n     2\tdependabot[bot]",  # 7: shortlog
                " 3 files changed, 200 insertions(+), 50 deletions(-)",  # 8: diff stat
            ]
            if n <= len(ordered):
                return ordered[n - 1]
            return ""

        return dispatch


if __name__ == "__main__":
    unittest.main()

"""Tests for dashclaw_agent_intel.command_parser.parse_command."""

import unittest
from dashclaw_agent_intel.command_parser import parse_command


class TestSimpleCommand(unittest.TestCase):
    """Simple commands: base_command, flags, targets."""

    def test_ls_with_flag_and_target(self):
        result = parse_command("ls -la /tmp")
        self.assertEqual(result["base_command"], "ls")
        self.assertEqual(result["flags"], ["-la"])
        self.assertEqual(result["targets"], ["/tmp"])
        self.assertIsNone(result["wrapper"])
        self.assertIsNone(result["subcommand"])

    def test_command_only(self):
        result = parse_command("whoami")
        self.assertEqual(result["base_command"], "whoami")
        self.assertEqual(result["flags"], [])
        self.assertEqual(result["targets"], [])

    def test_multiple_flags(self):
        result = parse_command("grep -r -n pattern file.txt")
        self.assertEqual(result["base_command"], "grep")
        self.assertIn("-r", result["flags"])
        self.assertIn("-n", result["flags"])
        self.assertIn("pattern", result["targets"])
        self.assertIn("file.txt", result["targets"])

    def test_long_flag(self):
        result = parse_command("npm install --save-dev typescript")
        self.assertEqual(result["base_command"], "npm")
        self.assertEqual(result["subcommand"], "install")
        self.assertIn("--save-dev", result["flags"])
        self.assertIn("typescript", result["targets"])


class TestWrappers(unittest.TestCase):
    """Commands prefixed with sudo, env, nohup, etc."""

    def test_sudo_wrapper(self):
        result = parse_command("sudo apt install nginx")
        self.assertEqual(result["wrapper"], "sudo")
        self.assertEqual(result["base_command"], "apt")
        self.assertEqual(result["subcommand"], "install")
        self.assertIn("nginx", result["targets"])

    def test_env_wrapper(self):
        result = parse_command("env VAR=1 python script.py")
        self.assertEqual(result["wrapper"], "env")
        self.assertEqual(result["base_command"], "python")
        self.assertIn("script.py", result["targets"])

    def test_nohup_wrapper(self):
        result = parse_command("nohup python server.py")
        self.assertEqual(result["wrapper"], "nohup")
        self.assertEqual(result["base_command"], "python")

    def test_nice_wrapper(self):
        result = parse_command("nice -n 10 make build")
        self.assertEqual(result["wrapper"], "nice")
        self.assertEqual(result["base_command"], "make")

    def test_timeout_wrapper(self):
        result = parse_command("timeout 30 curl http://example.com")
        self.assertEqual(result["wrapper"], "timeout")
        self.assertEqual(result["base_command"], "curl")

    def test_time_wrapper(self):
        result = parse_command("time cargo build")
        self.assertEqual(result["wrapper"], "time")
        self.assertEqual(result["base_command"], "cargo")
        self.assertEqual(result["subcommand"], "build")

    def test_strace_wrapper(self):
        result = parse_command("strace ls -la")
        self.assertEqual(result["wrapper"], "strace")
        self.assertEqual(result["base_command"], "ls")

    def test_ionice_wrapper(self):
        result = parse_command("ionice -c 2 dd if=/dev/zero of=/tmp/test")
        self.assertEqual(result["wrapper"], "ionice")
        self.assertEqual(result["base_command"], "dd")


class TestSubcommands(unittest.TestCase):
    """Tools with recognized subcommands: git, docker, kubectl, etc."""

    def test_git_push(self):
        result = parse_command("git push origin main")
        self.assertEqual(result["base_command"], "git")
        self.assertEqual(result["subcommand"], "push")
        self.assertIn("origin", result["targets"])
        self.assertIn("main", result["targets"])

    def test_git_commit_with_message(self):
        result = parse_command("git commit -m 'initial commit'")
        self.assertEqual(result["base_command"], "git")
        self.assertEqual(result["subcommand"], "commit")
        self.assertIn("-m", result["flags"])

    def test_docker_run(self):
        result = parse_command("docker run -d -p 8080:80 nginx")
        self.assertEqual(result["base_command"], "docker")
        self.assertEqual(result["subcommand"], "run")
        self.assertIn("-d", result["flags"])

    def test_kubectl_apply(self):
        result = parse_command("kubectl apply -f deployment.yaml")
        self.assertEqual(result["base_command"], "kubectl")
        self.assertEqual(result["subcommand"], "apply")
        self.assertIn("-f", result["flags"])

    def test_npm_run_dev(self):
        result = parse_command("npm run dev")
        self.assertEqual(result["base_command"], "npm")
        self.assertEqual(result["subcommand"], "run")

    def test_pip_install(self):
        result = parse_command("pip install -r requirements.txt")
        self.assertEqual(result["base_command"], "pip")
        self.assertEqual(result["subcommand"], "install")
        self.assertIn("-r", result["flags"])

    def test_cargo_test(self):
        result = parse_command("cargo test --workspace")
        self.assertEqual(result["base_command"], "cargo")
        self.assertEqual(result["subcommand"], "test")
        self.assertIn("--workspace", result["flags"])

    def test_go_build(self):
        result = parse_command("go build ./cmd/server")
        self.assertEqual(result["base_command"], "go")
        self.assertEqual(result["subcommand"], "build")

    def test_apt_update(self):
        result = parse_command("apt update")
        self.assertEqual(result["base_command"], "apt")
        self.assertEqual(result["subcommand"], "update")

    def test_brew_install(self):
        result = parse_command("brew install jq")
        self.assertEqual(result["base_command"], "brew")
        self.assertEqual(result["subcommand"], "install")

    def test_systemctl_restart(self):
        result = parse_command("systemctl restart nginx")
        self.assertEqual(result["base_command"], "systemctl")
        self.assertEqual(result["subcommand"], "restart")

    def test_yarn_add(self):
        result = parse_command("yarn add react")
        self.assertEqual(result["base_command"], "yarn")
        self.assertEqual(result["subcommand"], "add")


class TestPipes(unittest.TestCase):
    """Pipe chains: cat file | grep error | wc -l."""

    def test_simple_pipe(self):
        result = parse_command("cat file.txt | grep error")
        self.assertEqual(result["base_command"], "cat")
        self.assertEqual(len(result["pipes"]), 2)
        self.assertEqual(result["pipes"][0]["base_command"], "cat")
        self.assertEqual(result["pipes"][1]["base_command"], "grep")

    def test_triple_pipe(self):
        result = parse_command("cat file.txt | grep error | wc -l")
        self.assertEqual(result["base_command"], "cat")
        self.assertEqual(len(result["pipes"]), 3)
        self.assertEqual(result["pipes"][0]["base_command"], "cat")
        self.assertEqual(result["pipes"][1]["base_command"], "grep")
        self.assertIn("error", result["pipes"][1]["targets"])
        self.assertEqual(result["pipes"][2]["base_command"], "wc")
        self.assertIn("-l", result["pipes"][2]["flags"])

    def test_pipe_preserves_first_segment_in_top_level(self):
        """Top-level fields reflect the first pipe segment."""
        result = parse_command("find . -name '*.py' | xargs grep TODO")
        self.assertEqual(result["base_command"], "find")


class TestRedirections(unittest.TestCase):
    """Output redirections: >, >>, 2>, 2>>, &>, &>>."""

    def test_stdout_redirect(self):
        result = parse_command("echo hello > output.txt")
        self.assertEqual(result["base_command"], "echo")
        self.assertIn("hello", result["targets"])
        self.assertEqual(len(result["redirections"]), 1)
        self.assertEqual(result["redirections"][0]["type"], ">")
        self.assertEqual(result["redirections"][0]["target"], "output.txt")

    def test_append_redirect(self):
        result = parse_command("echo data >> log.txt")
        self.assertEqual(result["redirections"][0]["type"], ">>")
        self.assertEqual(result["redirections"][0]["target"], "log.txt")

    def test_stderr_redirect(self):
        result = parse_command("make build 2> errors.log")
        self.assertEqual(result["redirections"][0]["type"], "2>")
        self.assertEqual(result["redirections"][0]["target"], "errors.log")

    def test_stderr_append_redirect(self):
        result = parse_command("make build 2>> errors.log")
        self.assertEqual(result["redirections"][0]["type"], "2>>")
        self.assertEqual(result["redirections"][0]["target"], "errors.log")

    def test_combined_redirect(self):
        result = parse_command("./run.sh &> all.log")
        self.assertEqual(result["redirections"][0]["type"], "&>")
        self.assertEqual(result["redirections"][0]["target"], "all.log")

    def test_combined_append_redirect(self):
        result = parse_command("./run.sh &>> all.log")
        self.assertEqual(result["redirections"][0]["type"], "&>>")
        self.assertEqual(result["redirections"][0]["target"], "all.log")


class TestFdDuplication(unittest.TestCase):
    """`N>&M` duplicates a file descriptor. It does NOT write a file.

    Live defect found 2026-08-11 on my-dashclaw.vercel.app: `2>&1` parsed as a
    redirection whose target is a file literally named `&1`. Two consequences,
    both visible on /policies:
      1. `dashclaw_pretool` floors any command carrying a redirection at risk
         35 ("a redirection writes a file even when the command is readonly"),
         so the single most common shell idiom warned forever.
      2. The warn shape surfaced as `other -> &1`, and an operator could grant
         it — creating a 30-day allow_grant scoped to a filename that can never
         exist. A no-op grant that reads as a resolved item.
    """

    def test_stderr_to_stdout_is_not_a_file_write(self):
        result = parse_command("npm test 2>&1")
        self.assertEqual(result["redirections"], [])

    def test_stdout_to_stderr_is_not_a_file_write(self):
        result = parse_command("./run.sh >&2")
        self.assertEqual(result["redirections"], [])

    def test_fd_dup_beside_a_real_redirect_keeps_only_the_file(self):
        result = parse_command("npm test > build.log 2>&1")
        self.assertEqual(len(result["redirections"]), 1)
        self.assertEqual(result["redirections"][0]["type"], ">")
        self.assertEqual(result["redirections"][0]["target"], "build.log")

    def test_spaced_fd_dup_is_not_a_file_write(self):
        result = parse_command("npm test 2> &1")
        self.assertEqual(result["redirections"], [])

    def test_fd_dup_does_not_leak_into_targets(self):
        result = parse_command("npm test 2>&1")
        self.assertNotIn("&1", result["targets"])
        self.assertNotIn("2>&1", result["targets"])

    def test_a_file_named_with_a_leading_ampersand_still_redirects(self):
        # `&` is only an fd-dup marker directly after the operator; `&>` writes
        # a real file and must keep working.
        result = parse_command("./run.sh &> all.log")
        self.assertEqual(result["redirections"][0]["target"], "all.log")


class TestChains(unittest.TestCase):
    """Chained commands: cmd1 && cmd2, cmd1 ; cmd2."""

    def test_and_chain(self):
        result = parse_command("npm install && npm run build")
        self.assertEqual(result["base_command"], "npm")
        self.assertEqual(len(result["chains"]), 2)
        self.assertEqual(result["chains"][0]["base_command"], "npm")
        self.assertEqual(result["chains"][0]["subcommand"], "install")
        self.assertEqual(result["chains"][1]["base_command"], "npm")
        self.assertEqual(result["chains"][1]["subcommand"], "run")

    def test_semicolon_chain(self):
        result = parse_command("cd /tmp ; ls")
        self.assertEqual(len(result["chains"]), 2)
        self.assertEqual(result["chains"][0]["base_command"], "cd")
        self.assertEqual(result["chains"][1]["base_command"], "ls")

    def test_mixed_chains(self):
        result = parse_command("mkdir build && cd build ; cmake ..")
        self.assertEqual(len(result["chains"]), 3)
        self.assertEqual(result["chains"][0]["base_command"], "mkdir")
        self.assertEqual(result["chains"][1]["base_command"], "cd")
        self.assertEqual(result["chains"][2]["base_command"], "cmake")


class TestEmptyAndEdge(unittest.TestCase):
    """Edge cases: empty strings, whitespace, quoted args."""

    def test_empty_string(self):
        result = parse_command("")
        self.assertEqual(result["base_command"], "")
        self.assertEqual(result["flags"], [])
        self.assertEqual(result["targets"], [])

    def test_whitespace_only(self):
        result = parse_command("   ")
        self.assertEqual(result["base_command"], "")

    def test_quoted_arg_with_spaces(self):
        result = parse_command('grep "hello world" file.txt')
        self.assertEqual(result["base_command"], "grep")
        self.assertIn("hello world", result["targets"])
        self.assertIn("file.txt", result["targets"])

    def test_single_quoted_arg(self):
        result = parse_command("echo 'multi word string'")
        self.assertEqual(result["base_command"], "echo")
        self.assertIn("multi word string", result["targets"])


class TestReturnShape(unittest.TestCase):
    """Every result dict has the correct keys."""

    def test_all_keys_present(self):
        result = parse_command("ls")
        expected_keys = {
            "base_command",
            "subcommand",
            "flags",
            "targets",
            "wrapper",
            "env_assignments",
            "pipes",
            "redirections",
            "chains",
        }
        self.assertEqual(set(result.keys()), expected_keys)

    def test_env_assignment_prefix_stripped(self):
        result = parse_command("FOO=1 BAR=baz npm run test")
        self.assertEqual(result["base_command"], "npm")
        self.assertEqual(result["subcommand"], "run")
        self.assertEqual(result["env_assignments"], ["FOO=1", "BAR=baz"])
        self.assertNotIn("FOO=1", result["targets"])

    def test_env_assignment_with_secret_value_not_a_target(self):
        result = parse_command("STRIPE_SECRET_KEY=sk_test_123 node billing.js")
        self.assertEqual(result["base_command"], "node")
        self.assertEqual(result["targets"], ["billing.js"])
        self.assertEqual(result["env_assignments"], ["STRIPE_SECRET_KEY=sk_test_123"])

    def test_assignment_only_command(self):
        result = parse_command("FOO=1")
        self.assertEqual(result["base_command"], "")
        self.assertEqual(result["env_assignments"], ["FOO=1"])

    def test_types(self):
        result = parse_command("sudo git push origin main")
        self.assertIsInstance(result["base_command"], str)
        self.assertIsInstance(result["subcommand"], (str, type(None)))
        self.assertIsInstance(result["flags"], list)
        self.assertIsInstance(result["targets"], list)
        self.assertIsInstance(result["wrapper"], (str, type(None)))
        self.assertIsInstance(result["pipes"], list)
        self.assertIsInstance(result["redirections"], list)
        self.assertIsInstance(result["chains"], list)


if __name__ == "__main__":
    unittest.main()

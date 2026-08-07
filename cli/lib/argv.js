// cli/lib/argv.js
//
// Argv helpers for the dashclaw bin that must be unit-testable without
// spawning the CLI (the bin's import graph pulls cli-only deps like `tar`,
// which are not installed in the repo-root CI environment).

/**
 * True when any argv token asks for help. Subcommand handlers never see the
 * flag: dispatch short-circuits to usage instead of running the subcommand
 * (before this guard, `dashclaw install codex --help` RAN the install).
 */
export function isHelpInvocation(args) {
  return args.includes('--help') || args.includes('-h');
}

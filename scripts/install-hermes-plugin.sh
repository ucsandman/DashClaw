#!/usr/bin/env bash
#
# Install the DashClaw plugin into a local Hermes Agent installation.
#
# Usage:
#   ./scripts/install-hermes-plugin.sh
#   ./scripts/install-hermes-plugin.sh --force        # overwrite existing
#   ./scripts/install-hermes-plugin.sh --copy         # copy instead of symlink
#
# Mirrors install-hermes-plugin.ps1 for macOS / Linux. Idempotent: re-runs
# detect the existing install and skip unless --force is passed.

set -euo pipefail

FORCE=0
MODE="symlink"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --copy)  MODE="copy"; shift ;;
    -h|--help)
      sed -n '1,15p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PLUGIN_SRC="$REPO_ROOT/plugins/dashclaw/.hermes-plugin"
SKILLS_SRC="$REPO_ROOT/plugins/dashclaw/skills"
SNIPPET_PATH="$PLUGIN_SRC/hermes_config_snippet.yaml"

if [[ ! -d "$PLUGIN_SRC" ]]; then
  echo "Plugin source not found at $PLUGIN_SRC. Run this from inside the DashClaw checkout." >&2
  exit 1
fi

echo "DashClaw -> Hermes Agent plugin install"
echo "  repo root  : $REPO_ROOT"
echo "  hermes home: $HERMES_HOME"
echo "  mode       : $MODE"

mkdir -p "$HERMES_HOME/plugins" "$HERMES_HOME/skills"

place_item() {
  local src="$1" dst="$2"
  if [[ -e "$dst" || -L "$dst" ]]; then
    if [[ "$FORCE" -eq 1 ]]; then
      rm -rf "$dst"
    else
      echo "  ! $dst already exists. Re-run with --force to replace."
      return 0
    fi
  fi
  if [[ "$MODE" == "symlink" ]]; then
    ln -s "$src" "$dst"
    echo "  + symlink $dst -> $src"
  else
    cp -R "$src" "$dst"
    echo "  + copied $src -> $dst"
  fi
}

echo
echo "Step 1: place plugin"
place_item "$PLUGIN_SRC" "$HERMES_HOME/plugins/dashclaw"

echo
echo "Step 2: place skills (auto-discovery path)"
place_item "$SKILLS_SRC" "$HERMES_HOME/skills/dashclaw"

echo
echo "Step 3: append hooks to config.yaml"
CONFIG_PATH="$HERMES_HOME/config.yaml"
MARKER="# >>> dashclaw hooks (auto-installed) >>>"
END_MARKER="# <<< dashclaw hooks (auto-installed) <<<"

if [[ -f "$CONFIG_PATH" ]] && grep -qF "$MARKER" "$CONFIG_PATH"; then
  echo "  = config.yaml already contains the dashclaw hooks block (skipping)"
else
  # Replace ${DASHCLAW_REPO} with the absolute path so the user does not
  # need a shell-expanded snippet.
  RESOLVED_SNIPPET="$(sed "s|\${DASHCLAW_REPO}|$REPO_ROOT|g" "$SNIPPET_PATH")"
  {
    [[ -f "$CONFIG_PATH" ]] && cat "$CONFIG_PATH"
    printf '\n%s\n%s\n%s\n' "$MARKER" "$RESOLVED_SNIPPET" "$END_MARKER"
  } > "$CONFIG_PATH.tmp"
  mv "$CONFIG_PATH.tmp" "$CONFIG_PATH"
  echo "  + appended dashclaw hooks block to $CONFIG_PATH"
fi

echo
echo "Step 4: env-var checklist"
missing=()
[[ -z "${DASHCLAW_BASE_URL:-}" ]] && missing+=("DASHCLAW_BASE_URL")
[[ -z "${DASHCLAW_API_KEY:-}"  ]] && missing+=("DASHCLAW_API_KEY")
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "  ! Missing: ${missing[*]}"
  echo "    Set them in your shell or under \`plugins.dashclaw.env:\` in $CONFIG_PATH."
else
  echo "  = DASHCLAW_BASE_URL and DASHCLAW_API_KEY are set"
fi

cat <<EOF

Next steps:
  hermes plugins enable dashclaw
  hermes dashclaw doctor
  hermes               # starts a session; the dashclaw plugin is active
EOF

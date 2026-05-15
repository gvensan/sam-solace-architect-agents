#!/usr/bin/env bash
# refresh-plugin.sh — re-install a Solace Architect plugin from GitHub.
#
# Pip caches already-installed package versions, so `sam plugin install`
# / `pip install` no-op when the version string hasn't changed even if
# the upstream source moved forward. This script wraps the force-reinstall
# incantation so refreshing a plugin after a `git push` is one command.
#
# Usage:
#   ./refresh-plugin.sh <plugin> [--ref <branch-or-sha>] [--add <component-name>]
#
# Examples:
#   ./refresh-plugin.sh webui-entrypoint
#   ./refresh-plugin.sh solace-architect-discovery --ref develop
#   ./refresh-plugin.sh webui-entrypoint --add sa_webui
#
# Environment:
#   SA_PLUGINS_REPO  Override the upstream git URL (default: this repo).

set -euo pipefail

REPO_URL="${SA_PLUGINS_REPO:-https://github.com/gvensan/sam-solace-architect-agents.git}"
PREFIX="solace-architect-"

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

[ $# -ge 1 ] || usage 1
case "$1" in -h|--help) usage 0 ;; esac

plugin="$1"; shift
case "$plugin" in
  ${PREFIX}*) : ;;
  *)          plugin="${PREFIX}${plugin}" ;;
esac

ref=""
component=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)  ref="$2";       shift 2 ;;
    --add)  component="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *)      echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
done

url="git+${REPO_URL}"
[ -n "$ref" ] && url="${url}@${ref}"
url="${url}#subdirectory=${plugin}"

echo "→ refreshing ${plugin}"
echo "  source: ${url}"

# Clear pip's wheel cache for this package so a same-version commit on the
# same ref actually re-downloads. Failures here are non-fatal (cache might
# not exist, or pip might be too old to support `cache remove`).
pip cache remove "${plugin//-/_}*" >/dev/null 2>&1 || true

pip install --force-reinstall --no-deps "$url"

if [ -n "$component" ]; then
  echo "→ refreshing local component '${component}' in this SAM project"
  sam plugin add "$component" --plugin "$plugin"
fi

# Sanity check: show where the package landed + mtime of a key file
module_name="${plugin//-/_}"
loc=$(python -c "import importlib, pathlib; m = importlib.import_module('${module_name}'); print(pathlib.Path(m.__file__).parent)" 2>/dev/null || echo "")
if [ -n "$loc" ]; then
  echo "✓ installed at: $loc"
  for f in component.py app.py; do
    [ -f "$loc/$f" ] && ls -l "$loc/$f"
  done
fi

echo
echo "Restart your SAM run to pick up the new code:"
echo "  sam run"
